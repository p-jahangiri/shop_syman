using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class MarketCsvSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static readonly JsonSerializerOptions JsonOptions=new(JsonSerializerDefaults.Web);
    private HttpClient Writer=>fixture.Writer;
    private static Dictionary<string,string> Row(string? key=null)=>new(){["source_key"]="qa-csv",["source_item_key"]=key??Guid.NewGuid().ToString("N"),["status"]="Published",["source_name_fa"]="نمونه CSV",["source_name_en"]="Sample CSV",["availability"]="unknown",["is_demo"]="true",["category_id"]="phones",["brand_id"]="samsung",["slug"]="csv-"+Guid.NewGuid().ToString("N"),["name_fa"]="گوشی CSV نمونه",["name_en"]="Sample CSV phone",["image_urls"]="/products/phone-green.svg",["description_fa"]="دادهٔ نمونه SQL",["description_en"]="Synthetic SQL sample"};
    private static string Csv(params Dictionary<string,string>[] rows){var headers=MarketCsv.Columns.Concat(rows.SelectMany(r=>r.Keys).Where(k=>!MarketCsv.Columns.Contains(k))).Distinct().ToArray();return string.Join(',',headers)+"\r\n"+string.Join("\r\n",rows.Select(row=>string.Join(',',headers.Select(h=>MarketCsv.Escape(row.GetValueOrDefault(h,""))))));}
    private static async Task Capture(string? name,string body){var directory=Environment.GetEnvironmentVariable("SHOP_MARKET_CSV_WIRE_DIR");if(name is null||string.IsNullOrEmpty(directory))return;Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,name+".json"),body);}
    private async Task<MarketImportPreview> Preview(string csv,HttpClient? client=null,string? capture=null){using var r=await (client??Writer).PostAsJsonAsync("/api/admin/market/import/preview",new MarketCsvPreviewRequest(csv));var body=await r.Content.ReadAsStringAsync();Assert.True(r.IsSuccessStatusCode,$"HTTP {(int)r.StatusCode}: {body}");await Capture(capture,body);return JsonSerializer.Deserialize<MarketImportPreview>(body,JsonOptions)!;}
    private static MarketCsvCommitRequest Command(string csv,MarketImportPreview preview,string? requestId=null)=>new(csv,requestId??Guid.NewGuid().ToString("D"),preview.Rows.Select(r=>r.Expected!).ToArray());
    private async Task<MarketImportResult> Commit(MarketCsvCommitRequest command,HttpClient? client=null,string? capture=null){using var r=await (client??Writer).PostAsJsonAsync("/api/admin/market/import/commit",command);var body=await r.Content.ReadAsStringAsync();Assert.True(r.IsSuccessStatusCode,$"HTTP {(int)r.StatusCode}: {body}");await Capture(capture,body);return JsonSerializer.Deserialize<MarketImportResult>(body,JsonOptions)!;}
    [Fact] public async Task PreviewDoesNotWriteDataReceiptOrSuccessAuditAndRequiresWritePermission()
    {
        async Task<(int,int,int,long)> Counts(){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return(await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.CountAsync(),await scope.ServiceProvider.GetRequiredService<MarketDbContext>().Listings.CountAsync(),await scope.ServiceProvider.GetRequiredService<MarketDbContext>().ImportReceipts.CountAsync(),await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());}
        var before=await Counts();var csv=Csv(Row());var preview=await Preview(csv);Assert.True(preview.CanCommit);Assert.Equal(64,preview.FileHash.Length);Assert.Equal(64,preview.Rows[0].Expected!.MetadataFingerprint.Length);Assert.Equal(before,await Counts());
        Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PostAsJsonAsync("/api/admin/market/import/preview",new MarketCsvPreviewRequest(csv))).StatusCode);
        using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PostAsJsonAsync("/api/admin/market/import/commit",Command(csv,preview))).StatusCode);
    }
    [Fact] public async Task ExactRialPersianDigitsFalseZeroAndDurableReplayUseRealSql()
    {
        var number="csv-num-"+Guid.NewGuid().ToString("N");var boolean="csv-bool-"+Guid.NewGuid().ToString("N");
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();db.AttributeDefinitions.AddRange(new AttributeDefinition{Id=number,Key=number,DataType=AttributeDataType.Number,Translations=[new(){Locale="fa",Name="عدد"},new(){Locale="en",Name="Number"}]},new AttributeDefinition{Id=boolean,Key=boolean,DataType=AttributeDataType.Bool,Translations=[new(){Locale="fa",Name="بله/خیر"},new(){Locale="en",Name="Boolean"}]});db.CategoryAttributes.AddRange(new CategoryAttribute{CategoryId="phones",AttributeId=number},new CategoryAttribute{CategoryId="phones",AttributeId=boolean});await db.SaveChangesAsync();
        }
        var row=Row();row["attr."+number+".number"]="۰";row["attr."+boolean+".bool"]="false";row["reference_price_rial"]="۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳";row["observed_at"]=DateTimeOffset.UtcNow.AddHours(-1).ToString("O");row["valid_until"]=DateTimeOffset.UtcNow.AddDays(1).ToString("O");
        var csv=Csv(row,Row());var preview=await Preview(csv,capture:"preview");Assert.True(preview.CanCommit);Assert.Equal("9007199254740993",preview.Rows[0].ReferencePriceRial);var command=Command(csv,preview);var saved=await Commit(command,capture:"saved");Assert.Equal(2,saved.Created);Assert.False(saved.Replayed);
        var replay=await Commit(command,capture:"replayed");Assert.True(replay.Replayed);Assert.Equal(saved.Rows,replay.Rows);
        foreach(var pair in new[]{("page","/api/admin/market"),("detail","/api/admin/market/"+saved.Rows[0].ListingId),("model","/api/admin/market/models/"+saved.Rows[0].ModelId),("receipt","/api/admin/market/import/receipts/"+command.RequestId)}){using var wire=await Writer.GetAsync(pair.Item2);Assert.Equal(HttpStatusCode.OK,wire.StatusCode);await Capture(pair.Item1,await wire.Content.ReadAsStringAsync());}
        using var receiptResponse=await Writer.GetAsync("/api/admin/market/import/receipts/"+command.RequestId);Assert.Equal(HttpStatusCode.OK,receiptResponse.StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var market=check.ServiceProvider.GetRequiredService<MarketDbContext>();var record=await market.Listings.SingleAsync(l=>l.Id==saved.Rows[0].ListingId);Assert.Equal(9007199254740993L,record.ReferencePriceRial);var catalogue=check.ServiceProvider.GetRequiredService<CatalogDbContext>();var model=await catalogue.Products.Include(p=>p.Attributes).Include(p=>p.Variants).SingleAsync(p=>p.Id==saved.Rows[0].ModelId);Assert.Empty(model.Variants);Assert.Equal(0m,model.Attributes.Single(a=>a.AttributeId==number).ValueNumber);Assert.False(model.Attributes.Single(a=>a.AttributeId==boolean).ValueBool);
        var persisted=await market.ImportReceipts.SingleAsync(r=>r.RequestId==Guid.Parse(command.RequestId).ToString("N"));Assert.DoesNotContain(csv,persisted.ResponseJson);Assert.Equal(2,persisted.RowCount);
    }
    [Fact] public async Task UpsertPreservesUnmentionedAttributesAndExistingSellablePrices()
    {
        var detail=await MarketFixture.Json(await Writer.GetAsync("/api/admin/products/p1"));var p=detail["product"]!;var source=Row();source["model_id"]="p1";source["brand_id"]=p["brandId"]!.GetValue<string>();source["slug"]=p["slug"]!.GetValue<string>();source["image_urls"]=p["media"]![0]!["url"]!.GetValue<string>();
        var oldAttributes=p["attributes"]!.ToJsonString();var prices=p["variants"]!.AsArray().Select(v=>(v!["sku"]!.GetValue<string>(),v["priceRial"]!.GetValue<string>(),v["compareAtPriceRial"]?.GetValue<string>())).ToArray();
        var firstCsv=Csv(source);var first=await Commit(Command(firstCsv,await Preview(firstCsv)));Assert.Equal("link",first.Rows[0].Operation);
        source["name_en"]="Updated sample CSV phone";source["attr.battery.fa"]="";source["attr.battery.en"]="";var csv=Csv(source);var preview=await Preview(csv);Assert.True(preview.CanCommit);Assert.True(preview.Rows[0].HasStorefrontOffers);var saved=await Commit(Command(csv,preview));Assert.Equal(1,saved.Updated);Assert.Equal(first.Rows[0].ListingId,saved.Rows[0].ListingId);
        var after=await MarketFixture.Json(await Writer.GetAsync("/api/admin/products/p1"));Assert.Equal(oldAttributes,after["product"]!["attributes"]!.ToJsonString());Assert.Equal(prices,after["product"]!["variants"]!.AsArray().Select(v=>(v!["sku"]!.GetValue<string>(),v["priceRial"]!.GetValue<string>(),v["compareAtPriceRial"]?.GetValue<string>())).ToArray());Assert.Equal(p["purchaseMethods"]!.ToJsonString(),after["product"]!["purchaseMethods"]!.ToJsonString());
    }
    [Fact] public async Task ChangedSourceOrMetadataAfterPreviewRequiresFreshReview()
    {
        var row=Row();var csv=Csv(row);var command=Command(csv,await Preview(csv));var saved=await Commit(command);var updateCsv=Csv(row);var preview=await Preview(updateCsv);
        await using(var change=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=change.ServiceProvider.GetRequiredService<MarketDbContext>();var l=await db.Listings.SingleAsync(l=>l.Id==saved.Rows[0].ListingId);l.SourceNameEn="Changed by another editor";await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/import/commit",Command(updateCsv,preview))).StatusCode);
        var next=Row();var nextCsv=Csv(next);var nextPreview=await Preview(nextCsv);
        await using(var change=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=change.ServiceProvider.GetRequiredService<CatalogDbContext>();var brand=await db.Brands.SingleAsync(b=>b.Id=="samsung");brand.Name="Samsung CSV metadata "+Guid.NewGuid().ToString("N")[..6];await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/import/commit",Command(nextCsv,nextPreview))).StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.AnyAsync(p=>p.Slug==next["slug"]));
    }
    [Fact] public async Task OneInvalidRowBlocksTheWholeBatchAndExplicitClearRemovesOnlyTheChosenAttribute()
    {
        var first=Row();first["attr.battery.fa"]="باتری نمونه";first["attr.battery.en"]="Sample battery";var csv=Csv(first);var saved=await Commit(Command(csv,await Preview(csv)));
        var clear=Row(first["source_item_key"]);clear["slug"]=first["slug"];clear["attr.battery.clear"]="true";var clearCsv=Csv(clear);var cleared=await Commit(Command(clearCsv,await Preview(clearCsv)));Assert.Equal(1,cleared.Updated);
        var bad=Row();bad["reference_price_rial"]="0";var mixed=Csv(Row(),bad);var preview=await Preview(mixed);Assert.False(preview.CanCommit);Assert.Equal(1,preview.InvalidRows);Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PostAsJsonAsync("/api/admin/market/import/commit",new MarketCsvCommitRequest(mixed,Guid.NewGuid().ToString("D"),preview.Rows.Where(r=>r.Expected is not null).Select(r=>r.Expected!).ToArray()))).StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(await db.Set<ProductAttributeValue>().AnyAsync(a=>a.ProductId==saved.Rows[0].ModelId&&a.AttributeId=="battery"));Assert.False(await db.Products.AnyAsync(p=>p.Slug==bad["slug"]));
    }
    [Fact] public async Task ChangedPayloadWithSameUuidConflictsAndReceiptsAreActorBound()
    {
        var csv=Csv(Row());var command=Command(csv,await Preview(csv));await Commit(command);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/import/commit",command with{Csv=csv.Replace("Sample CSV phone","Other CSV phone")})).StatusCode);
        using var other=await fixture.Staff("CatalogManager");Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync("/api/admin/market/import/receipts/"+command.RequestId)).StatusCode);var otherCsv=Csv(Row());var otherPreview=await Preview(otherCsv,other);var otherSaved=await Commit(Command(otherCsv,otherPreview,command.RequestId),other);Assert.False(otherSaved.Replayed);
    }
    [Fact] public async Task ReceiptWriteFailureRollsBackModelsAndAuditThenSameCommandCanBeRetried()
    {
        var row=Row();var csv=Csv(row);var command=Command(csv,await Preview(csv));long before;
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<MarketDbContext>();await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER [market].[RejectImportQa] ON [market].[ImportReceipts] INSTEAD OF INSERT AS THROW 51000,'Synthetic QA receipt failure',1;");before=await setup.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(a=>a.Resource=="/api/admin/market/import/commit");}
        try{Assert.Equal(HttpStatusCode.InternalServerError,(await Writer.PostAsJsonAsync("/api/admin/market/import/commit",command)).StatusCode);}finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("DROP TRIGGER [market].[RejectImportQa];");}
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.AnyAsync(p=>p.Slug==row["slug"]));Assert.Equal(before,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(a=>a.Resource=="/api/admin/market/import/commit"));}
        var saved=await Commit(command);Assert.False(saved.Replayed);Assert.Single(saved.Rows);
    }
    [Fact] public async Task ConcurrentSameUuidNeverCreatesTwoImports()
    {
        var csv=Csv(Row());var command=Command(csv,await Preview(csv));var responses=await Task.WhenAll(Writer.PostAsJsonAsync("/api/admin/market/import/commit",command),Writer.PostAsJsonAsync("/api/admin/market/import/commit",command));
        Assert.Contains(responses,r=>r.StatusCode==HttpStatusCode.OK);Assert.All(responses,r=>Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict));foreach(var r in responses)r.Dispose();var replay=await Commit(command);Assert.True(replay.Replayed);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<MarketDbContext>().ImportReceipts.CountAsync(r=>r.RequestId==Guid.Parse(command.RequestId).ToString("N")));
    }
    [Fact] public async Task ManualModelAndSourceEditIsAtomicAndRejectsAStaleVersion()
    {
        var csv=Csv(Row());var created=await Commit(Command(csv,await Preview(csv)));var row=created.Rows[0];
        using var modelResponse=await Writer.GetAsync("/api/admin/market/models/"+row.ModelId);var node=System.Text.Json.Nodes.JsonNode.Parse(await modelResponse.Content.ReadAsStringAsync())!;var model=JsonSerializer.Deserialize<CatalogModelEditable>(node["model"]!.ToJsonString(),JsonOptions)!;
        using var sourceResponse=await Writer.GetAsync("/api/admin/market/"+row.ListingId);var source=JsonSerializer.Deserialize<MarketAdminDetail>(await sourceResponse.Content.ReadAsStringAsync(),JsonOptions)!;
        var changed=model.Input with{Translations=[new("fa","ویرایش اتمیک نمونه","نمونه"),new("en","Atomic edited sample","Sample")]};
        var bad=new EditMarketModelInput(changed with{ImageUrls=[]},source.Details with{SourceNameEn="must rollback"},source.Version);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/market/"+row.ListingId+"/edit",bad)).StatusCode);
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=check.ServiceProvider.GetRequiredService<CatalogDbContext>();var saved=await db.Products.Include(p=>p.Translations).Include(p=>p.Media).SingleAsync(p=>p.Id==row.ModelId);Assert.NotEqual("Atomic edited sample",saved.Translations.Single(t=>t.Locale=="en").Name);Assert.NotEmpty(saved.Media);Assert.Equal(source.Details.SourceNameEn,(await check.ServiceProvider.GetRequiredService<MarketDbContext>().Listings.SingleAsync(l=>l.Id==row.ListingId)).SourceNameEn);
        }
        var good=new EditMarketModelInput(changed,source.Details with{SourceNameEn="Atomic source"},source.Version);Assert.Equal(HttpStatusCode.OK,(await Writer.PutAsJsonAsync("/api/admin/market/"+row.ListingId+"/edit",good)).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/market/"+row.ListingId+"/edit",good)).StatusCode);
    }
}
