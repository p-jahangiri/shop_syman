using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class CreditClearanceSqlTests
{
    private static string DigitalPath(Scenario s)=>$"/api/admin/orders/{s.Owner}/{s.Id}/fulfillment/digital";
    private static async Task<AdminDigitalDeliveryPage> DigitalPage(HttpClient staff,Scenario s)=>JsonSerializer.Deserialize<AdminDigitalDeliveryPage>((await Read(await staff.GetAsync(DigitalPath(s)))).ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    private static DigitalDeliveryInput DigitalInput(AdminDigitalDeliveryPage p)=>new(p.OwnerId,Id(),p.OrderVersion,p.InventoryFingerprint??new string('A',64),"Synthetic credit digital entitlement only",true,[new(p.Lines[0].LineKey,["SYNTHETIC-CREDIT-DIGITAL-CODE"])]);
    private static async Task<DigitalDeliveryResult> DigitalWrite(HttpClient staff,Scenario s,DigitalDeliveryInput input)=>JsonSerializer.Deserialize<DigitalDeliveryResult>((await Read(await staff.PostAsJsonAsync(DigitalPath(s)+"/commands/"+input.CommandId,input))).ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    [Fact]public async Task NonzeroUpfrontAndEveryChequeNeedCurrentFinanceAuthorityForEachIrreversibleDigitalHandoff()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");using var warehouse=await Staff("Administrator");var s=await Ready(finance,reviewer,quantity:2,digital:true);using var customer=s.Customer;
        var original=await CreditOrderQa.Read(await customer.GetAsync("/api/credit-orders/"+s.Id));var upfront=await Read(await finance.GetAsync(Base(s)+"/upfront"));Assert.NotEqual("0",V(upfront,"requiredAmountRial"));var before=await DigitalPage(warehouse,s);Assert.False(before.CanDeliver);Assert.Null(before.InventoryFingerprint);Assert.False(before.CreditAuthorized);var initial=DigitalInput(before);using(var denied=await warehouse.PostAsJsonAsync(DigitalPath(s)+"/commands/"+initial.CommandId,initial))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        await Write(finance,s,await Page(finance,s));var input=DigitalInput(await DigitalPage(warehouse,s));var first=await DigitalWrite(warehouse,s,input);var current=await Page(finance,s);Assert.Equal("CreditApproved",V(current,"orderState"));Assert.Equal("dispatched",V(current,"shipmentState"));Assert.True(current["canRevoke"]!.GetValue<bool>());Assert.Equal("Allocated",V(current,"reservationState"));
        upfront=await Read(await finance.GetAsync(Base(s)+"/upfront"));Assert.False(upfront["canRevoke"]!.GetValue<bool>());Assert.False(upfront["canConfirmReceipt"]!.GetValue<bool>());var up=JsonSerializer.Deserialize<CreditUpfrontPage>(upfront.ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;using(var denied=await finance.PostAsJsonAsync(Base(s)+"/upfront/commands/"+Id(),new CreditUpfrontInput("RevokeConfirmation",up.OrderVersion,up.ScheduleVersion!,up.Current!.Version,"","Synthetic forbidden post-digital upfront correction",DateTimeOffset.UtcNow,true,false,true)))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var cheque=s.Cheques[0];var moved=await Read(await finance.PostAsJsonAsync(Base(s)+"/cheques/"+V(cheque,"id")+"/commands/"+Id(),new MoveChequeInput(V(cheque,"ledgerVersion"),"Deposit","Synthetic custody change after partial digital handoff",DateTimeOffset.UtcNow,true,true)));current=await Page(finance,s);Assert.False(current["effective"]!.GetValue<bool>());var blocked=await DigitalPage(warehouse,s);Assert.False(blocked.CanDeliver);Assert.Contains("credit_clearance_required",blocked.Blockers);var blockedInput=DigitalInput(blocked);using(var denied=await warehouse.PostAsJsonAsync(DigitalPath(s)+"/commands/"+blockedInput.CommandId,blockedInput))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        // Existing successful commands remain recoverable after authority changes.
        Assert.True((await DigitalWrite(warehouse,s,input)).Replayed);var own=await Read(await customer.GetAsync($"/api/orders/v2/{s.Id}/fulfillment/digital/{first.Delivery.Id}/content"));Assert.Equal("SYNTHETIC-CREDIT-DIGITAL-CODE",V(own["items"]![0]!,"content"));
        using(var missingAck=await finance.PostAsJsonAsync(Clearance(s)+"/commands/"+Id(),Input(current,"Revoke")))Assert.Equal(HttpStatusCode.Conflict,missingAck.StatusCode);await Read(await finance.PostAsJsonAsync(Clearance(s)+"/commands/"+Id(),Input(current,"Revoke")with{AcknowledgedPartialDispatch=true}));current=await Page(finance,s);
        await Read(await finance.PostAsJsonAsync(Base(s)+"/cheque-approvals/"+V(cheque,"id")+"/commands/"+Id(),new ChequeApprovalInput("Approve",V(current,"orderVersion"),V(s.Schedule,"version"),V(moved["cheque"]!,"version"),V(cheque,"approvalVersion"),"Synthetic re-review before second code",DateTimeOffset.UtcNow,true,false)));current=await Page(finance,s);Assert.True(current["canApprove"]!.GetValue<bool>());await Read(await finance.PostAsJsonAsync(Clearance(s)+"/commands/"+Id(),Input(current)with{AcknowledgedPartialDispatch=true}));
        await DigitalWrite(warehouse,s,DigitalInput(await DigitalPage(warehouse,s)));var final=await Page(finance,s);Assert.Equal("Fulfilled",V(final,"orderState"));Assert.Equal("Fulfilled",V(final,"reservationState"));Assert.False(final["canRevoke"]!.GetValue<bool>());Assert.False(final["canApprove"]!.GetValue<bool>());
        var after=await CreditOrderQa.Read(await customer.GetAsync("/api/credit-orders/"+s.Id));Assert.Equal(original["credit"]!.ToJsonString(),after["credit"]!.ToJsonString());Assert.Equal(V(original["order"]!["summary"]!,"expiresAt"),V(after["order"]!["summary"]!,"expiresAt"));
        await using var scope=sql.Factory.Services.CreateAsyncScope();var sales=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",sales.Database.GetDbConnection().Database);Assert.Equal(0,await sales.OrderCashPayments.CountAsync());Assert.Equal(0,await sales.Orders.CountAsync(x=>x.State==OrderState.Paid));Assert.Equal(2,await sales.DigitalDeliveries.CountAsync(x=>x.OrderId==s.Id));var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.Equal(2,await inventory.PartialDispatches.CountAsync(x=>x.OrderId==s.Id));Assert.Equal(0,(await inventory.Stock.SingleAsync(x=>x.VariantId==s.Variant)).Reserved);Assert.Single(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().PurchaseScopeUses.Where(x=>x.OrderId==s.Id).ToArrayAsync());
    }
}
