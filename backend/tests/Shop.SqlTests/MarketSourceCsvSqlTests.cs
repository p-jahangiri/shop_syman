using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class MarketSourceCsvSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private HttpClient Writer=>fixture.Writer;
    private static readonly JsonSerializerOptions JsonOptions=new(JsonSerializerDefaults.Web);
    private static Task<JsonNode> Json(HttpResponseMessage r)=>MarketFixture.Json(r);
    private async Task<string> Create()
    {
        var key=Guid.NewGuid().ToString("N");var model=new CatalogModelInput("phones","samsung","csv-source-"+key,[new("fa","مدل نمونه فایل منابع","دادهٔ مصنوعی آزمون"),new("en","Source CSV sample model","Synthetic SQL sample")],[],["/products/phone-green.svg"],null);var details=new MarketDetailsInput("Published","qa-primary",key,"نمونه اصلی","Primary sample",null,"unknown",null,null,null,true);return (await Json(await Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,details))))["id"]!.GetValue<string>();
    }
    private static string Row(string listing,string key,string? price=null,string? sourceId=null,string name="منبع نمونه")
    {
        var now=DateTimeOffset.UtcNow;return string.Join(',',new[]{listing,sourceId??"","qa-csv-extra",key,"Published",name,"Source CSV sample","",price is null?"unknown":"available",price is null?"":now.AddDays(-1).ToString("O"),price is null?"":now.AddDays(1).ToString("O"),price??"","true"}.Select(MarketCsv.Escape));
    }
    private static string Csv(params string[] rows)=>"\uFEFF"+string.Join(',',MarketSourceCsv.Columns)+"\r\n"+string.Join("\r\n",rows);
    private async Task<SourceCsvPreview> Preview(string csv,string? wireName=null)
    {
        var response=await Writer.PostAsJsonAsync("/api/admin/market/source-import/preview",new SourceCsvPreviewRequest(csv));return (wireName is null?await Json(response):await Wire(response,wireName,"preview",csv)).Deserialize<SourceCsvPreview>(JsonOptions)!;
    }
    private static SourceCsvCommitRequest Command(string csv,SourceCsvPreview preview,string? requestId=null)=>new(csv,requestId??Guid.NewGuid().ToString("D"),preview.Rows.Select(x=>x.Expected!).ToArray());
    private async Task<SourceCsvResult> Commit(SourceCsvCommitRequest input,string? wireName=null)
    {
        var response=await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",input);return (wireName is null?await Json(response):await Wire(response,wireName,"result",input.Csv)).Deserialize<SourceCsvResult>(JsonOptions)!;
    }
    private static async Task<JsonNode> Wire(HttpResponseMessage response,string name,string kind,string csv)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.IsSuccessStatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_SOURCE_CSV_WIRE_DIR") is{Length:>0} directory){Assert.True(System.IO.Path.IsPathFullyQualified(directory));Directory.CreateDirectory(directory);using(var file=new FileStream(System.IO.Path.Combine(directory,name+".json"),FileMode.CreateNew))file.Write(bytes);using(var file=new FileStream(System.IO.Path.Combine(directory,name+".input.csv"),FileMode.CreateNew))file.Write(System.Text.Encoding.UTF8.GetBytes(csv));var manifest=System.IO.Path.Combine(directory,"manifest.json");var entries=File.Exists(manifest)?JsonNode.Parse(File.ReadAllText(manifest))!["entries"]!.AsArray():new JsonArray();entries.Add(new JsonObject{["file"]=name+".json",["kind"]=kind,["csvFile"]=name+".input.csv",["sha256"]=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(manifest,new JsonObject{["actualSqlHttpBodies"]=true,["syntheticCsvInputsOnly"]=true,["entries"]=entries.DeepClone()}.ToJsonString(new(){WriteIndented=true}));}return JsonNode.Parse(bytes)!;}
    }
    private async Task<string> Core()
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<MarketDbContext>().Database.SqlQueryRaw<string>("""
            SELECT (SELECT JSON_QUERY((SELECT Id,Version FROM catalog.Products ORDER BY Id FOR JSON PATH)) products,
            JSON_QUERY((SELECT Id,ProductId,Sku,PriceRial,CompareAtPriceRial,Version FROM catalog.Variants ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) variants,
            JSON_QUERY((SELECT * FROM inventory.Stock ORDER BY VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) stock FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) [Value]
            """).SingleAsync();
    }
    private async Task<string> State(string listing)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<MarketDbContext>().Database.SqlQuery<string>($"""
            SELECT (SELECT JSON_QUERY((SELECT * FROM market.Listings WHERE Id={listing} FOR JSON PATH)) listing,
            JSON_QUERY((SELECT * FROM market.Sources WHERE ListingId={listing} ORDER BY Id FOR JSON PATH)) sources,
            JSON_QUERY((SELECT * FROM market.SourceObservations WHERE ListingId={listing} ORDER BY Sequence FOR JSON PATH)) observations,
            JSON_QUERY((SELECT ActorId,RequestId,PayloadHash,ResultJson FROM market.SourceCommands WHERE ResultJson LIKE {'%'+listing+'%'} ORDER BY ActorId,RequestId FOR JSON PATH)) commands,
            JSON_QUERY((SELECT * FROM market.SourceImportReceipts WHERE ResultJson LIKE {'%'+listing+'%'} ORDER BY ActorId,RequestId FOR JSON PATH)) imports,
            (SELECT COUNT(*) FROM [identity].[Audit] WHERE Resource='/api/admin/market/source-import/commit') audit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) [Value]
            """).SingleAsync();
    }
    [Fact] public async Task PreviewIsReadOnlyAndTwoRowsForOneParentCommitAtomicallyWithoutCatalogOrStockChanges()
    {
        var listing=await Create();var csv=Csv(Row(listing.ToUpperInvariant(),"a-"+listing,"۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳"),Row(listing,"b-"+listing));var before=await State(listing);var core=await Core();var preview=await Preview(csv,"preview-valid");Assert.True(preview.CanCommit);Assert.Equal(2,preview.ValidRows);Assert.Equal(listing,preview.Rows[0].ListingId);Assert.Equal(before,await State(listing));Assert.Equal(preview.Rows.Select(x=>x.SourceId),(await Preview(csv)).Rows.Select(x=>x.SourceId));Assert.Equal("9007199254740993",preview.Rows[0].ReferencePriceRial);
        var result=await Commit(Command(csv,preview),"commit-created");Assert.Equal(2,result.Created);Assert.Equal(0,result.Updated);Assert.Equal(2,result.Rows.Select(x=>x.SourceId).Distinct().Count());Assert.NotEqual(result.Rows[0].ListingVersion,result.Rows[1].ListingVersion);Assert.Equal(core,await Core());
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(2,await db.Sources.CountAsync(x=>x.ListingId==listing));Assert.Equal(3,await db.SourceObservations.CountAsync(x=>x.ListingId==listing));Assert.Equal(9007199254740993L,(await db.Sources.SingleAsync(x=>x.Id==result.Rows[0].SourceId)).ReferencePriceRial);
    }
    [Fact] public async Task ExistingPairUpsertsWithoutSourceIdAndRetainsOldObservation()
    {
        var listing=await Create();var key="upsert-"+listing;var csv=Csv(Row(listing,key,"9007199254740993"));var first=await Commit(Command(csv,await Preview(csv)));var update=Csv(Row(listing,key,"9007199254740994",name:"نام تازه منبع"));var preview=await Preview(update,"preview-update");Assert.Equal("update",preview.Rows[0].Operation);Assert.Equal(first.Rows[0].SourceId,preview.Rows[0].SourceId);var result=await Commit(Command(update,preview),"commit-updated");Assert.Equal(0,result.Created);Assert.Equal(1,result.Updated);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var rows=await db.SourceObservations.Where(x=>x.SourceId==first.Rows[0].SourceId).OrderBy(x=>x.Sequence).ToArrayAsync();Assert.Equal(new long?[]{9007199254740993L,9007199254740994L},rows.Select(x=>x.ReferencePriceRial));Assert.Equal("منبع نمونه",rows[0].SourceNameFa);Assert.Equal("نام تازه منبع",rows[1].SourceNameFa);
    }
    [Fact] public async Task SameUuidRacesReplayOneBatchAndReceiptIsActorScoped()
    {
        var listing=await Create();var csv=Csv(Row(listing,"race-"+listing));var command=Command(csv,await Preview(csv));var outcomes=await Task.WhenAll(Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",command),Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",command));Assert.Contains(outcomes,x=>x.IsSuccessStatusCode);Assert.All(outcomes,x=>Assert.True(x.IsSuccessStatusCode||x.StatusCode==HttpStatusCode.Conflict));foreach(var response in outcomes)response.Dispose();Assert.True((await Commit(command,"commit-replay")).Replayed);
        var receipt=await Wire(await Writer.GetAsync("/api/admin/market/source-import/receipts/"+command.RequestId),"receipt","result",command.Csv);Assert.True(receipt["replayed"]!.GetValue<bool>());using var other=await fixture.Staff("CatalogManager");Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync("/api/admin/market/source-import/receipts/"+command.RequestId)).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",command with{Csv=command.Csv+"\r\n"})).StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(1,await db.Sources.CountAsync(x=>x.ListingId==listing));Assert.Equal(2,await db.SourceObservations.CountAsync(x=>x.ListingId==listing));Assert.Equal(1,await db.SourceImportReceipts.CountAsync(x=>x.RequestId==Guid.Parse(command.RequestId).ToString("N")));
    }
    [Fact] public async Task StaleParentOrMetadataRejectsEveryRowBeforeWrites()
    {
        var listing=await Create();var csv=Csv(Row(listing,"stale-a-"+listing),Row(listing,"stale-b-"+listing));var preview=await Preview(csv);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var brand=await catalog.Brands.SingleAsync(x=>x.Id=="samsung");brand.Name="Synthetic changed brand "+Guid.NewGuid().ToString("N");await catalog.SaveChangesAsync();}
        var before=await State(listing);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",Command(csv,preview))).StatusCode);Assert.Equal(before,await State(listing));
        var fresh=await Preview(csv);var parent=await Writer.GetFromJsonAsync<MarketAdminSources>($"/api/admin/market/{listing}/sources");var primary=parent!.Sources.Single(x=>x.IsPrimary);var detail=await Json(await Writer.GetAsync("/api/admin/market/"+listing));await Json(await Writer.PutAsJsonAsync("/api/admin/market/"+listing,new MarketListingInput(detail["modelId"]!.GetValue<string>(),primary.Details with{SourceNameEn="Changed primary"},parent.ListingVersion)));before=await State(listing);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",Command(csv,fresh))).StatusCode);Assert.Equal(before,await State(listing));
    }
    [Fact] public async Task DuplicatePrimaryWrongParentAndCapacityErrorsCannotPartiallyCommit()
    {
        var listing=await Create();var primary=(await Writer.GetFromJsonAsync<MarketAdminSources>($"/api/admin/market/{listing}/sources"))!.Sources.Single();var invalid=Csv(Row(listing,"duplicate-"+listing),Row(listing,"duplicate-"+listing));Assert.False((await Preview(invalid,"preview-invalid")).CanCommit);var primaryRow=Row(listing,primary.Details.SourceItemKey).Replace("qa-csv-extra","qa-primary",StringComparison.Ordinal);Assert.Equal("market_source_conflict",(await Preview(Csv(primaryRow))).Rows[0].Issues[0].Code);
        var create=Csv(Row(listing,"owned-"+listing));var committed=await Commit(Command(create,await Preview(create)));var other=await Create();Assert.False((await Preview(Csv(Row(other,"owned-"+listing,sourceId:committed.Rows[0].SourceId)))).CanCommit);var over=Csv(Enumerable.Range(0,15).Select(i=>Row(listing,"capacity-"+listing+i)).ToArray());var preview=await Preview(over);Assert.False(preview.CanCommit);Assert.Contains(preview.Rows,x=>x.Issues.Any(e=>e.Code=="market_source_capacity_conflict"));
        var before=await State(listing);Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",Command(over,preview with{Rows=preview.Rows.Where(x=>x.Expected is not null).ToArray()}))).StatusCode);Assert.Equal(before,await State(listing));
    }
    [Fact] public async Task MidRowFailureRollsBackEarlierReportsVersionsAndEveryReceipt()
    {
        var listing=await Create();var csv=Csv(Row(listing,"rollback-a-"+listing),Row(listing,"rollback-b-"+listing,name:"Synthetic trigger failure"));var command=Command(csv,await Preview(csv));var before=await State(listing);
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope())await setup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER [market].[SourceCsvRowFailure] ON [market].[SourceObservations] AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE SourceNameFa=N'Synthetic trigger failure') THROW 51000,'Synthetic mid row failure',1; END");
        try{using var response=await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",command);Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);}
        finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("DROP TRIGGER [market].[SourceCsvRowFailure]");}
        Assert.Equal(before,await State(listing));Assert.Equal(2,(await Commit(command)).Created);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReceiptOrAuditFailureRollsBackWholeBatch(bool audit)
    {
        var listing=await Create();var csv=Csv(Row(listing,"tail-a-"+listing),Row(listing,"tail-b-"+listing));var command=Command(csv,await Preview(csv));var before=await State(listing);var createSql=audit?"CREATE TRIGGER [identity].[SourceCsvTailFailure] ON [identity].[Audit] AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE Resource='/api/admin/market/source-import/commit') THROW 51000,'Synthetic source CSV audit failure',1; END":"CREATE TRIGGER [market].[SourceCsvTailFailure] ON [market].[SourceImportReceipts] AFTER INSERT AS BEGIN THROW 51000,'Synthetic source CSV receipt failure',1; END";
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope())await setup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync(createSql);
        try{using var response=await Writer.PostAsJsonAsync("/api/admin/market/source-import/commit",command);Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);}
        finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync(audit?"DROP TRIGGER [identity].[SourceCsvTailFailure]":"DROP TRIGGER [market].[SourceCsvTailFailure]");}
        Assert.Equal(before,await State(listing));Assert.Equal(2,(await Commit(command)).Created);
    }
    [Fact] public async Task ProductionAndRolesRejectSampleImportsAndUnknownColumns()
    {
        var listing=await Create();var csv=Csv(Row(listing,"roles-"+listing));Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PostAsJsonAsync("/api/admin/market/source-import/preview",new SourceCsvPreviewRequest(csv))).StatusCode);Assert.Equal(HttpStatusCode.OK,(await fixture.Content.GetAsync("/api/admin/market/source-import/template")).StatusCode);using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/admin/market/source-import/template")).StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var catalog=scope.ServiceProvider.GetRequiredService<IMarketModelCatalog>();var prod=new MarketSourceCsvService(db,catalog,new(db,catalog,TimeProvider.System,false),TimeProvider.System,false);var preview=await prod.PreviewAsync(csv,CancellationToken.None);Assert.False(preview.CanCommit);Assert.Equal("demo_unavailable",preview.Rows[0].Issues[0].Code);Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PostAsJsonAsync("/api/admin/market/source-import/preview",new{csv,stock=12})).StatusCode);
    }
    [Fact] public async Task FiftyReportsAcrossFourModelsUseOneAtomicBatchAndExactSourceCounts()
    {
        var listings=new[]{await Create(),await Create(),await Create(),await Create()};var nonce=Guid.NewGuid().ToString("N");var csv=Csv(Enumerable.Range(0,50).Select(i=>Row(listings[i%4],nonce+i)).ToArray());var preview=await Preview(csv,"preview50");Assert.True(preview.CanCommit);Assert.Equal(50,preview.ValidRows);var result=await Commit(Command(csv,preview),"commit50");Assert.Equal(50,result.Created);Assert.Equal(50,result.Rows.Select(x=>x.SourceId).Distinct().Count());await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(50,await db.Sources.CountAsync(x=>listings.Contains(x.ListingId)));Assert.Equal(54,await db.SourceObservations.CountAsync(x=>listings.Contains(x.ListingId)));
    }
}
