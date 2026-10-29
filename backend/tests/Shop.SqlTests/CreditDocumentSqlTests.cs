using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;

public sealed class CreditDocumentSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>
{
    private static byte[] Document(string suffix="one")=>Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic credit QA only. "+suffix+"\n%%EOF\n");
    private WebApplicationFactory<Program> Factory(PrivateFileSqlTests.Store store,IPrivateFileScanner? scanner=null)=>sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IPrivateFileStore>();s.AddSingleton<IPrivateFileStore>(store);s.RemoveAll<IPrivateFileScanner>();s.AddSingleton(scanner??new PrivateFileSqlTests.Scan());}));
    private async Task<HttpClient> Customer(WebApplicationFactory<Program> factory)
    {
        var person=await Customer();using var original=person.Client;var client=factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Authorization=original.DefaultRequestHeaders.Authorization;client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");return client;
    }
    private async Task<HttpClient> Staff(WebApplicationFactory<Program> factory,string role)
    {
        await using var scope=factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="docstaff"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);var client=factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");var pending=await Read(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=name,Password=sql.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",Value(pending,"accessToken"));using(var denied=await client.GetAsync($"/api/admin/credit/applications/{Id()}/documents"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);var setup=await Read(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));client.DefaultRequestHeaders.Authorization=new("Bearer",Value(setup,"accessToken"));var signed=await Read(await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(Value(setup,"secret"),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));client.DefaultRequestHeaders.Authorization=new("Bearer",Value(signed,"accessToken"));return client;
    }
    private async Task<JsonNode> Consented(HttpClient customer,HttpClient finance)
    {
        var published=await Publish(finance,Content("private-document"));var app=await Draft(customer);return await Read(await customer.PostAsJsonAsync($"/api/credit/applications/{Value(app,"id")}/consents/{Id()}",Acceptance(app,published["current"]!)));
    }
    private static MultipartFormDataContent Form(JsonNode accepted,string? replacement=null,byte[]? bytes=null,string? version=null,string? key=null,string filename="مدرک ساختگی.pdf")
    {
        bytes??=Document();var form=new MultipartFormDataContent();foreach(var (k,v)in new Dictionary<string,string>{["version"]=version??Value(accepted["application"]!,"version"),["consentId"]=Value(accepted["consent"]!,"id"),["requirementsRevisionId"]=Value(accepted["consent"]!["requirements"]!,"id"),["documentKey"]=key??"sample-proof",["replacesFileId"]=replacement??"",["sha256"]=PrivateFileRules.Hash(bytes)})form.Add(new StringContent(v),k);var file=new ByteArrayContent(bytes);file.Headers.ContentType=new("application/pdf");form.Add(file,"file",filename);return form;
    }
    private static string Base(JsonNode accepted)=>"/api/credit/applications/"+Value(accepted["application"]!,"id")+"/documents";
    private static async Task<JsonNode> Wire(HttpResponseMessage response,string name)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");if(Environment.GetEnvironmentVariable("SHOP_CREDIT_DOCUMENT_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(Path.Combine(dir,name+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,name+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,storeAndScannerAreTestCaptures=true,status=(int)response.StatusCode,method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,cacheControl=response.Headers.CacheControl?.ToString(),robots=response.Headers.TryGetValues("X-Robots-Tag",out var robot)?robot.Single():null,contentType=response.Content.Headers.ContentType?.ToString()}));}return JsonNode.Parse(raw)!;}
    }
    [Fact]public async Task ExactConsentDocumentsCanBeExplicitlyReplacedWhileOriginalFilesAndReceiptsRemainPrivateHistoricalFacts()
    {
        var store=new PrivateFileSqlTests.Store();using var factory=Factory(store);using var finance=await Staff(factory,"FinanceManager");using var reviewer=await Staff(factory,"CreditReviewer");using var customer=await Customer(factory);var accepted=await Consented(customer,finance);var id=Value(accepted["application"]!,"id");var path=Base(accepted);var command=Id();JsonNode first;
        if(Environment.GetEnvironmentVariable("SHOP_CREDIT_DOCUMENT_WIRE_DIR")is{Length:>0}wire){Directory.CreateDirectory(wire);await File.WriteAllTextAsync(Path.Combine(wire,"attached-command.json"),JsonSerializer.Serialize(new{id=command,applicationId=id,body=new{version=Value(accepted["application"]!,"version"),consentId=Value(accepted["consent"]!,"id"),requirementsRevisionId=Value(accepted["consent"]!["requirements"]!,"id"),documentKey="sample-proof",replacesFileId=(string?)null},file=new{filename="مدرک ساختگی.pdf",contentType="application/pdf",bytes=Document().Length,sha256=PrivateFileRules.Hash(Document())}},CreditRequirementsRules.Json));}

        using(var form=Form(accepted))first=await Wire(await customer.PostAsync(path+"/commands/"+command,form),"attached");Assert.Equal("Draft",Value(first["application"]!,"state"));Assert.Equal("9007199254740993",Value(first["application"]!,"requestedAmountRial"));Assert.NotEqual(Value(accepted["application"]!,"version"),Value(first["application"]!,"version"));var fileId=Value(first["attachment"]!,"id");
        using(var form=Form(accepted)){var replay=await Wire(await customer.PostAsync(path+"/commands/"+command,form),"replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["attachment"]!.ToJsonString(),replay["attachment"]!.ToJsonString());}
        using(var form=Form(accepted,version:Value(first["application"]!,"version"))){using var missingExplicitReplacement=await customer.PostAsync(path+"/commands/"+Id(),form);Assert.Equal(HttpStatusCode.Conflict,missingExplicitReplacement.StatusCode);}
        JsonNode second;using(var form=Form(accepted,fileId,Document("two"),Value(first["application"]!,"version")))second=await Wire(await customer.PostAsync(path+"/commands/"+Id(),form),"replaced");Assert.Equal(fileId,Value(second["attachment"]!,"replacesFileId"));
        var page=await Wire(await customer.GetAsync(path),"customer-page");Assert.Equal(2,page["items"]!.AsArray().Count);Assert.Single(page["items"]!.AsArray(),x=>x!["isCurrent"]!.GetValue<bool>());Assert.True(page["canUpload"]!.GetValue<bool>());Assert.DoesNotContain("protected",page.ToJsonString(),StringComparison.OrdinalIgnoreCase);Assert.DoesNotContain("sha256",page.ToJsonString(),StringComparison.OrdinalIgnoreCase);
        var review=await Wire(await reviewer.GetAsync(path.Replace("/api/credit/","/api/admin/credit/")),"reviewer-page");Assert.False(review["canUpload"]!.GetValue<bool>());
        foreach(var(client,prefix)in new[]{(customer,"/api/credit"),(reviewer,"/api/admin/credit")})using(var response=await client.GetAsync($"{prefix}/applications/{id}/documents/files/{fileId}")){Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Equal(Document(),await response.Content.ReadAsByteArrayAsync());Assert.Equal("attachment",response.Content.Headers.ContentDisposition!.DispositionType);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Contains("sandbox",response.Headers.GetValues("Content-Security-Policy").Single());}
        await Read(await customer.PutAsJsonAsync($"/api/credit/applications/{id}/cancel/{Id()}",new CancelCreditApplicationInput(Value(second["application"]!,"version"))));var cancelled=await Wire(await customer.GetAsync(path),"cancelled-page");Assert.False(cancelled["canUpload"]!.GetValue<bool>());var receipt=await Wire(await customer.GetAsync(path+"/commands/"+command),"historical-receipt");Assert.Equal("Draft",Value(receipt["application"]!,"state"));Assert.True(receipt["replayed"]!.GetValue<bool>());Assert.Equal(first["attachment"]!.ToJsonString(),receipt["attachment"]!.ToJsonString());
        await using var scope=factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Equal(2,await db.DocumentAttachments.CountAsync(x=>x.ApplicationId==id));Assert.Equal(2,await db.DocumentCommands.CountAsync(x=>x.ApplicationId==id));Assert.Equal(5,await db.ApplicationEvents.CountAsync(x=>x.ApplicationId==id));Assert.Empty(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.ToArrayAsync());Assert.Equal(2,store.Objects.Count);
    }
    [Fact]public async Task ForeignOwnersPolicyManagersAndInjectedMetadataCannotAccessOrAttachDocuments()
    {
        var store=new PrivateFileSqlTests.Store();using var factory=Factory(store);using var finance=await Staff(factory,"FinanceManager");using var reviewer=await Staff(factory,"CreditReviewer");using var customer=await Customer(factory);using var other=await Customer(factory);var accepted=await Consented(customer,finance);var path=Base(accepted);var command=Id();JsonNode uploaded;using(var form=Form(accepted))uploaded=await Read(await customer.PostAsync(path+"/commands/"+command,form));var fileId=Value(uploaded["attachment"]!,"id");
        foreach(var suffix in new[]{"","/files/"+fileId,"/commands/"+command})using(var denied=await other.GetAsync(path+suffix))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);
        using(var form=Form(accepted)){using var denied=await other.PostAsync(path+"/commands/"+Id(),form);Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);}
        foreach(var client in new[]{finance})using(var denied=await client.GetAsync(path.Replace("/api/credit/","/api/admin/credit/")))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        using(var form=Form(accepted)){using var denied=await reviewer.PostAsync(path.Replace("/api/credit/","/api/admin/credit/")+"/commands/"+Id(),form);Assert.Contains(denied.StatusCode,new[]{HttpStatusCode.NotFound,HttpStatusCode.MethodNotAllowed});}
        using(var form=Form(accepted,filename:"changed.pdf")){using var denied=await customer.PostAsync(path+"/commands/"+command,form);Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);}
        using(var form=Form(accepted)){form.Add(new StringContent("forged"),"ownerId");using var denied=await customer.PostAsync(path+"/commands/"+Id(),form);Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);}
        using(var denied=await customer.GetAsync(path+"?ownerId=forged"))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);
        customer.DefaultRequestHeaders.Range=new(0,5);using(var denied=await customer.GetAsync(path+"/files/"+fileId))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);customer.DefaultRequestHeaders.Range=null;customer.DefaultRequestHeaders.Remove("Origin");customer.DefaultRequestHeaders.Add("Origin","https://wrong.example");using(var denied=await customer.GetAsync(path+"/files/"+fileId))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);Assert.Single(store.Objects);
    }
    [Fact]public async Task AuditFailureRollsBackAttachmentCaseVersionEventReceiptAndFileTransitionButPreparedCiphertextCanBeRecovered()
    {
        var store=new PrivateFileSqlTests.Store();using var factory=Factory(store);using var finance=await Staff(factory,"FinanceManager");using var customer=await Customer(factory);var accepted=await Consented(customer,finance);var path=Base(accepted);var command=Id();var id=Value(accepted["application"]!,"id");
        await using(var scope=factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<IdentityContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_CreditDocumentAuditFailure CHECK ([Action]<>'CREDIT_DOCUMENT_ATTACH')");}
        try{using var form=Form(accepted);using var failed=await customer.PostAsync(path+"/commands/"+command,form);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_CreditDocumentAuditFailure");}
        await using(var scope=factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Equal(Value(accepted["application"]!,"version"),Convert.ToBase64String((await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id)).Version));Assert.Empty(await db.DocumentAttachments.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Empty(await db.DocumentCommands.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal(2,await db.ApplicationEvents.CountAsync(x=>x.ApplicationId==id));Assert.Equal("Stored",(await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.ResourceId==id)).State);}
        using(var form=Form(accepted))await Read(await customer.PostAsync(path+"/commands/"+command,form));using(var form=Form(accepted)){var replay=await Read(await customer.PostAsync(path+"/commands/"+command,form));Assert.True(replay["replayed"]!.GetValue<bool>());}Assert.Single(store.Objects);
    }
    [Fact]public async Task LostObjectAcknowledgementAndConcurrentSameCommandRecoverOneAttachmentWithoutDuplicateAudit()
    {
        var store=new PrivateFileSqlTests.Store{LoseNextAcknowledgement=1};using var factory=Factory(store);using var finance=await Staff(factory,"FinanceManager");using var customer=await Customer(factory);var accepted=await Consented(customer,finance);var path=Base(accepted)+"/commands/"+Id();var id=Value(accepted["application"]!,"id");
        using(var form=Form(accepted)){using var lost=await customer.PostAsync(path,form);Assert.Equal(HttpStatusCode.ServiceUnavailable,lost.StatusCode);}using(var missing=await customer.GetAsync(path))Assert.Equal(HttpStatusCode.NotFound,missing.StatusCode);
        using(var form=Form(accepted,bytes:Document("changed"))){using var conflict=await customer.PostAsync(path,form);Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);}
        async Task<HttpResponseMessage> Post(){using var form=Form(accepted);return await customer.PostAsync(path,form);}var results=new List<JsonNode>();foreach(var response in await Task.WhenAll(Post(),Post())){if(response.StatusCode==HttpStatusCode.ServiceUnavailable){response.Dispose();results.Add(await Read(await Post()));}else results.Add(await Read(response));}Assert.Single(results,x=>x["replayed"]!.GetValue<bool>());Assert.Single(results,x=>!x["replayed"]!.GetValue<bool>());Assert.Equal(results[0]["attachment"]!.ToJsonString(),results[1]["attachment"]!.ToJsonString());Assert.Single(store.Objects);
        await using var scope=factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Single(await db.DocumentAttachments.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Single(await db.DocumentCommands.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal(3,await db.ApplicationEvents.CountAsync(x=>x.ApplicationId==id));Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.CountAsync(x=>x.Action=="CREDIT_DOCUMENT_ATTACH"&&x.Resource==path));
    }
    [Fact]public async Task ChangedPublishedRequirementsDuringScanningCannotAttachToTheOldConsentOrSilentlyReuseItsDocuments()
    {
        var store=new PrivateFileSqlTests.Store();var scanner=new GateScan();using var factory=Factory(store,scanner);using var finance=await Staff(factory,"FinanceManager");using var customer=await Customer(factory);var accepted=await Consented(customer,finance);var id=Value(accepted["application"]!,"id");var path=Base(accepted);var command=Id();
        using var form=Form(accepted);var pending=customer.PostAsync(path+"/commands/"+command,form);await scanner.Started.Task.WaitAsync(TimeSpan.FromSeconds(15));JsonNode published;try{published=await Publish(finance,Content("new-during-scan"));}finally{scanner.Release.TrySetResult();}using(var conflict=await pending)Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);
        var page=await Wire(await customer.GetAsync(path),"stale-consent-page");Assert.False(page["canUpload"]!.GetValue<bool>());Assert.Contains("credit_current_consent_required",page["blockers"]!.AsArray().Select(x=>x!.GetValue<string>()));Assert.Empty(page["items"]!.AsArray());
        await using(var scope=factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Empty(await db.DocumentAttachments.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal("Stored",(await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.ResourceId==id)).State);}
        var newConsent=await Read(await customer.PostAsJsonAsync($"/api/credit/applications/{id}/consents/{Id()}",Acceptance(accepted["application"]!,published["current"]!)));using(var stale=Form(accepted)){using var conflict=await customer.PostAsync(path+"/commands/"+command,stale);Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);}using(var fresh=Form(newConsent))await Read(await customer.PostAsync(path+"/commands/"+Id(),fresh));Assert.Equal(2,store.Objects.Count);
    }
    [Fact]public async Task DocumentDefinitionsDisabledStorageAndCompositeForeignKeysFailClosedWithoutSubmissionOrPartialDowngrade()
    {
        var store=new PrivateFileSqlTests.Store();using var factory=Factory(store);using var finance=await Staff(factory,"FinanceManager");using var customer=await Customer(factory);var accepted=await Consented(customer,finance);var path=Base(accepted);var id=Value(accepted["application"]!,"id");
        using(var bad=Form(accepted,key:"not-defined")){using var denied=await customer.PostAsync(path+"/commands/"+Id(),bad);Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);}store.Configured=false;var disabled=await Wire(await customer.GetAsync(path),"disabled-page");Assert.False(disabled["configured"]!.GetValue<bool>());Assert.False(disabled["canUpload"]!.GetValue<bool>());using(var form=Form(accepted)){using var denied=await customer.PostAsync(path+"/commands/"+Id(),form);Assert.Equal(HttpStatusCode.ServiceUnavailable,denied.StatusCode);}store.Configured=true;
        JsonNode uploaded;using(var form=Form(accepted))uploaded=await Read(await customer.PostAsync(path+"/commands/"+Id(),form));var other=await Draft(customer);var otherId=Value(other,"id");var fileId=Value(uploaded["attachment"]!,"id");
        await using(var scope=factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var failure=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [credit].[DocumentAttachments] SET [ApplicationId]={otherId} WHERE [Id]={fileId}"));Assert.Equal(547,failure.Number);var migrationSource=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var downgrade=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261026223832_VersionedCreditRequirements"));Assert.Equal(51000,downgrade.Number);await db.Database.MigrateAsync();Assert.Equal(migrationSource,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());Assert.Single(await db.DocumentAttachments.Where(x=>x.ApplicationId==id).ToArrayAsync());}
        var detail=await Read(await customer.GetAsync("/api/credit/applications/"+id));Assert.False(detail["canSubmit"]!.GetValue<bool>());Assert.Single(store.Objects);
    }
    private sealed class GateScan:IPrivateFileScanner
    {
        public bool Configured=>true;public readonly TaskCompletionSource Started=new(TaskCreationOptions.RunContinuationsAsynchronously);public readonly TaskCompletionSource Release=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task ScanAsync(ReadOnlyMemory<byte> bytes,CancellationToken ct){Started.TrySetResult();await Release.Task.WaitAsync(ct);}
    }
}
