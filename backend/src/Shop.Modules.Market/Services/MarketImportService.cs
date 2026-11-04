using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;
public sealed class MarketImportService(MarketDbContext db,IMarketModelCatalog catalog,MarketService market,TimeProvider time,bool allowDemo)
{
    private sealed record Plan(MarketCsvRow Row,CatalogModelInput Model,MarketDetailsInput Details,MarketImportExpectedInput Expected,bool HasOffers);
    private sealed record Built(MarketImportPreview Preview,Plan[] Plans);
    private static readonly JsonSerializerOptions JsonOptions=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow};
    public async Task<MarketImportPreview> PreviewAsync(string csv,CancellationToken ct)=>(await BuildAsync(csv,ct)).Preview;
    public async Task<MarketImportResult> ReadReceiptAsync(string requestId,string actorId,CancellationToken ct)
    {
        if(!Guid.TryParseExact(requestId,"D",out var request))throw new BusinessException("invalid_market_csv","Use the import UUID.");
        var row=await db.ImportReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actorId&&r.RequestId==request.ToString("N"),ct)??throw new BusinessException("not_found","No committed import receipt was found for this account.");
        if(row.ContainsDemo&&!allowDemo)throw new BusinessException("demo_unavailable","Sample imports are unavailable outside Development.");
        return (JsonSerializer.Deserialize<MarketImportResult>(row.ResponseJson,JsonOptions)??throw new InvalidOperationException("The import receipt is unavailable.")) with{Replayed=true};
    }
    private async Task<Built> BuildAsync(string csv,CancellationToken ct)
    {
        var table=MarketCsv.Parse(csv);var keys=table.Headers.Select(MarketCsv.Attribute).Where(a=>a is not null).Select(a=>a!.Value.Key).Distinct().ToArray();
        var definitions=await catalog.ResolveAttributeKeysAsync(keys,ct);
        if(keys.Any(k=>!definitions.ContainsKey(k)))throw new BusinessException("invalid_market_csv","One or more attribute header keys are not defined in the catalogue.");
        var previews=new List<MarketImportPreviewRow>();var plans=new List<Plan>();var sources=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var models=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var slugs=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var row in table.Rows){
            ct.ThrowIfCancellationRequested();var cells=row.Cells;string Cell(string key)=>cells.GetValueOrDefault(key,"");
            Plan? plan=null;
            try{
                var details=new MarketDetailsInput(Cell("status"),Cell("source_key"),Cell("source_item_key"),Cell("source_name_fa"),Cell("source_name_en"),Optional(Cell("source_url")),Cell("availability"),MarketCsv.Date(Cell("observed_at")),MarketCsv.Date(Cell("valid_until")),Optional(MarketCsv.Digits(Cell("reference_price_rial"))),MarketCsv.Boolean(Cell("is_demo")));
                MarketRules.Validate(new("pending",details,null),allowDemo,time.GetUtcNow());
                if(await db.Sources.AnyAsync(s=>s.SourceKey==details.SourceKey&&s.SourceItemKey==details.SourceItemKey.Trim(),ct))throw new BusinessException("market_source_conflict","This source/item belongs to an extra report. Update it through source management; model CSV edits the primary source only.");
                if(!sources.Add(details.SourceKey+'\0'+details.SourceItemKey))throw new BusinessException("duplicate_market_csv_row","A source/item pair occurs more than once in this file.");
                if(!slugs.Add(Cell("slug")))throw new BusinessException("duplicate_market_csv_row","A model slug occurs more than once in this file.");
                var listing=await db.Listings.AsNoTracking().SingleOrDefaultAsync(l=>l.SourceKey==details.SourceKey&&l.SourceItemKey==details.SourceItemKey,ct);
                var supplied=Optional(Cell("model_id"));if(supplied is not null)MarketRules.Id(supplied);
                if(listing is not null&&supplied is not null&&!string.Equals(supplied,listing.ModelId,StringComparison.OrdinalIgnoreCase))throw new BusinessException("market_model_conflict","The source item is already linked to another model.");
                var modelId=listing?.ModelId??supplied;
                if(modelId is not null&&!models.Add(modelId))throw new BusinessException("duplicate_market_csv_row","A model occurs more than once in this file.");
                if(listing is null&&modelId is not null&&await db.Listings.AnyAsync(l=>l.ModelId==modelId,ct))throw new BusinessException("market_model_conflict","This model already has another market source item.");
                var existing=modelId is null?null:await catalog.ReadEditableAsync(modelId,ct);var previous=existing?.Input;
                var attributes=(previous?.Attributes??[]).ToDictionary(a=>a.AttributeId,StringComparer.Ordinal);
                foreach(var group in keys){
                    var id=definitions[group];string Part(string part)=>Cell("attr."+group+'.'+part);var clear=Part("clear");var fields=new[]{"fa","en","number","bool","option_id","option_ids"};var values=fields.Any(f=>Part(f).Length>0);
                    if(clear.Length>0&&MarketCsv.Boolean(clear)){if(values)throw new BusinessException("invalid_market_csv","An attribute cannot be cleared and assigned in the same row.");attributes.Remove(id);continue;}
                    if(!values)continue;
                    attributes.TryGetValue(id,out var old);var text=Part("fa").Length>0||Part("en").Length>0;
                    attributes[id]=new(id,text?Optional(Part("fa"))??old?.TextFa:null,text?Optional(Part("en"))??old?.TextEn:null,Part("number").Length==0?null:MarketCsv.Number(Part("number")),Part("bool").Length==0?null:MarketCsv.Boolean(Part("bool")),Optional(Part("option_id")),Part("option_ids").Length==0?null:MarketCsv.List(Part("option_ids")));
                }
                string Description(string locale)=>cells.ContainsKey("description_"+locale)?Cell("description_"+locale):previous?.Translations.FirstOrDefault(t=>t.Locale==locale)?.Description??"";
                var input=new CatalogModelInput(Cell("category_id"),Cell("brand_id"),Cell("slug"),[new("fa",Cell("name_fa"),Description("fa")),new("en",Cell("name_en"),Description("en"))],attributes.Values.OrderBy(a=>a.AttributeId,StringComparer.Ordinal).ToArray(),MarketCsv.List(Cell("image_urls")),previous?.Version);
                var fingerprint=await catalog.ValidateAsync(modelId,input,details.Status=="Published",ct);
                var expected=new MarketImportExpectedInput(row.Number,listing?.Id,listing is null?null:Convert.ToBase64String(listing.Version),modelId,previous?.Version,fingerprint);
                plan=new(row,input,details,expected,existing?.HasOffers??false);plans.Add(plan);
                previews.Add(new(row.Number,listing is null?modelId is null?"create":"link":"update",Cell("name_fa"),Cell("name_en"),details.SourceKey,details.SourceItemKey,details.Status,details.ReferencePriceRial,plan.HasOffers,expected,[]));
            }catch(BusinessException e){previews.Add(new(row.Number,"invalid",Cell("name_fa"),Cell("name_en"),Cell("source_key"),Cell("source_item_key"),Cell("status"),Optional(Cell("reference_price_rial")),plan?.HasOffers??false,null,[new(e.Code,e.Message)]));}
        }
        var invalid=previews.Count(p=>p.Issues.Length>0);return new(new(1,Hash(csv),previews.ToArray(),previews.Count-invalid,invalid,invalid==0&&previews.Count>0),plans.ToArray());
    }
    public async Task<MarketImportResult> CommitAsync(MarketCsvCommitRequest input,string actorId,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("CSV import requires the composition root Serializable transaction.");
        if(!Guid.TryParseExact(input.RequestId,"D",out var request)||string.IsNullOrEmpty(actorId)||actorId.Length>64||input.Expected is null||input.Expected.Length is <1 or >MarketCsv.MaxRows||input.Expected.Any(e=>e is null||e.RowNumber<2||e.MetadataFingerprint is null||e.MetadataFingerprint.Length!=64||e.MetadataFingerprint.Any(c=>!char.IsAsciiHexDigit(c)))||input.Expected.Select(e=>e.RowNumber).Distinct().Count()!=input.Expected.Length)throw new BusinessException("invalid_market_csv","Use a UUID and the exact row expectations from the preview.");
        _=MarketCsv.Parse(input.Csv);var expected=input.Expected.OrderBy(e=>e.RowNumber).ToArray();var payloadHash=Hash(JsonSerializer.Serialize(new{input.Csv,Expected=expected},JsonOptions));var requestId=request.ToString("N");
        var prior=await db.ImportReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actorId&&r.RequestId==requestId,ct);
        if(prior is not null){
            if(prior.PayloadHash!=payloadHash)throw new BusinessException("idempotency_conflict","This import UUID was already used with another file or preview.");
            if(prior.ContainsDemo&&!allowDemo)throw new BusinessException("demo_unavailable","Sample imports are unavailable outside Development.");
            return (JsonSerializer.Deserialize<MarketImportResult>(prior.ResponseJson,JsonOptions)??throw new InvalidOperationException("The import receipt is unavailable.")) with{Replayed=true};
        }
        var built=await BuildAsync(input.Csv,ct);if(!built.Preview.CanCommit)throw new BusinessException("invalid_market_csv","The file has validation errors. Preview and correct it before importing.");
        if(built.Plans.Length!=expected.Length||!built.Plans.Select(p=>p.Expected).OrderBy(e=>e.RowNumber).SequenceEqual(expected))throw new BusinessException("version_conflict","The source listing, model or metadata changed after preview. Read a fresh preview.");
        var saved=new List<MarketImportSavedRow>();
        foreach(var plan in built.Plans){
            ct.ThrowIfCancellationRequested();string listingId;string modelId;
            if(plan.Expected.ModelId is null){listingId=await market.CreateModelAsync(new(plan.Model,plan.Details),actorId,ct);modelId=(await db.Listings.SingleAsync(l=>l.Id==listingId,ct)).ModelId;}
            else{
                modelId=await catalog.SaveAsync(plan.Expected.ModelId,plan.Model,actorId,ct);
                listingId=await market.SaveAsync(plan.Expected.ListingId,new(modelId,plan.Details,plan.Expected.ListingVersion),ct);
            }
            saved.Add(new(plan.Row.Number,listingId,modelId,plan.Expected.ListingId is not null?"update":plan.Expected.ModelId is not null?"link":"create"));
        }
        var result=new MarketImportResult(1,request.ToString("D"),payloadHash,saved.Count(r=>r.Operation!="update"),saved.Count(r=>r.Operation=="update"),saved.ToArray(),false);
        db.ImportReceipts.Add(new(){ActorId=actorId,RequestId=requestId,PayloadHash=payloadHash,ResponseJson=JsonSerializer.Serialize(result,JsonOptions),RowCount=saved.Count,ContainsDemo=built.Plans.Any(p=>p.Details.IsDemo),CreatedAt=time.GetUtcNow()});await db.SaveChangesAsync(ct);return result;
    }
    private static string? Optional(string value)=>value.Length==0?null:value;
    private static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
