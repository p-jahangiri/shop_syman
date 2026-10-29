using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Sales;
using Shop.Modules.Inventory;
using Xunit;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;
public sealed class ChequeLedgerSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>,IDisposable
{
    private WebApplicationFactory<Program>? auth;private Task<HttpClient> Staff(string role)=>base.Staff(role,auth??=sql.Factory.WithWebHostBuilder(_=>{}));public void Dispose()=>auth?.Dispose();
    private sealed record Scenario(HttpClient Customer,string Owner,JsonNode Order,JsonNode Schedule,string Variant);
    private static string V(JsonNode n,string k)=>CreditCheckoutQuoteQa.Text(n,k);
    private static string OrderId(Scenario s)=>V(s.Order["summary"]!,"id");
    private static string Base(Scenario s)=>"/api/admin/credit/orders/"+s.Owner+"/"+OrderId(s)+"/cheques";
    private static string Own(Scenario s)=>"/api/credit/orders/"+OrderId(s)+"/cheques";
    private static string Schedule(Scenario s)=>"/api/admin/credit/orders/"+s.Owner+"/"+OrderId(s)+"/schedule";
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());
            if(Environment.GetEnvironmentVariable("SHOP_CHEQUE_LEDGER_WIRE_DIR")is{Length:>0}dir&&response.RequestMessage!.RequestUri!.AbsolutePath.Contains("/cheques")){Directory.CreateDirectory(dir);var id=Id();await File.WriteAllTextAsync(Path.Combine(dir,id+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,id+".meta.json"),JsonSerializer.Serialize(new{syntheticQaOnly=true,actualSqlHttpResponse=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path=response.RequestMessage.RequestUri.PathAndQuery,cacheControl=response.Headers.CacheControl.ToString()}));}return JsonNode.Parse(raw)!;}
    }
    private async Task<Scenario> Ready(HttpClient finance,HttpClient reviewer)
    {
        using var helper=new CreditOrderSqlTests(sql);var s=await helper.Ready(finance,reviewer);var input=new CreditOrderInput(V(s.Quote,"id"),V(s.Quote,"fingerprint"),"Synthetic cheque custody QA","09100000000",new("IR","تهران","تهران","Synthetic QA only; no physical delivery","1234567890"),"No real person, bank instrument or funds",true,true);
        var created=await CreditOrderQa.Read(await s.Customer.PostAsJsonAsync("/api/credit-orders/commands/"+Id(),input));var order=created["order"]!;var orderId=V(order["summary"]!,"id");var path="/api/admin/credit/orders/"+s.Owner+"/"+orderId+"/schedule";var anchor=DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow,TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime).ToString("yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);var previewInput=new CreditSchedulePreviewInput(V(order["summary"]!,"version"),null,"Persian",anchor);var preview=await CreditScheduleQa.Read(await finance.PostAsJsonAsync(path+"/preview",previewInput));var schedule=await CreditScheduleQa.Read(await finance.PostAsJsonAsync(path+"/commands/"+Id(),new SaveCreditScheduleInput(previewInput.OrderVersion,null,"Persian",anchor,V(preview,"fingerprint"),true)));return new(s.Customer,s.Owner,order,schedule["revision"]!,s.Goods.Variant);
    }
    private static ReceiveChequeInput Receive(Scenario s,int seq=1)=>new(V(s.Order["summary"]!,"version"),V(s.Schedule,"version"),seq,"SYNTHETIC-INSTRUMENT-ONLY","Synthetic private custody note",DateTimeOffset.UtcNow,true);
    private static MoveChequeInput Move(JsonNode prior,string action,bool closed=false)=>new(V(prior["cheque"]!,"version"),action,"Synthetic event evidence only",DateTimeOffset.UtcNow,true,closed);
    private static string Cheque(JsonNode result)=>V(result["cheque"]!,"id");
    private static Task<JsonNode> MoveRead(HttpClient finance,Scenario s,JsonNode prior,string action,bool closed=false)=>ReadMove(finance,s,prior,Move(prior,action,closed));
    private static async Task<JsonNode> ReadMove(HttpClient finance,Scenario s,JsonNode prior,MoveChequeInput input)=>await Read(await finance.PostAsJsonAsync(Base(s)+"/"+Cheque(prior)+"/commands/"+Id(),input));
    [Fact]public async Task CustodyHistoryIsPrivateImmutableAndManualReportsNeverMarkTheOrderPaid()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var empty=await Read(await customer.GetAsync(Own(s)));Assert.Empty(empty["items"]!.AsArray());Assert.False(empty["canReceive"]!.GetValue<bool>());
        var result=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),Receive(s)));var first=result.DeepClone();Assert.Equal("Received",V(result["cheque"]!,"state"));Assert.Equal(V(s.Schedule["calculation"]!["lines"]![0]!,"amountRial"),V(result["cheque"]!,"amountRial"));
        var frozen=await CreditScheduleQa.Read(await finance.GetAsync(Schedule(s)));Assert.False(frozen["canAmend"]!.GetValue<bool>());Assert.Contains(frozen["blockers"]!.AsArray(),x=>x!.GetValue<string>()=="credit_schedule_instruments_recorded");using(var amend=await finance.PostAsJsonAsync(Schedule(s)+"/preview",new CreditSchedulePreviewInput(V(s.Order["summary"]!,"version"),V(s.Schedule,"version"),"Gregorian",V(s.Schedule["calculation"]!,"anchorDate"))))Assert.Equal(HttpStatusCode.Conflict,amend.StatusCode);
        foreach(var action in new[]{"Deposit","ReportBounce","Deposit","ReportCollection","CorrectCollectionReport","Withdraw","ReturnToCustomer"})result=await MoveRead(finance,s,result,action);
        Assert.Equal("ReturnedToCustomer",V(result["cheque"]!,"state"));var history=await Read(await finance.GetAsync(Base(s)+"/"+Cheque(result)+"/history"));Assert.Equal(8,history["items"]!.AsArray().Count);Assert.Equal(first["event"]!.ToJsonString(),history["items"]![7]!.ToJsonString());var detail=await Read(await finance.GetAsync(Base(s)+"/"+Cheque(result)));Assert.Equal("SYNTHETIC-INSTRUMENT-ONLY",V(detail,"instrumentReference"));Assert.Empty(detail["allowedActions"]!.AsArray());
        var own=await Read(await customer.GetAsync(Own(s)));foreach(var secret in new[]{"SYNTHETIC-INSTRUMENT-ONLY","Synthetic private custody note","actorId","instrumentReference","note"})Assert.DoesNotContain(secret,own.ToJsonString(),StringComparison.OrdinalIgnoreCase);Assert.False(own["items"]![0]!["bankVerified"]!.GetValue<bool>());Assert.False(own["canPay"]!.GetValue<bool>());Assert.False(own["canFulfill"]!.GetValue<bool>());
        await using var scope=sql.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;Assert.Equal(OrderState.AwaitingPayment,(await sp.GetRequiredService<SalesDbContext>().Orders.SingleAsync(x=>x.Id==OrderId(s))).State);Assert.Equal(1,(await sp.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==s.Variant)).Reserved);var db=sp.GetRequiredService<CreditDbContext>();var row=await db.ReceivedCheques.SingleAsync(x=>x.Id==Cheque(result));Assert.DoesNotContain("SYNTHETIC",System.Text.Encoding.UTF8.GetString(row.ProtectedRegistration));Assert.Equal(8,await db.ChequeLedgerCommands.CountAsync(x=>x.OrderId==OrderId(s)));
    }
    [Fact]public async Task SameCommandAndCompetingTransitionsSerializeAndAuditFailureRollsBackNewRecords()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var input=Receive(s);var cmd=Id();var path=Base(s)+"/receive/commands/"+cmd;
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_QA_ChequeAudit CHECK ([Action]<>'CREDIT_CHEQUE_RECEIVE')");
        try{using var failed=await finance.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_QA_ChequeAudit");}
        await using(var scope=sql.Factory.Services.CreateAsyncScope())Assert.False(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().ReceivedCheques.AnyAsync(x=>x.OrderId==OrderId(s)));
        var both=await Task.WhenAll((await Task.WhenAll(finance.PostAsJsonAsync(path,input),finance.PostAsJsonAsync(path,input))).Select(Read));Assert.Single(both,x=>x["replayed"]!.GetValue<bool>());Assert.Equal(both[0]["cheque"]!.ToJsonString(),both[1]["cheque"]!.ToJsonString());using(var duplicate=await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),input))Assert.Equal(HttpStatusCode.Conflict,duplicate.StatusCode);
        var first=both[0];var transitions=await Task.WhenAll(finance.PostAsJsonAsync(Base(s)+"/"+Cheque(first)+"/commands/"+Id(),Move(first,"Deposit")),finance.PostAsJsonAsync(Base(s)+"/"+Cheque(first)+"/commands/"+Id(),Move(first,"ReturnToCustomer")));Assert.Single(transitions,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(transitions,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var r in transitions){if(r.IsSuccessStatusCode)await Read(r);else r.Dispose();}
        using(var conflict=await finance.PostAsJsonAsync(path,input with{Note="Different payload"}))Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);
    }
    [Fact]public async Task ClosedOrdersKeepReceiptsAndRequireExplicitAcknowledgementForFurtherCustodyEvents()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var input=Receive(s);var cmd=Id();var first=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+cmd,input));await CreditOrderQa.Read(await customer.PostAsJsonAsync("/api/orders/v2/"+OrderId(s)+"/cancel",new{version=V(s.Order["summary"]!,"version")}));
        var current=await Read(await finance.GetAsync(Base(s)));Assert.False(current["canReceive"]!.GetValue<bool>());using(var closed=await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),Receive(s,2)))Assert.Equal(HttpStatusCode.Conflict,closed.StatusCode);using(var acknowledgement=await finance.PostAsJsonAsync(Base(s)+"/"+Cheque(first)+"/commands/"+Id(),Move(first,"ReturnToCustomer")))Assert.Equal(HttpStatusCode.Conflict,acknowledgement.StatusCode);
        var returned=await MoveRead(finance,s,first,"ReturnToCustomer",true);Assert.Equal("ReturnedToCustomer",V(returned["cheque"]!,"state"));var replay=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+cmd,input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["cheque"]!.ToJsonString(),replay["cheque"]!.ToJsonString());var receipt=await Read(await finance.GetAsync(Base(s)+"/commands/"+cmd));Assert.Equal(first["event"]!.ToJsonString(),receipt["event"]!.ToJsonString());
        await using var scope=sql.Factory.Services.CreateAsyncScope();Assert.Equal(0,(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==s.Variant)).Reserved);Assert.True(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().PurchaseScopeUses.AnyAsync(x=>x.OrderId==OrderId(s)));
    }
    [Fact]public async Task OnlyFinanceWithMfaSeesPrivateInstrumentDetailsAndForgedMoneyIsRejected()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");using var sales=await Staff("SalesManager");var s=await Ready(finance,reviewer);using var customer=s.Customer;
        foreach(var client in new[]{reviewer,sales,customer}){using var forbidden=await client.GetAsync(Base(s));Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);}var other=await Customer();using(var foreign=other.Client){using var missing=await foreign.GetAsync(Own(s));Assert.Equal(HttpStatusCode.NotFound,missing.StatusCode);}
        var forged=JsonSerializer.SerializeToNode(Receive(s),new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsObject();forged["amountRial"]="1";using(var bad=await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),forged))Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);using(var bad=await finance.GetAsync(Base(s)+"?ownerId=other"))Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);
        var first=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),Receive(s)));using(var privateDetail=await customer.GetAsync(Own(s)+"/"+Cheque(first)))Assert.Contains(privateDetail.StatusCode,new[]{HttpStatusCode.NotFound,HttpStatusCode.MethodNotAllowed});using(var skipped=await finance.PostAsJsonAsync(Base(s)+"/"+Cheque(first)+"/commands/"+Id(),Move(first,"ReportCollection")))Assert.Equal(HttpStatusCode.Conflict,skipped.StatusCode);
    }
    [Fact]public async Task CiphertextTamperingFailsClosedAndSqlConstraintsImmutableGuardsAndOwnDownProtectHistory()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var cmd=Id();var first=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+cmd,Receive(s)));var id=Cheque(first);
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var row=await db.ReceivedCheques.SingleAsync(x=>x.Id==id);row.AmountRial++;Assert.Equal("cheque_ledger_history_immutable",(await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync())).Code);db.ChangeTracker.Clear();var fk=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [credit].[ReceivedCheques] SET [ScheduleId]={Id()} WHERE [Id]={id}"));Assert.Equal(547,fk.Number);var newest=(await db.Database.GetAppliedMigrationsAsync()).Last();await db.GetService<IMigrator>().MigrateAsync("20261027151329_ChequeLedger");try{var history=(await db.Database.GetAppliedMigrationsAsync()).ToArray();Assert.EndsWith("_ChequeLedger",history[^1]);Assert.Equal(51000,(await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(history[^2]))).Number);Assert.Equal(history,await db.Database.GetAppliedMigrationsAsync());}finally{await db.GetService<IMigrator>().MigrateAsync(newest);}
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [credit].[ReceivedCheques] SET [ProtectedRegistration]=0x01 WHERE [Id]={id}");using(var corrupt=await customer.GetAsync(Own(s)))Assert.Equal(HttpStatusCode.ServiceUnavailable,corrupt.StatusCode);var receipt=await Read(await finance.GetAsync(Base(s)+"/commands/"+cmd));Assert.Equal(first["event"]!.ToJsonString(),receipt["event"]!.ToJsonString());
    }
    [Fact]public async Task ReceivingAndScheduleAmendmentCannotBothCommitAgainstTheSameRevision()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;
        var previewInput=new CreditSchedulePreviewInput(V(s.Order["summary"]!,"version"),V(s.Schedule,"version"),"Gregorian",V(s.Schedule["calculation"]!,"anchorDate"));var preview=await CreditScheduleQa.Read(await finance.PostAsJsonAsync(Schedule(s)+"/preview",previewInput));var change=new SaveCreditScheduleInput(previewInput.OrderVersion,previewInput.ScheduleVersion,"Gregorian",previewInput.AnchorDate,V(preview,"fingerprint"),true);
        var replies=await Task.WhenAll(finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),Receive(s)),finance.PostAsJsonAsync(Schedule(s)+"/commands/"+Id(),change));Assert.Single(replies,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(replies,r=>r.StatusCode==HttpStatusCode.Conflict);foreach(var r in replies){if(r.IsSuccessStatusCode)await Read(r);else r.Dispose();}
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var count=await db.ReceivedCheques.CountAsync(x=>x.OrderId==OrderId(s));Assert.Equal(count==1?1:2,await db.ScheduleRevisions.CountAsync(x=>x.OrderId==OrderId(s)));
    }
    [Fact]public async Task EventHistoryPagesTwentyAndFailedMoveAuditDoesNotAdvanceTheHead()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var first=await Read(await finance.PostAsJsonAsync(Base(s)+"/receive/commands/"+Id(),Receive(s)));var path=Base(s)+"/"+Cheque(first)+"/commands/"+Id();var input=Move(first,"Deposit");
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_QA_ChequeMoveAudit CHECK ([Action]<>'CREDIT_CHEQUE_MOVE')");
        try{using var failed=await finance.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_QA_ChequeMoveAudit");}
        var unchanged=await Read(await finance.GetAsync(Base(s)+"/"+Cheque(first)));Assert.Equal(first["event"]!.ToJsonString(),unchanged["current"]!.ToJsonString());var current=await Read(await finance.PostAsJsonAsync(path,input));for(var i=0;i<20;i++)current=await MoveRead(finance,s,current,i%2==0?"ReportBounce":"Deposit");
        var page=await Read(await finance.GetAsync(Base(s)+"/"+Cheque(first)+"/history"));Assert.Equal(20,page["items"]!.AsArray().Count);var next=page["nextSequence"]!.GetValue<int>();var last=await Read(await finance.GetAsync(Base(s)+"/"+Cheque(first)+"/history?beforeSequence="+next));Assert.Null(last["nextSequence"]);Assert.Equal(22,page["items"]!.AsArray().Count+last["items"]!.AsArray().Count);Assert.Equal(first["event"]!.ToJsonString(),last["items"]!.AsArray().Last()!.ToJsonString());using var bad=await finance.GetAsync(Base(s)+"/"+Cheque(first)+"/history?beforeSequence=201");Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);
    }

}
