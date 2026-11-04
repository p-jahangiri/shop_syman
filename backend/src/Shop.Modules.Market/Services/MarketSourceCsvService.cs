using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Market;

public sealed class MarketSourceCsvService(MarketDbContext db,IMarketModelCatalog catalog,MarketService market,TimeProvider time,bool allowDemo)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    private sealed record Plan(SourceCsvExpectedInput Expected,MarketDetailsInput Details,bool ContainsDemo);
    private sealed record Built(SourceCsvPreview Preview,Plan[] Plans);
    public async Task<SourceCsvPreview> PreviewAsync(string csv,CancellationToken ct)=>(await BuildAsync(csv,ct)).Preview;
    public async Task<SourceCsvResult> ReceiptAsync(string requestId,string actorId,CancellationToken ct)
    {
        var key=Key(requestId,actorId);var row=await db.SourceImportReceipts.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actorId&&x.RequestId==key,ct)??throw new BusinessException("not_found","No source import receipt was found for this account.");
        if(row.ContainsDemo&&!allowDemo)throw new BusinessException("demo_unavailable","Sample source imports are unavailable outside Development.");return Decode(row) with{Replayed=true};
    }
    private async Task<Built> BuildAsync(string csv,CancellationToken ct)
    {
        var table=MarketSourceCsv.Parse(csv);var rows=new List<SourceCsvPreviewRow>();var plans=new List<Plan>();var pairs=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var ids=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var capacities=new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
        foreach(var row in table.Rows){
            ct.ThrowIfCancellationRequested();string Cell(string key)=>row.Cells[key];var listingId=Cell("listing_id");var sourceId=Cell("source_id");var nameFa="";var nameEn="";
            try{
                MarketRules.Id(listingId);var details=new MarketDetailsInput(Cell("status"),Cell("source_key"),Cell("source_item_key"),Cell("source_name_fa"),Cell("source_name_en"),Optional(Cell("source_url")),Cell("availability"),MarketCsv.Date(Cell("observed_at")),MarketCsv.Date(Cell("valid_until")),Optional(MarketCsv.Digits(Cell("reference_price_rial"))),MarketCsv.Boolean(Cell("is_demo")));
                _=MarketRules.Validate(new("pending",details,null),allowDemo,time.GetUtcNow());if(!pairs.Add(details.SourceKey+'\0'+details.SourceItemKey))throw Invalid("duplicate_market_csv_row","A source/item occurs more than once in the file.");
                var listing=await db.Listings.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==listingId,ct)??throw Invalid("not_found","The market listing was not found. Use listing_id from the source panel.");
                listingId=listing.Id;
                if(listing.IsDemo&&!allowDemo)throw Invalid("demo_unavailable","Sample models are unavailable outside Development.");
                if(await db.Listings.AnyAsync(x=>x.SourceKey==details.SourceKey&&x.SourceItemKey==details.SourceItemKey,ct))throw Invalid("market_source_conflict","Model CSV manages the primary source. This template accepts extra source reports only.");
                var pair=await db.Sources.AsNoTracking().SingleOrDefaultAsync(x=>x.SourceKey==details.SourceKey&&x.SourceItemKey==details.SourceItemKey,ct);
                if(sourceId.Length>0&&(!Guid.TryParseExact(sourceId,"N",out var supplied)||supplied.ToString("N")!=sourceId))throw Invalid("invalid_market_csv","source_id must be empty or a lower-case N-format GUID.");
                if(sourceId.Length==0)sourceId=pair?.Id??Hash("source-csv-v1\0"+listingId+'\0'+details.SourceKey+'\0'+details.SourceItemKey)[..32].ToLowerInvariant();
                if(sourceId==listingId||pair is not null&&(pair.Id!=sourceId||pair.ListingId!=listingId))throw Invalid("market_source_conflict","This source/item belongs to another source or model.");
                if(!ids.Add(sourceId))throw Invalid("duplicate_market_csv_row","A source occurs more than once in the file.");
                var existing=await db.Sources.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==sourceId,ct);
                if(existing is not null&&(existing.ListingId!=listingId||existing.SourceKey!=details.SourceKey||existing.SourceItemKey!=details.SourceItemKey))throw Invalid("market_source_conflict","An existing source identity cannot be moved or renamed.");
                if(!capacities.TryGetValue(listingId,out var count))count=await db.Sources.CountAsync(x=>x.ListingId==listingId,ct);
                if(existing is null)count++;capacities[listingId]=count;if(count>15)throw Invalid("market_source_capacity_conflict","This file exceeds the fifteen extra sources allowed for a model.");
                var editable=await catalog.ReadEditableAsync(listing.ModelId,ct);nameFa=editable.Input.Translations.FirstOrDefault(x=>x.Locale=="fa")?.Name??"";nameEn=editable.Input.Translations.FirstOrDefault(x=>x.Locale=="en")?.Name??"";
                var fingerprint=await catalog.ValidateAsync(listing.ModelId,editable.Input,details.Status=="Published",ct);var expected=new SourceCsvExpectedInput(row.Number,listingId,Convert.ToBase64String(listing.Version),sourceId,existing is null?null:Convert.ToBase64String(existing.Version),editable.Input.Version!,fingerprint);
                plans.Add(new(expected,details,listing.IsDemo||details.IsDemo));rows.Add(new(row.Number,listingId,sourceId,existing is null?"create":"update",nameFa,nameEn,details.SourceNameFa,details.SourceNameEn,details.ReferencePriceRial,expected,[]));
            }catch(BusinessException e){rows.Add(new(row.Number,Bound(listingId,64),Bound(sourceId,32),"invalid",nameFa,nameEn,Bound(Cell("source_name_fa"),200),Bound(Cell("source_name_en"),200),Optional(Bound(Cell("reference_price_rial"),80)),null,[new(e.Code,e.Message)]));}
        }
        var invalid=rows.Count(x=>x.Issues.Length>0);return new(new(1,Hash(csv),rows.ToArray(),rows.Count-invalid,invalid,invalid==0&&rows.Count>0),plans.ToArray());
    }
    public async Task<SourceCsvResult> CommitAsync(SourceCsvCommitRequest input,string actorId,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Source CSV requires the root Serializable transaction.");
        var key=Key(input.RequestId,actorId);_=MarketSourceCsv.Parse(input.Csv);
        if(input.Expected is null||input.Expected.Length is <1 or >50||input.Expected.Any(x=>x is null||x.RowNumber is <2 or >51||x.ListingId is not{Length:>0 and <=32}||x.SourceId is not{Length:32}||x.ListingVersion is not{Length:12}||x.ModelVersion is not{Length:12}||x.SourceVersion is not null&&x.SourceVersion.Length!=12||x.MetadataFingerprint is not{Length:64}||x.MetadataFingerprint.Any(c=>!char.IsAsciiHexDigit(c)))||input.Expected.Select(x=>x.RowNumber).Distinct().Count()!=input.Expected.Length)throw Invalid("invalid_market_csv","Use the exact row expectations from a fresh source CSV preview.");
        var expected=input.Expected.OrderBy(x=>x.RowNumber).ToArray();var hash=Hash(JsonSerializer.Serialize(new{input.Csv,Expected=expected},Json));var prior=await db.SourceImportReceipts.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actorId&&x.RequestId==key,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw Invalid("idempotency_conflict","This source import UUID was already used with another file or preview.");if(prior.ContainsDemo&&!allowDemo)throw Invalid("demo_unavailable","Sample source imports are unavailable outside Development.");return Decode(prior) with{Replayed=true};}
        var built=await BuildAsync(input.Csv,ct);if(!built.Preview.CanCommit)throw Invalid("invalid_market_csv","The source file has validation errors. Correct a fresh preview before committing.");
        if(!built.Plans.Select(x=>x.Expected).OrderBy(x=>x.RowNumber).SequenceEqual(expected))throw Invalid("version_conflict","A source, model, parent or metadata changed after preview.");
        var saved=new List<SourceCsvSavedRow>();
        foreach(var plan in built.Plans){
            // Every initial expectation was compared before any row writes.
            // Rows for the same model then consume each successive parent
            // version within this one root transaction, not a stale preview.
            var version=await db.Listings.Where(x=>x.Id==plan.Expected.ListingId).Select(x=>x.Version).SingleAsync(ct);var command=Guid.ParseExact(Hash("source-csv-command-v1\0"+actorId+'\0'+key+'\0'+plan.Expected.RowNumber)[..32],"N").ToString("D");
            var result=await market.SaveSourceAsync(plan.Expected.ListingId,plan.Expected.SourceId,command,new(Convert.ToBase64String(version),plan.Expected.SourceVersion,plan.Details),actorId,ct);saved.Add(new(plan.Expected.RowNumber,result.ListingId,result.SourceId,plan.Expected.SourceVersion is null?"create":"update",result.ListingVersion,result.SourceVersion));
        }
        var response=new SourceCsvResult(1,Guid.Parse(input.RequestId).ToString("D"),hash,Hash(input.Csv),saved.Count(x=>x.Operation=="create"),saved.Count(x=>x.Operation=="update"),saved.ToArray(),false);db.SourceImportReceipts.Add(new(){ActorId=actorId,RequestId=key,PayloadHash=hash,ResultJson=JsonSerializer.Serialize(response,Json),RowCount=saved.Count,ContainsDemo=built.Plans.Any(x=>x.ContainsDemo),RecordedAt=time.GetUtcNow()});await db.SaveChangesAsync(ct);return response;
    }
    private static SourceCsvResult Decode(MarketSourceImportReceipt row)
    {
        try{var value=JsonSerializer.Deserialize<SourceCsvResult>(row.ResultJson,Json)??throw Invalid("market_unavailable","The source import receipt is unavailable.");if(value.SchemaVersion!=1||!Guid.TryParseExact(value.RequestId,"D",out var id)||id.ToString("N")!=row.RequestId||value.PayloadHash!=row.PayloadHash||value.FileHash is not{Length:64}||value.FileHash.Any(c=>!char.IsAsciiHexDigit(c))||value.Replayed||value.Rows is null||value.Rows.Length!=row.RowCount||value.Rows.Any(x=>x is null)||value.Created<0||value.Updated<0||value.Created+value.Updated!=value.Rows.Length||value.Rows.Select(x=>x.RowNumber).Distinct().Count()!=value.Rows.Length||value.Rows.Select(x=>x.SourceId).Distinct().Count()!=value.Rows.Length||value.Rows.Any(x=>x.RowNumber is <2 or >51||x.Operation is not("create" or "update")||x.ListingId is not{Length:>0 and <=32}||!Guid.TryParseExact(x.SourceId,"N",out _)||x.SourceId==x.ListingId||Convert.FromBase64String(x.ListingVersion).Length!=8||Convert.FromBase64String(x.SourceVersion).Length!=8)||value.Created!=value.Rows.Count(x=>x.Operation=="create"))throw Invalid("market_unavailable","The source import receipt is unavailable.");return value;}catch(Exception e)when(e is JsonException or FormatException or ArgumentNullException){throw Invalid("market_unavailable","The source import receipt is unavailable.");}
    }
    private static string Key(string requestId,string actorId)=>Guid.TryParseExact(requestId,"D",out var id)&&actorId is{Length:>0 and <=64}?id.ToString("N"):throw Invalid("invalid_market_csv","Use the command UUID and authenticated actor.");
    private static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string? Optional(string value)=>value.Length==0?null:value;
    private static string Bound(string value,int length)=>value.Length<=length?value:value[..length];
    private static BusinessException Invalid(string code,string message)=>new(code,message);
}
