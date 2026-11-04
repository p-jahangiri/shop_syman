using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Text;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Only this fixture's generated GUID database is changed. PublicImages below
// are synthetic Ready metadata, not an object-store/scanner acceptance claim.
public sealed class UsedInspectionPhotoSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Database.GetDbConnection().Database);return await action(scope.ServiceProvider);}
    private async Task<JsonNode> Detail(string variant)=>await OrderFixture.Json(await fixture.Admin.GetAsync("/api/admin/used-items/"+variant));
    private static string Text(JsonNode n,string name)=>n[name]!.GetValue<string>();
    private static UsedItemInspectionPhotoData Photo(string id,int position=1)=>new($"/media/catalog/{id}/card.webp","نمای "+position+" همین دستگاه","This device view "+position);
    private static UsedItemConditionData Inspection(params UsedItemInspectionPhotoData[] photos)=>new(Id(),"passed","measured",87,"intact","worn","unknown","دادهٔ آزمون؛ فاقد شخص یا شماره سریال","Synthetic SQL metadata only",DateTimeOffset.UtcNow.AddMinutes(-1),photos.Length==0?null:photos);
    private async Task<string> Asset(string state="Ready")=>await Scope(async sp=>{var id=Id();if(state=="Missing")return id;var db=sp.GetRequiredService<CatalogDbContext>();db.PublicImages.Add(new(){Id=id,Status=state,CreatedBy="synthetic-photo-fixture",OriginalSha256=new('a',64),InputBytes=1,Width=1,Height=1,Variants=PublicImagePaths.Names.Select(name=>new PublicImageVariant{AssetId=id,Name=name,Width=1,Height=1,Bytes=1,Sha256=new('b',64)}).ToList()});await db.SaveChangesAsync();return id;});
    private async Task<JsonNode> Save(string variant,UsedItemConditionData report,string? command=null,string? version=null)=>await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync($"/api/admin/used-items/{variant}/commands/{command??Id()}",new SaveUsedItemInput(version??Text(await Detail(variant),"variantVersion"),report)));
    private Task<string> State(string variant)=>Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var v=await catalog.Variants.AsNoTracking().SingleAsync(x=>x.Id==variant);var stock=await inventory.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==variant);var inspections=await catalog.Set<UsedItemInspection>().Where(x=>x.VariantId==variant).Select(x=>x.Id).ToArrayAsync();return JsonSerializer.Serialize(new{v.UsedInspectionId,VariantVersion=v.Version,Stock=stock,Inspections=inspections.Order().ToArray(),Photos=await catalog.Set<UsedItemInspectionPhoto>().Where(x=>inspections.Contains(x.InspectionId)).OrderBy(x=>x.InspectionId).ThenBy(x=>x.Position).ToArrayAsync(),Receipts=await catalog.Set<UsedItemCommand>().Where(x=>x.ResultJson.Contains(variant)).OrderBy(x=>x.CommandId).ToArrayAsync()});});

    [Fact]public async Task TwelveReadyPhotosAreOrderedVersionedPublicAndRetainedByImmutableInspection()
    {
        var item=await fixture.Product(stock:1);var ids=new List<string>();for(var i=0;i<12;i++)ids.Add(await Asset());var report=Inspection(ids.Select((id,index)=>Photo(id,index+1)).ToArray());var before=await Detail(item.Variant);var command=Id();var input=new SaveUsedItemInput(Text(before,"variantVersion"),report);var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";
        var saved=await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync(path,input));var after=await State(item.Variant);var replay=await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync(path,input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(saved["detail"]!.ToJsonString(),replay["detail"]!.ToJsonString());Assert.Equal(after,await State(item.Variant));Assert.NotEqual(Text(before,"variantVersion"),Text(saved["detail"]!,"variantVersion"));Assert.Equal(ids.Select(id=>Photo(id).Url),saved["detail"]!["inspection"]!["photos"]!.AsArray().Select(p=>Text(p!,"url")));
        using var anonymous=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});foreach(var locale in new[]{"fa","en"}){var lookup=await OrderFixture.Json(await anonymous.PostAsJsonAsync($"/api/catalog/{locale}/lookup",new{VariantIds=new[]{item.Variant}}));Assert.Contains(report.InspectionId,lookup.ToJsonString());Assert.Contains(ids[0],lookup.ToJsonString());}
        using(var changed=await fixture.Admin.PutAsJsonAsync(path,input with{Inspection=report with{Photos=report.Photos!.Reverse().ToArray()}}))Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);
        await Save(item.Variant,Inspection());var latest=await Detail(item.Variant);Assert.False(latest["inspection"]!.AsObject().ContainsKey("photos"));await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();Assert.Equal(12,await db.Set<UsedItemInspectionPhoto>().CountAsync(x=>x.InspectionId==report.InspectionId));var stock=await sp.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==item.Variant);Assert.Equal((1,0,0),(stock.OnHand,stock.Reserved,stock.SourcingReserved));Assert.False(await sp.GetRequiredService<InventoryDbContext>().Movements.AnyAsync(x=>x.VariantId==item.Variant));return true;});
    }

    [Theory][InlineData("Missing")][InlineData("Staged")][InlineData("Failed")][InlineData("Cleaning")][InlineData("Purged")]
    public async Task EveryNonReadyPhotoFailsBeforeInspectionPointerStockFlagReceiptOrAuditChanges(string status)
    {
        var item=await fixture.Product(stock:1);var asset=await Asset(status);var before=await State(item.Variant);var version=Text(await Detail(item.Variant),"variantVersion");var command=Id();var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";using var response=await fixture.Admin.PutAsJsonAsync(path,new SaveUsedItemInput(version,Inspection(Photo(asset))));Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);Assert.Contains("image_not_ready",await response.Content.ReadAsStringAsync());Assert.Equal(before,await State(item.Variant));await Scope(async sp=>{Assert.False(await sp.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(x=>x.Resource==path));return true;});
    }

    [Fact]public async Task AuditFailureRollsBackPhotoRowsSingleUnitFlagAndRevisionThenSameCommandSucceeds()
    {
        var item=await fixture.Product(stock:1);var image=await Asset();var report=Inspection(Photo(image));var version=Text(await Detail(item.Variant),"variantVersion");var command=Id();var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";var input=new SaveUsedItemInput(version,report);var before=await State(item.Variant);
        await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_UsedPhotoQaFailure] CHECK ([Action]<>'PUT')");return true;});try{using var denied=await fixture.Admin.PutAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);}finally{await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_UsedPhotoQaFailure]");return true;});}Assert.Equal(before,await State(item.Variant));Assert.False((await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync(path,input)))["replayed"]!.GetValue<bool>());
    }

    [Fact]public async Task QuoteAndOrderKeepOriginalPhotosAfterCancellationAndACompletelyDifferentCurrentGallery()
    {
        await fixture.Settings(max:2);var item=await fixture.Product(stock:1);var a=await Asset();var b=await Asset();var original=Inspection(Photo(a));await Save(item.Variant,original);var person=await fixture.Customer();using var customer=person.Client;
        async Task<JsonNode> Quote(){var cart=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));return await OrderFixture.Json(await customer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),item.Method,null,Id())));}
        CreateOrderInput Input(JsonNode quote)=>new(Text(quote,"quoteId"),Id(),"Synthetic photo customer","09121234567",new("IR","QA province","QA city","Synthetic order address only","1234567890"),null,true);
        var old=await Quote();var replacement=Inspection(Photo(b));await Save(item.Variant,replacement);using(var stale=await customer.PostAsJsonAsync("/api/orders",Input(old)))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);var quote=await Quote();Assert.Equal(Photo(b).Url,Text(quote["lines"]![0]!["usedCondition"]!["photos"]![0]!,"url"));var created=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders",Input(quote)),HttpStatusCode.Created);var order=created["order"]!;var orderId=Text(order["summary"]!,"id");await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders/"+orderId+"/cancel",new CancelOrderInput(Text(order["summary"]!,"version"))));await Save(item.Variant,Inspection(Photo(a)));
        foreach(var prefix in new[]{"/api/orders/","/api/orders/v2/"}){var history=await OrderFixture.Json(await customer.GetAsync(prefix+orderId));var snapshot=history["lines"]![0]!["usedCondition"]!;Assert.Equal(replacement.InspectionId,Text(snapshot,"inspectionId"));Assert.Equal(Photo(b).Url,Text(snapshot["photos"]![0]!,"url"));}
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();Assert.True(await db.Set<UsedItemInspectionPhoto>().AnyAsync(x=>x.InspectionId==replacement.InspectionId&&x.AssetId==b));return true;});
    }

    [Fact]public async Task PhotoForeignKeysUniquenessImmutabilityAndDownGuardProtectRetainedHistory()
    {
        var item=await fixture.Product(stock:1);var asset=await Asset();var report=Inspection(Photo(asset));await Save(item.Variant,report);
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();Assert.False(db.Database.HasPendingModelChanges());var photo=await db.Set<UsedItemInspectionPhoto>().SingleAsync(x=>x.InspectionId==report.InspectionId);photo.AltEn="changed";await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());db.ChangeTracker.Clear();photo=await db.Set<UsedItemInspectionPhoto>().SingleAsync(x=>x.InspectionId==report.InspectionId);db.Remove(photo);await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());db.ChangeTracker.Clear();
            await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [catalog].[UsedItemInspectionPhotos] SET [Position]=13 WHERE [InspectionId]={report.InspectionId}"));await Assert.ThrowsAsync<SqlException>(()=>db.PublicImages.Where(x=>x.Id==asset).ExecuteDeleteAsync());
            var missing=Id();await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [catalog].[UsedItemInspectionPhotos] SET [AssetId]={missing} WHERE [InspectionId]={report.InspectionId}"));
            var duplicate=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO [catalog].[UsedItemInspectionPhotos] ([InspectionId],[Position],[AssetId],[AltFa],[AltEn]) VALUES ({report.InspectionId},2,{asset},N'نما',N'View')"));Assert.Contains(duplicate.Number,new[]{2601,2627});
            var migrations=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var own=Array.FindIndex(migrations,x=>x.EndsWith("_UsedInspectionPhotos",StringComparison.Ordinal));Assert.True(own>0);var migrator=db.GetService<IMigrator>();try{await migrator.MigrateAsync(migrations[own]);var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(migrations[own-1]));Assert.Equal(51000,error.Number);Assert.True(await db.Set<UsedItemInspectionPhoto>().AnyAsync(x=>x.InspectionId==report.InspectionId));}finally{await db.Database.MigrateAsync();}return true;});
    }
    [Fact]public async Task MaximumCompletePhotoReportPersistsBeyondAdvisoryLengthAndFitsActualQuoteAndOrderResponses()
    {
        await fixture.Settings(max:2);var item=await fixture.Product(stock:1);var photos=new List<UsedItemInspectionPhotoData>();for(var i=0;i<12;i++)photos.Add(Photo(await Asset())with{AltFa=new string('<',160),AltEn=new string('آ',160)});var report=Inspection(photos.ToArray())with{NotesFa=new string('<',2000),NotesEn=new string('آ',2000)};var command=Id();var version=Text(await Detail(item.Variant),"variantVersion");
        using(var response=await fixture.Admin.PutAsJsonAsync($"/api/admin/used-items/{item.Variant}/commands/{command}",new SaveUsedItemInput(version,report))){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.StatusCode==HttpStatusCode.OK,System.Text.Encoding.UTF8.GetString(bytes));Assert.InRange(bytes.Length,1,65536);var value=JsonNode.Parse(bytes)!;Assert.Equal(report.NotesFa,Text(value["detail"]!["inspection"]!,"notesFa"));Assert.Equal(12,value["detail"]!["inspection"]!["photos"]!.AsArray().Count);}
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var receipt=await db.Set<UsedItemCommand>().SingleAsync(x=>x.CommandId==command);Assert.True(receipt.ResultJson.Length>16000);Assert.True(System.Text.Encoding.UTF8.GetByteCount(receipt.ResultJson)<65536);var utf16=await db.Database.SqlQuery<long>($"SELECT DATALENGTH([ResultJson]) AS [Value] FROM [catalog].[UsedItemCommands] WHERE [CommandId]={command}").SingleAsync();Assert.Equal(System.Text.Encoding.Unicode.GetByteCount(receipt.ResultJson),utf16);return true;});
        var person=await fixture.Customer();using var customer=person.Client;var cart=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));JsonNode quote;
        using(var response=await customer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),item.Method,null,Id()))){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.IsSuccessStatusCode,System.Text.Encoding.UTF8.GetString(bytes));Assert.True(bytes.Length<524288);quote=JsonNode.Parse(bytes)!;}
        using(var response=await customer.PostAsJsonAsync("/api/orders",new CreateOrderInput(Text(quote,"quoteId"),Id(),"Synthetic maximum photo report","09121234567",new("IR","QA province","QA city","Synthetic order address only","1234567890"),null,true))){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.StatusCode==HttpStatusCode.Created,System.Text.Encoding.UTF8.GetString(bytes));Assert.True(bytes.Length<1048576);var value=JsonNode.Parse(bytes)!;Assert.Equal(report.NotesEn,Text(value["order"]!["lines"]![0]!["usedCondition"]!,"notesEn"));Assert.Equal(12,value["order"]!["lines"]![0]!["usedCondition"]!["photos"]!.AsArray().Count);}
    }
    [Fact]public async Task StoredPreGalleryPascalCaseQuoteReplaysAndCreatesOrderWithItsExactOriginalSnapshot()
    {
        await fixture.Settings(max:2);var item=await fixture.Product(stock:1);var report=Inspection();await Save(item.Variant,report);var person=await fixture.Customer();using var customer=person.Client;var cart=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));var quoteInput=new CheckoutQuoteInput(Text(cart,"version"),item.Method,null,Id());var quote=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/cart/en/quote",quoteInput));var quoteId=Text(quote,"quoteId");
        var legacy=new LegacyCondition(report.InspectionId,report.TechnicalState,report.BatteryState,report.BatteryHealthPercent,report.ScreenState,report.BodyState,report.RepairState,report.NotesFa,report.NotesEn,report.InspectedAt);var oldConditionJson=JsonSerializer.Serialize(legacy,new JsonSerializerOptions{NumberHandling=System.Text.Json.Serialization.JsonNumberHandling.WriteAsString});
        var savedSnapshot=await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var stored=await db.Quotes.AsNoTracking().SingleAsync(x=>x.Id==quoteId);using var parsed=JsonDocument.Parse(stored.ResponseJson);Assert.Equal(oldConditionJson,parsed.RootElement.GetProperty("Lines")[0].GetProperty("UsedCondition").GetRawText());Assert.DoesNotContain("Photos",stored.ResponseJson,StringComparison.OrdinalIgnoreCase);var oldSnapshot=stored.ResponseJson.Replace(parsed.RootElement.GetProperty("Lines")[0].GetProperty("UsedCondition").GetRawText(),oldConditionJson,StringComparison.Ordinal);await db.Quotes.Where(x=>x.Id==quoteId).ExecuteUpdateAsync(set=>set.SetProperty(x=>x.ResponseJson,oldSnapshot));return oldSnapshot;});
        var replay=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/cart/en/quote",quoteInput));Assert.Equal(quote.ToJsonString(),replay.ToJsonString());Assert.False(replay["lines"]![0]!["usedCondition"]!.AsObject().ContainsKey("photos"));var created=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders",new CreateOrderInput(quoteId,Id(),"Synthetic old quote customer","09121234567",new("IR","QA province","QA city","Synthetic legacy quote address","1234567890"),null,true)),HttpStatusCode.Created);var orderId=Text(created["order"]!["summary"]!,"id");
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Equal(savedSnapshot,(await db.Orders.SingleAsync(x=>x.Id==orderId)).QuoteSnapshotJson);Assert.False(await sp.GetRequiredService<CatalogDbContext>().Set<UsedItemInspectionPhoto>().AnyAsync(x=>x.InspectionId==report.InspectionId));return true;});foreach(var prefix in new[]{"/api/orders/","/api/orders/v2/"}){var history=await OrderFixture.Json(await customer.GetAsync(prefix+orderId));var historical=history["lines"]![0]!["usedCondition"]!;Assert.Equal(report.InspectionId,Text(historical,"inspectionId"));Assert.False(historical.AsObject().ContainsKey("photos"));}
    }

    // Exact pre-gallery serializer contract copied from the original DTO shape.
    // Do not compute the legacy fingerprint/receipt from the new Photos DTO.
    private sealed record LegacyCondition(string InspectionId,string TechnicalState,string BatteryState,int? BatteryHealthPercent,string ScreenState,string BodyState,string RepairState,string NotesFa,string NotesEn,DateTimeOffset InspectedAt);
    private sealed record LegacyInput(string VariantVersion,LegacyCondition Inspection);
    private sealed record LegacyDetail(int SchemaVersion,string VariantId,string ProductId,string Sku,string VariantVersion,LegacyCondition? Inspection);
    private sealed record LegacyResult(int SchemaVersion,bool Replayed,LegacyDetail Detail);
    [Fact]public async Task PreGalleryCommandHashAndReceiptReplayWithStaleVersionWithoutRewritingCurrentPhotosOrHistory()
    {
        var item=await fixture.Product(stock:1);var before=await Detail(item.Variant);var original=Inspection();var saved=await Save(item.Variant,original);var old=new LegacyCondition(original.InspectionId,original.TechnicalState,original.BatteryState,original.BatteryHealthPercent,original.ScreenState,original.BodyState,original.RepairState,original.NotesFa,original.NotesEn,original.InspectedAt);var input=new LegacyInput(Text(before,"variantVersion"),old);var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);var command=Id();var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";var actor=new JwtSecurityTokenHandler().ReadJwtToken(fixture.Admin.DefaultRequestHeaders.Authorization!.Parameter).Subject;
        var result=new LegacyResult(1,false,new LegacyDetail(1,item.Variant,Text(saved["detail"]!,"productId"),Text(saved["detail"]!,"sku"),Text(saved["detail"]!,"variantVersion"),old));var payload=JsonSerializer.Serialize(new{VariantId=item.Variant,Input=input},options);var legacyJson=JsonSerializer.Serialize(result,options);Assert.DoesNotContain("photos",payload,StringComparison.OrdinalIgnoreCase);Assert.DoesNotContain("photos",legacyJson,StringComparison.OrdinalIgnoreCase);
        await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();catalog.Add(new UsedItemCommand{ActorId=actor,CommandId=command,PayloadHash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))),ResultJson=legacyJson,At=DateTimeOffset.UtcNow});await catalog.SaveChangesAsync();var identity=sp.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="PUT",Resource=path,TraceId="synthetic-pre-gallery-history"});await identity.SaveChangesAsync();return true;});
        var newer=Inspection(Photo(await Asset()));await Save(item.Variant,newer);var state=await State(item.Variant);var auditBefore=await Scope(sp=>sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Resource==path));using(var response=await fixture.Admin.PutAsJsonAsync(path,input)){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,raw);using var actual=JsonDocument.Parse(raw);using var expected=JsonDocument.Parse(legacyJson);Assert.True(actual.RootElement.GetProperty("replayed").GetBoolean());Assert.True(JsonElement.DeepEquals(expected.RootElement.GetProperty("detail"),actual.RootElement.GetProperty("detail")));Assert.False(actual.RootElement.GetProperty("detail").GetProperty("inspection").TryGetProperty("photos",out _));}
        // A replay preserves business state; the existing generic filter separately audits this authorized HTTP request.
        Assert.Equal(state,await State(item.Variant));Assert.Equal(auditBefore+1,await Scope(sp=>sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Resource==path)));await Scope(async sp=>{var audits=await sp.GetRequiredService<IdentityDbContext>().Audit.Where(x=>x.Resource==path).ToArrayAsync();Assert.All(audits,a=>{Assert.Equal(actor,a.ActorId);Assert.Equal("PUT",a.Action);Assert.Equal(path,a.Resource);});return true;});var current=await Detail(item.Variant);Assert.Equal(newer.InspectionId,Text(current["inspection"]!,"inspectionId"));Assert.Single(current["inspection"]!["photos"]!.AsArray());
    }
}

