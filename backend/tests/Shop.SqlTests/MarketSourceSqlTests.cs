using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class MarketSourceSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private HttpClient Writer=>fixture.Writer;
    private static Task<JsonNode> Json(HttpResponseMessage r)=>MarketFixture.Json(r);
    private static MarketDetailsInput Details(string? key=null,string status="Published",string? price=null)
    {
        var now=DateTimeOffset.UtcNow;return new(status,"qa-source",key??Guid.NewGuid().ToString("N"),"منبع آزمون","Synthetic source",null,price is null?"unknown":"available",price is null?null:now.AddMinutes(-1),price is null?null:now.AddHours(1),price,true);
    }
    private async Task<string> Create()
    {
        var model=new CatalogModelInput("phones","samsung","source-"+Guid.NewGuid().ToString("N"),[new("fa","مدل چندمنبعی نمونه","دادهٔ مصنوعی آزمون"),new("en","Synthetic multisource model","Synthetic SQL sample")],[],["/products/phone-green.svg"],null);
        return (await Json(await Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,Details()))))["id"]!.GetValue<string>();
    }
    private async Task<MarketAdminSources> Read(string listing)=>await Writer.GetFromJsonAsync<MarketAdminSources>("/api/admin/market/"+listing+"/sources")??throw new Exception("Missing sources");
    private async Task<(string Source,MarketSourceResult Result)> Add(string listing,MarketDetailsInput? details=null,string? wireName=null)
    {
        var current=await Read(listing);var source=Guid.NewGuid().ToString("N");var request=Guid.NewGuid().ToString("D");var input=new MarketSourceInput(current.ListingVersion,null,details??Details());
        var result=await Writer.PutAsJsonAsync(Path(listing,source,request),input);var node=wireName is null?await Json(result):await Wire(result,wireName,"result");return(source,node.Deserialize<MarketSourceResult>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!);
    }
    private static async Task<JsonNode> Wire(HttpResponseMessage response,string name,string kind)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.IsSuccessStatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_MARKET_SOURCES_WIRE_DIR") is {Length:>0} directory){Assert.True(System.IO.Path.IsPathFullyQualified(directory));Directory.CreateDirectory(directory);using(var file=new FileStream(System.IO.Path.Combine(directory,name+".json"),FileMode.CreateNew))file.Write(bytes);var path=System.IO.Path.Combine(directory,"manifest.json");var entries=File.Exists(path)?JsonNode.Parse(File.ReadAllText(path))!["entries"]!.AsArray():new JsonArray();entries.Add(new JsonObject{["file"]=name+".json",["kind"]=kind,["sha256"]=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(path,new JsonObject{["actualSqlHttpBodies"]=true,["entries"]=entries.DeepClone()}.ToJsonString(new(){WriteIndented=true}));}return JsonNode.Parse(bytes)!;}
    }
    private static string Path(string l,string s,string r)=>$"/api/admin/market/{l}/sources/{s}/commands/{r}";
    [Fact] public async Task SeveralSourcesKeepOneModelExactReferencePriceAndNeutralStock()
    {
        var listing=await Create();await using var before=fixture.Sql.Factory.Services.CreateAsyncScope();var inventory=before.ServiceProvider.GetRequiredService<InventoryDbContext>();var stock=await inventory.Stock.SumAsync(x=>x.OnHand);var count=await before.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.CountAsync();
        var added=await Add(listing,Details(price:"9007199254740993"),"create-result");await Add(listing,Details(status:"Hidden"));
        var sources=await Wire(await Writer.GetAsync($"/api/market/en/{listing}/sources"),"public-sources-en","sources");await Wire(await Writer.GetAsync($"/api/market/fa/{listing}/sources"),"public-sources-fa","sources");await Wire(await Writer.GetAsync($"/api/admin/market/{listing}/sources"),"admin-sources","admin");Assert.Equal(2,sources["sources"]!.AsArray().Count);var extra=sources["sources"]!.AsArray().Single(x=>x!["id"]!.GetValue<string>()==added.Source)!;Assert.Equal("9007199254740993",extra["referencePriceRial"]!.GetValue<string>());Assert.True(extra["referencePriceCurrent"]!.GetValue<bool>());Assert.Equal("Synthetic source",extra["sourceName"]!.GetValue<string>());Assert.DoesNotContain("sourceKey",sources.ToJsonString());Assert.DoesNotContain("version",sources.ToJsonString());
        var page=await Json(await Writer.PostAsJsonAsync("/api/market/en/search",new{Query="Synthetic multisource model"}));Assert.Single(page["items"]!.AsArray(),x=>x!["id"]!.GetValue<string>()==listing);
        Assert.Equal(stock,await inventory.Stock.SumAsync(x=>x.OnHand));Assert.Equal(count,await before.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.CountAsync());
    }
    [Fact] public async Task RecordedHistoryPreservesOldPriceTimeLabelsAndUnknownWithoutInferringFacts()
    {
        var listing=await Create();var added=await Add(listing,Details(price:"9007199254740993"));var current=await Read(listing);var d=current.Sources.Single(x=>x.Id==added.Source).Details with{SourceNameFa="منبع تازه",SourceNameEn="Changed source",ReferencePriceRial=null,ObservedAt=null,ValidUntil=null,Availability="unknown"};
        var input=new MarketSourceInput(current.ListingVersion,current.Sources.Single(x=>x.Id==added.Source).Version,d);await Json(await Writer.PutAsJsonAsync(Path(listing,added.Source,Guid.NewGuid().ToString("D")),input));
        var history=await Wire(await Writer.GetAsync($"/api/market/en/{listing}/sources/{added.Source}/history"),"public-history","history");var rows=history["items"]!.AsArray();Assert.Equal(2,rows.Count);Assert.Null(rows[0]!["source"]!["referencePriceRial"]);Assert.Equal("unknown",rows[0]!["source"]!["availability"]!.GetValue<string>());Assert.Equal("Changed source",rows[0]!["source"]!["sourceName"]!.GetValue<string>());Assert.Equal("9007199254740993",rows[1]!["source"]!["referencePriceRial"]!.GetValue<string>());Assert.Equal("Synthetic source",rows[1]!["source"]!["sourceName"]!.GetValue<string>());Assert.All(rows,x=>Assert.Equal("recorded",x!["origin"]!.GetValue<string>()));
        var hidden=await Read(listing);await Json(await Writer.PutAsJsonAsync(Path(listing,added.Source,Guid.NewGuid().ToString("D")),new MarketSourceInput(hidden.ListingVersion,hidden.Sources.Single(x=>x.Id==added.Source).Version,d with{Status="Hidden"})));
        Assert.Equal(HttpStatusCode.NotFound,(await Writer.GetAsync($"/api/market/en/{listing}/sources/{added.Source}/history")).StatusCode);Assert.Equal(3,(await Wire(await Writer.GetAsync($"/api/admin/market/{listing}/sources/{added.Source}/history"),"admin-hidden-history","history"))["items"]!.AsArray().Count);
    }
    [Fact] public async Task PrimaryLegacyWriterRecordsSnapshotsAndRejectsExtraIdentity()
    {
        var listing=await Create();var original=await Read(listing);Assert.Single((await Json(await Writer.GetAsync($"/api/market/fa/{listing}/sources/{listing}/history")))["items"]!.AsArray());var extra=await Add(listing);var current=await Read(listing);var model=(await Json(await Writer.GetAsync("/api/admin/market/"+listing)))["modelId"]!.GetValue<string>();var primary=current.Sources.Single(x=>x.IsPrimary);
        await Json(await Writer.PutAsJsonAsync("/api/admin/market/"+listing,new MarketListingInput(model,primary.Details with{SourceNameEn="Updated primary"},current.ListingVersion)));
        var history=await Wire(await Writer.GetAsync($"/api/market/en/{listing}/sources/{listing}/history"),"primary-history","history");Assert.Equal(2,history["items"]!.AsArray().Count);Assert.Equal("Updated primary",history["items"]![0]!["source"]!["sourceName"]!.GetValue<string>());Assert.Equal("Synthetic source",history["items"]![1]!["source"]!["sourceName"]!.GetValue<string>());
        var now=await Read(listing);var extraDetails=now.Sources.Single(x=>x.Id==extra.Source).Details;Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/market/"+listing,new MarketListingInput(model,extraDetails,now.ListingVersion))).StatusCode);Assert.NotEqual(original.ListingVersion,now.ListingVersion);
    }
    [Fact] public async Task SameUuidReplayIsActorScopedStaleVersionsConflictAndOnlyOneObservationExists()
    {
        var listing=await Create();var initial=await Read(listing);var source=Guid.NewGuid().ToString("N");var request=Guid.NewGuid().ToString("D");var input=new MarketSourceInput(initial.ListingVersion,null,Details());
        var outcomes=await Task.WhenAll(Writer.PutAsJsonAsync(Path(listing,source,request),input),Writer.PutAsJsonAsync(Path(listing,source,request),input));Assert.Contains(outcomes,x=>x.IsSuccessStatusCode);Assert.All(outcomes,x=>Assert.True(x.IsSuccessStatusCode||x.StatusCode==HttpStatusCode.Conflict));foreach(var response in outcomes)response.Dispose();
        var replay=await Wire(await Writer.PutAsJsonAsync(Path(listing,source,request),input),"replay-result","result");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.True((await Wire(await Writer.GetAsync("/api/admin/market/source-commands/"+request),"receipt-result","result"))["replayed"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(Path(listing,source,request),input with{Details=input.Details with{SourceNameEn="different"}})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(Path(listing,Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("D")),input)).StatusCode);
        using var other=await fixture.Staff("CatalogManager");Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync("/api/admin/market/source-commands/"+request)).StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(1,await db.SourceObservations.CountAsync(x=>x.SourceId==source));Assert.Equal(1,await db.SourceCommands.CountAsync(x=>x.RequestId==Guid.Parse(request).ToString("N")));
    }
    [Fact] public async Task RoleMfaProductionAndHiddenModelsNeverExposeExtraReports()
    {
        var listing=await Create();var extra=await Add(listing);Assert.Equal(HttpStatusCode.OK,(await fixture.Content.GetAsync($"/api/admin/market/{listing}/sources")).StatusCode);var auth=await Read(listing);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PutAsJsonAsync(Path(listing,Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("D")),new MarketSourceInput(auth.ListingVersion,null,Details()))).StatusCode);using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync($"/api/admin/market/{listing}/sources")).StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var prod=new MarketService(market,scope.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,false);var error=await Assert.ThrowsAsync<BusinessException>(()=>prod.SourcesAsync("en",listing,CancellationToken.None));Assert.Equal("not_found",error.Code);
        var current=await Read(listing);var model=(await Json(await Writer.GetAsync("/api/admin/market/"+listing)))["modelId"]!.GetValue<string>();await Json(await Writer.PutAsJsonAsync("/api/admin/market/"+listing,new MarketListingInput(model,current.Sources.Single(x=>x.IsPrimary).Details with{Status="Hidden"},current.ListingVersion)));
        Assert.Equal(HttpStatusCode.NotFound,(await anonymous.GetAsync($"/api/market/en/{listing}/sources")).StatusCode);Assert.Equal(HttpStatusCode.NotFound,(await anonymous.GetAsync($"/api/market/en/{listing}/sources/{extra.Source}/history")).StatusCode);
    }
    [Fact] public async Task SourceCapDuplicatePairAndIdentityGuardsAreAuthoritative()
    {
        var listing=await Create();var first=await Add(listing);var other=await Create();var primary=(await Read(other)).Sources.Single();var current=await Read(listing);var path=Path(listing,Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("D"));Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(path,new MarketSourceInput(current.ListingVersion,null,primary.Details))).StatusCode);
        for(var i=1;i<15;i++)await Add(listing);
        current=await Read(listing);Assert.Equal(16,current.Sources.Length);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(Path(listing,Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("D")),new MarketSourceInput(current.ListingVersion,null,Details()))).StatusCode);
        var extra=current.Sources.Single(x=>x.Id==first.Source);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(Path(listing,extra.Id,Guid.NewGuid().ToString("D")),new MarketSourceInput(current.ListingVersion,extra.Version,extra.Details with{SourceItemKey="changed"}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync(Path(listing,listing,Guid.NewGuid().ToString("D")),new MarketSourceInput(current.ListingVersion,null,Details()))).StatusCode);
    }
    [Fact] public async Task ObservationWritesAndReceiptOrAuditFailuresRollbackTheWholeSourceCommand()
    {
        var listing=await Create();var current=await Read(listing);var source=Guid.NewGuid().ToString("N");var request=Guid.NewGuid().ToString("D");var input=new MarketSourceInput(current.ListingVersion,null,Details());
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope())await setup.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER [identity].[MarketSourceAuditFailure] ON [identity].[Audit] AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE Resource LIKE '/api/admin/market/%/sources/%/commands/%') THROW 51000,'Synthetic source audit failure',1; END");
        try{using var response=await Writer.PutAsJsonAsync(Path(listing,source,request),input);Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);}
        finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("DROP TRIGGER [identity].[MarketSourceAuditFailure]");}
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.False(await db.Sources.AnyAsync(x=>x.Id==source));Assert.False(await db.SourceObservations.AnyAsync(x=>x.SourceId==source));Assert.False(await db.SourceCommands.AnyAsync(x=>x.RequestId==Guid.Parse(request).ToString("N")));Assert.Equal(current.ListingVersion,Convert.ToBase64String((await db.Listings.SingleAsync(x=>x.Id==listing)).Version));var observation=await db.SourceObservations.SingleAsync(x=>x.ListingId==listing);observation.SourceNameEn="mutated";await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());}
        await Json(await Writer.PutAsJsonAsync(Path(listing,source,request),input));
    }
    [Fact] public async Task HistoryPaginationUsesExactDecimalSequenceAndNeverCrossesSources()
    {
        var listing=await Create();var added=await Add(listing);for(var i=0;i<23;i++){var current=await Read(listing);var source=current.Sources.Single(x=>x.Id==added.Source);await Json(await Writer.PutAsJsonAsync(Path(listing,added.Source,Guid.NewGuid().ToString("D")),new MarketSourceInput(current.ListingVersion,source.Version,source.Details with{SourceNameEn="Historical sample "+i})));}
        var first=await Wire(await Writer.GetAsync($"/api/market/en/{listing}/sources/{added.Source}/history"),"history-page1","history");Assert.Equal(20,first["items"]!.AsArray().Count);var cursor=first["nextBefore"]!.GetValue<string>();Assert.Equal(first["items"]![19]!["sequence"]!.GetValue<string>(),cursor);var second=await Wire(await Writer.GetAsync($"/api/market/en/{listing}/sources/{added.Source}/history?before={cursor}"),"history-page2","history");Assert.Equal(4,second["items"]!.AsArray().Count);Assert.Null(second["nextBefore"]);Assert.All(second["items"]!.AsArray(),x=>{Assert.True(long.Parse(x!["sequence"]!.GetValue<string>())<long.Parse(cursor));Assert.Equal(added.Source,x["source"]!["id"]!.GetValue<string>());});Assert.Equal(HttpStatusCode.BadRequest,(await Writer.GetAsync($"/api/market/en/{listing}/sources/{added.Source}/history?before=900719925474099300000")).StatusCode);
    }
    [Fact] public async Task ReceiptInsertionFailureDoesNotKeepCurrentOrHistoricalSourceState()
    {
        var listing=await Create();var current=await Read(listing);var source=Guid.NewGuid().ToString("N");var request=Guid.NewGuid().ToString("D");var input=new MarketSourceInput(current.ListingVersion,null,Details());
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope())await setup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER [market].[MarketSourceReceiptFailure] ON [market].[SourceCommands] AFTER INSERT AS BEGIN THROW 51000,'Synthetic receipt failure',1; END");
        try{using var response=await Writer.PutAsJsonAsync(Path(listing,source,request),input);Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);}
        finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("DROP TRIGGER [market].[MarketSourceReceiptFailure]");}
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.False(await db.Sources.AnyAsync(x=>x.Id==source));Assert.False(await db.SourceObservations.AnyAsync(x=>x.SourceId==source));Assert.Equal(current.ListingVersion,Convert.ToBase64String((await db.Listings.SingleAsync(x=>x.Id==listing)).Version));}
        await Json(await Writer.PutAsJsonAsync(Path(listing,source,request),input));
    }
}
