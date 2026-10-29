using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CreditClearanceSqlTests
{
    private static string ParcelPath(Scenario s)=>$"/api/admin/orders/{s.Owner}/{s.Id}/fulfillment";
    private static async Task<ParcelPage> ParcelPage(HttpClient staff,Scenario s)=>JsonSerializer.Deserialize<ParcelPage>((await Read(await staff.GetAsync(ParcelPath(s)))).ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    private static ParcelCommandInput ParcelInput(ParcelPage p,string action,ParcelSummary? parcel=null)=>new(p.OwnerId,Id(),action,p.OrderVersion,parcel?.Id,parcel?.Version,p.InventoryFingerprint,"Synthetic credit partial hand-off",true,action=="pack"?"SYNTHETIC-CREDIT-PARCEL":null,action=="pack"?[new(p.Lines[0].LineKey,1,[])]:[],action=="dispatch"?"حمل ساختگی":null,action=="dispatch"?"Synthetic carrier":null,null,action=="dispatch"?DateTimeOffset.UtcNow:null);
    private static async Task<ParcelCommandResult> ParcelWrite(HttpClient staff,Scenario s,ParcelCommandInput input)=>JsonSerializer.Deserialize<ParcelCommandResult>((await Read(await staff.PostAsJsonAsync(ParcelPath(s)+"/commands/"+input.CommandId,input))).ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    [Fact]public async Task RemainingCreditDispatchNeedsFreshExplicitFinanceReviewAndCannotBackdateItOrCorrectUpfront()
    {
        using var f=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");using var warehouse=await Staff("Administrator");var s=await Ready(f,reviewer,quantity:2);using var customer=s.Customer;
        var original=await CreditOrderQa.Read(await customer.GetAsync("/api/credit-orders/"+s.Id));var initial=await Page(f,s);var initialCommand=Id();var initialBody=Input(initial);await Read(await f.PostAsJsonAsync(Clearance(s)+"/commands/"+initialCommand,initialBody));
        var page=await ParcelPage(warehouse,s);var packed=await ParcelWrite(warehouse,s,ParcelInput(page,"pack"));page=await ParcelPage(warehouse,s);await ParcelWrite(warehouse,s,ParcelInput(page,"dispatch",page.Parcels.Single()));
        page=await ParcelPage(warehouse,s);var remaining=await ParcelWrite(warehouse,s,ParcelInput(page,"pack"));var current=await Page(f,s);Assert.Equal("dispatched",V(current,"shipmentState"));Assert.Equal("Allocated",V(current,"reservationState"));Assert.True(current["canRevoke"]!.GetValue<bool>());
        var upfront=await Read(await f.GetAsync(Base(s)+"/upfront"));Assert.False(upfront["canRevoke"]!.GetValue<bool>());Assert.False(upfront["canConfirmReceipt"]!.GetValue<bool>());
        var up=JsonSerializer.Deserialize<CreditUpfrontPage>(upfront.ToJsonString(),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;var revokeUp=new CreditUpfrontInput("RevokeConfirmation",up.OrderVersion,up.ScheduleVersion!,up.Current!.Version,"","Synthetic post-handoff correction must fail",DateTimeOffset.UtcNow,true,false,true);
        using(var denied=await f.PostAsJsonAsync(Base(s)+"/upfront/commands/"+Id(),revokeUp))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var cheque=s.Cheques[0];var moved=await Read(await f.PostAsJsonAsync(Base(s)+"/cheques/"+V(cheque,"id")+"/commands/"+Id(),new MoveChequeInput(V(cheque,"ledgerVersion"),"Deposit","Synthetic custody after partial handoff",DateTimeOffset.UtcNow,true,true)));
        current=await Page(f,s);Assert.False(current["effective"]!.GetValue<bool>());page=await ParcelPage(warehouse,s);var blocked=ParcelInput(page,"dispatch",page.Parcels.Single(p=>p.Id==remaining.Detail.Parcel.Id));using(var denied=await warehouse.PostAsJsonAsync(ParcelPath(s)+"/commands/"+blocked.CommandId,blocked))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        using(var missingAck=await f.PostAsJsonAsync(Clearance(s)+"/commands/"+Id(),Input(current,"Revoke")))Assert.Equal(HttpStatusCode.Conflict,missingAck.StatusCode);
        await Read(await f.PostAsJsonAsync(Clearance(s)+"/commands/"+Id(),Input(current,"Revoke")with{AcknowledgedPartialDispatch=true}));current=await Page(f,s);
        await Read(await f.PostAsJsonAsync(Base(s)+"/cheque-approvals/"+V(cheque,"id")+"/commands/"+Id(),new ChequeApprovalInput("Approve",V(current,"orderVersion"),V(s.Schedule,"version"),V(moved["cheque"]!,"version"),V(cheque,"approvalVersion"),"Synthetic current cheque re-review for remaining goods",DateTimeOffset.UtcNow,true,false)));
        current=await Page(f,s);Assert.True(current["canApprove"]!.GetValue<bool>());var command=Id();var body=Input(current)with{AcknowledgedPartialDispatch=true};var refreshed=await Read(await f.PostAsJsonAsync(Clearance(s)+"/commands/"+command,body));Assert.False(refreshed["initialCommit"]!.GetValue<bool>());Assert.True(refreshed["event"]!["acknowledgedPartialDispatch"]!.GetValue<bool>());
        page=await ParcelPage(warehouse,s);var input=ParcelInput(page,"dispatch",page.Parcels.Single(p=>p.Id==remaining.Detail.Parcel.Id));var backdated=input with{CommandId=Id(),OccurredAt=remaining.Detail.Parcel.PackedAt};using(var denied=await warehouse.PostAsJsonAsync(ParcelPath(s)+"/commands/"+backdated.CommandId,backdated))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        await ParcelWrite(warehouse,s,input);var final=await Page(f,s);Assert.Equal("CreditApproved",V(final,"orderState"));Assert.Equal("Fulfilled",V(final,"reservationState"));Assert.False(final["canRevoke"]!.GetValue<bool>());Assert.True((await Read(await f.PostAsJsonAsync(Clearance(s)+"/commands/"+command,body)))["replayed"]!.GetValue<bool>());Assert.True((await Read(await f.PostAsJsonAsync(Clearance(s)+"/commands/"+initialCommand,initialBody)))["replayed"]!.GetValue<bool>());
        var after=await CreditOrderQa.Read(await customer.GetAsync("/api/credit-orders/"+s.Id));Assert.Equal(V(original["order"]!["summary"]!,"expiresAt"),V(after["order"]!["summary"]!,"expiresAt"));Assert.Equal(original["credit"]!.ToJsonString(),after["credit"]!.ToJsonString());
        await using var scope=sql.Factory.Services.CreateAsyncScope();var sales=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var inv=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.Equal(0,await sales.OrderCashPayments.CountAsync());Assert.Equal(0,await sales.Orders.CountAsync(x=>x.State==OrderState.Paid));Assert.Single(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().PurchaseScopeUses.Where(x=>x.OrderId==s.Id).ToArrayAsync());Assert.Equal(2,await inv.PartialDispatches.CountAsync(x=>x.OrderId==s.Id));Assert.Equal(0,(await inv.Stock.SingleAsync(x=>x.VariantId==s.Variant)).Reserved);
    }
}