// A separate, freshly generated fixture keeps the photo table empty independently
// of other gallery tests. Every old table, key/index shape and complete row set
// is fingerprinted; only the new migration's own history row is excluded.
public sealed class UsedInspectionPhotoMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string GalleryMigration="20261030160000_UsedInspectionPhotos";
    private sealed record TableProof(string Columns,string Indexes,string RowsSha256,int RowCount);
    private static string Quote(string name)=>"["+name.Replace("]","]]",StringComparison.Ordinal)+"]";
    private async Task<Dictionary<string,TableProof>> OldTables(CatalogDbContext db)
    {
        Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        var connection=db.Database.GetDbConnection();await connection.OpenAsync();
        try{
            var tables=new List<(string Schema,string Name)>();
            await using(var command=connection.CreateCommand()){
                command.CommandText="SELECT s.[name],t.[name] FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE t.is_ms_shipped=0 AND NOT(s.[name]='catalog' AND t.[name]='UsedItemInspectionPhotos') ORDER BY s.[name],t.[name]";
                await using var rows=await command.ExecuteReaderAsync();while(await rows.ReadAsync())tables.Add((rows.GetString(0),rows.GetString(1)));
            }
            Assert.Contains(("catalog", "UsedItemInspections"), tables);
            Assert.Contains(("inventory", "Stock"), tables);
            var result=new Dictionary<string,TableProof>(StringComparer.Ordinal);
            foreach(var table in tables){
                var qualified=Quote(table.Schema)+"."+Quote(table.Name);var keys=new List<string>();
                await using(var command=connection.CreateCommand()){
                    command.CommandText="SELECT c.[name] FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(@table) AND i.is_primary_key=1 ORDER BY ic.key_ordinal";var parameter=command.CreateParameter();parameter.ParameterName="@table";parameter.Value=qualified;command.Parameters.Add(parameter);await using var rows=await command.ExecuteReaderAsync();while(await rows.ReadAsync())keys.Add(rows.GetString(0));
                }
                Assert.NotEmpty(keys);
                async Task<string> Json(string sql,bool objectParameter=false){await using var command=connection.CreateCommand();command.CommandTimeout=30;command.CommandText=sql;if(objectParameter){var parameter=command.CreateParameter();parameter.ParameterName="@table";parameter.Value=qualified;command.Parameters.Add(parameter);}var text=new StringBuilder();await using var rows=await command.ExecuteReaderAsync();while(await rows.ReadAsync())if(!rows.IsDBNull(0))text.Append(rows.GetString(0));return text.Length==0?"[]":text.ToString();}
                var columns=await Json("SELECT c.[name],TYPE_NAME(c.user_type_id) AS [type],c.max_length,c.[precision],c.scale,c.is_nullable,c.is_identity,c.is_computed FROM sys.columns c WHERE c.object_id=OBJECT_ID(@table) ORDER BY c.column_id FOR JSON PATH,INCLUDE_NULL_VALUES",true);
                var indexes=await Json("SELECT i.[name],i.is_primary_key,i.is_unique,i.is_unique_constraint,i.[type],ic.key_ordinal,ic.is_descending_key,ic.is_included_column,c.[name] AS [column] FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(@table) ORDER BY i.index_id,ic.index_column_id FOR JSON PATH,INCLUDE_NULL_VALUES",true);
                var where=table.Schema=="catalog"&&table.Name=="__EFMigrationsHistory"?" WHERE [MigrationId]<>'"+GalleryMigration+"'":"";
                var json=await Json("SELECT * FROM "+qualified+where+" ORDER BY "+string.Join(",",keys.Select(Quote))+" FOR JSON PATH,INCLUDE_NULL_VALUES");
                using var parsed=JsonDocument.Parse(json);result.Add(qualified,new(columns,indexes,Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))),parsed.RootElement.GetArrayLength()));
            }
            return result;
        }finally{await connection.CloseAsync();}
    }
    [Fact]public async Task EmptyUpgradeAndRollbackPreserveEveryOtherTableRowsAndKeys()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(db.Database.HasPendingModelChanges());Assert.Empty(await db.Set<UsedItemInspectionPhoto>().ToArrayAsync());var migrations=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var index=Array.IndexOf(migrations,GalleryMigration);Assert.True(index>0);var previous=migrations[index-1];var migrator=db.GetService<IMigrator>();
        try{
            await migrator.MigrateAsync(GalleryMigration);
            var baseline=await OldTables(db);
            foreach(var target in new[]{previous,GalleryMigration,previous,GalleryMigration}){await migrator.MigrateAsync(target);var after=await OldTables(db);Assert.Equal(baseline.Count,after.Count);foreach(var table in baseline)Assert.Equal(table.Value,after[table.Key]);}
        }
        finally{await db.Database.MigrateAsync();}
        Assert.Empty(await db.Set<UsedItemInspectionPhoto>().ToArrayAsync());Assert.False(db.Database.HasPendingModelChanges());Assert.Equal(migrations,await db.Database.GetAppliedMigrationsAsync());
    }
}
