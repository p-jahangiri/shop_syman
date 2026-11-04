using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Direct domain tests retain the real SQL parent transaction. HTTP policies and
// audited boundary failures have separate coverage; this helper cannot mark a
// real payment successful or perform any return/refund/warehouse operation.
internal static class RmaSqlHarness
{
    internal sealed class Protection(IDataProtectionProvider provider) : IRmaProtection
    {
        private IDataProtector Protector(string purpose,string principal,string id)
            =>provider.CreateProtector("Sayman.SqlTests.Rma.v1",purpose,principal,id);
        public byte[] Protect(string purpose,string principal,string id,string text)
            =>Protector(purpose,principal,id).Protect(Encoding.UTF8.GetBytes(text));
        public string Unprotect(string purpose,string principal,string id,byte[] value)
        {
            try{return new UTF8Encoding(false,true).GetString(Protector(purpose,principal,id).Unprotect(value));}
            catch(Exception e)when(e is CryptographicException or DecoderFallbackException){throw RmaRules.Unavailable();}
        }
    }
    internal static Task<T> Run<T>(IServiceProvider sp,Func<RmaService,Task<T>> action,TimeProvider? clock=null,bool allowDemo=true)
        =>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(
            ()=>action(new(sp.GetRequiredService<SalesDbContext>(),new Protection(sp.GetRequiredService<IDataProtectionProvider>()),clock??TimeProvider.System,allowDemo)),inventoryOnly:true);
    internal static RmaPolicyInput Policy(string? version,string mode="deliveryDays",int? days=3,bool enabled=true)
        =>new(version,enabled,true,false,"شرایط مصنوعی آزمون SQL؛ سیاست فروشگاه واقعی نیست", "Synthetic SQL policy; not a real shop policy",mode,days,null,"Explicit synthetic QA conditions",true);
}

public sealed partial class RmaSqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private sealed record Scenario(HttpClient Customer,string Owner,string OrderId,string Variant);
    private sealed class Clock(DateTimeOffset now) : TimeProvider {public override DateTimeOffset GetUtcNow()=>now;}
    private static string Id()=>Guid.NewGuid().ToString("N");
    private string Staff=>new JwtSecurityTokenHandler().ReadJwtToken(fixture.Admin.DefaultRequestHeaders.Authorization!.Parameter).Subject;
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();
        Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<SalesDbContext>().Database.GetDbConnection().Database);
        return await action(scope.ServiceProvider);
    }
    private Task<T> Run<T>(Func<RmaService,Task<T>> action,TimeProvider? clock=null,bool allowDemo=true)
        =>Scope(sp=>RmaSqlHarness.Run(sp,action,clock,allowDemo));
    private static async Task<T> Body<T>(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());return JsonSerializer.Deserialize<T>(raw,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;}
    }
    private async Task<Scenario> Create(bool digital=false)
    {
        await fixture.Settings(max:10);var item=await fixture.Product(price:9007199254740993,stock:5,digital:digital);var person=await fixture.Customer();
        var cart=await OrderFixture.Json(await person.Client.GetAsync("/api/cart/en"));
        cart=await OrderFixture.Json(await person.Client.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));
        var quote=await OrderFixture.Json(await person.Client.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Id())));
        var order=(await OrderFixture.Json(await person.Client.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Id(),"Synthetic RMA customer","09121234567",digital?null:new("IR","QA province","QA city","Synthetic address; not a real delivery","1234567890"),null,true)),HttpStatusCode.Created))["order"]!;
        Assert.Equal("9007199254740993",order["lines"]![0]!["unitPriceRial"]!.GetValue<string>());
        var result=new Scenario(person.Client,person.Owner,order["summary"]!["id"]!.GetValue<string>(),item.Variant);
        await Scope(sp=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{
            var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==result.OrderId);
            // Test-only committed payment fact, matching the existing shipment
            // fixture. No gateway substitute or product endpoint can do this.
            var allocation=await sp.GetRequiredService<IStockReservations>().AllocateAsync(result.Owner,row.ReservationId,"synthetic-rma-fixture",default);Assert.Equal(StockReservationState.Allocated,allocation.State);
            row.State=OrderState.Paid;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();return true;
        },inventoryOnly:true));
        return result;
    }
    private async Task<AdminShipmentData> Shipment(Scenario s)=>await Body<AdminShipmentData>(await fixture.Admin.GetAsync($"/api/admin/orders/{s.Owner}/{s.OrderId}/shipment"));
    private async Task ShipmentCommand(Scenario s,string action)
    {
        var page=await Shipment(s);var input=new ShipmentCommandInput(s.Owner,Id(),action,page.OrderVersion,page.Shipment?.Version,page.InventoryFingerprint,"Synthetic RMA fulfillment fixture",true,
            action=="dispatch"?"حمل مصنوعی":null,action=="dispatch"?"Synthetic carrier":null,action=="dispatch"?"RMA-QA":null,action=="pack"?null:DateTimeOffset.UtcNow);
        await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync($"/api/admin/orders/{s.OrderId}/shipment/commands",input));
    }
    private async Task Handoff(Scenario s,bool deliver=true)
    {
        await ShipmentCommand(s,"pack");await ShipmentCommand(s,"dispatch");if(deliver)await ShipmentCommand(s,"deliver");
    }
    private async Task<RmaPolicyData> Policy(string mode="deliveryDays",int? days=3,bool enabled=true)
    {
        var current=await Run(service=>service.CurrentPolicyAsync(default));
        return (await Run(service=>service.WritePolicyAsync(Staff,Id(),RmaSqlHarness.Policy(current.Current?.Version,mode,days,enabled),default))).Policy.Current!;
    }
    private Task<RmaOrderContext> Context(Scenario s,TimeProvider? clock=null)=>Run(service=>service.ContextAsync(s.Owner,s.OrderId,default),clock);
    private static CreateRmaInput Input(RmaOrderContext context,string reason="Synthetic owner request")
        =>new(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(context.Lines.Single().LineKey,1)],reason,true);
    private Task<RmaCommandResult> Submit(Scenario s,CreateRmaInput input,string? command=null)
        =>Run(service=>service.CreateAsync(s.Owner,s.OrderId,command??Id(),input,default));
    private static async Task Error<T>(string code,Func<Task<T>> action)=>Assert.Equal(code,(await Assert.ThrowsAsync<BusinessException>(action)).Code);
    private Task<string> Effects(Scenario s)=>Scope(async sp=>{
        var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var row=await db.Orders.AsNoTracking().SingleAsync(x=>x.Id==s.OrderId);
        return JsonSerializer.Serialize(new{
            Order=row,Lines=await db.Set<SalesOrderLine>().AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.VariantId).ToArrayAsync(),
            LinesV2=await db.OrderLinesV2.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.LineId).ToArrayAsync(),
            Events=await db.Set<SalesOrderEvent>().AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),
            Quote=await db.Quotes.AsNoTracking().SingleAsync(x=>x.Id==row.QuoteId),
            Stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant),
            Reservation=await inv.Reservations.AsNoTracking().SingleAsync(x=>x.Id==row.ReservationId),
            Rights=await inv.ReservationItems.AsNoTracking().Where(x=>x.ReservationId==row.ReservationId).OrderBy(x=>x.VariantId).ToArrayAsync(),
            ReservationEvents=await inv.ReservationEvents.AsNoTracking().Where(x=>x.ReservationId==row.ReservationId).OrderBy(x=>x.Id).ToArrayAsync(),
            Movements=await inv.Movements.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync(),
            Units=await inv.SerialUnits.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync(),
            UnitEvents=await inv.SerialEvents.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),
            Claims=await inv.SerialUnitClaims.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync(),
            Entitlements=await inv.ReservationLineEntitlements.AsNoTracking().Where(x=>x.ReservationId==row.ReservationId).OrderBy(x=>x.LineId).ToArrayAsync(),
            Transfers=await inv.SourcingAllocationTransfers.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.AllocationId).ToArrayAsync(),
            Shipments=await db.OrderShipments.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),
            ShipmentCommands=await db.OrderShipmentCommands.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.CommandId).ToArrayAsync(),
            Parcels=await db.Parcels.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),
            Digital=await db.DigitalDeliveries.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),
            DigitalItems=await db.DigitalItems.AsNoTracking().Where(x=>db.DigitalDeliveries.Any(d=>d.OrderId==s.OrderId&&d.Id==x.DeliveryId)).OrderBy(x=>x.Id).ToArrayAsync(),
            DigitalCommands=await db.DigitalCommands.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.CommandId).ToArrayAsync(),
            Cash=await db.OrderCashPayments.AsNoTracking().Where(x=>x.OrderId==s.OrderId).ToArrayAsync(),
            Credit=await db.CreditOrderLinks.AsNoTracking().Where(x=>x.OrderId==s.OrderId).ToArrayAsync()
        });
    });

    [Fact]
    public async Task UnconfiguredPolicyHasNoCommercialDefaultsAndCannotCreateRequest()
    {
        // Other facts share a fixture policy history. This one independently
        // owns its generated database so test ordering cannot configure it.
        var isolated=new OrderFixture();await isolated.InitializeAsync();
        try{
            var test=new RmaSqlTests(isolated);var s=await test.Create();using var customer=s.Customer;await test.Handoff(s);var before=await test.Effects(s);
            var context=await test.Context(s);Assert.Null(context.Policy.Current);Assert.False(context.CanRequest);Assert.Contains("policy_unconfigured",context.Blockers);Assert.Equal(0,context.Lines.Single().RequestableQuantity);
            Assert.False(context.CanRefund);Assert.False(context.CanRestock);Assert.False(context.CanReship);
            var input=new CreateRmaInput(Id(),context.OrderVersion,"physicalReturn",[new(s.Variant.ToUpperInvariant(),1)],"Synthetic unconfigured request",true);
            await Error("rma_policy_unconfigured_conflict",()=>test.Submit(s,input));Assert.Equal(before,await test.Effects(s));
            await test.Scope(async sp=>{Assert.False(await sp.GetRequiredService<SalesDbContext>().RmaCases.AnyAsync());return true;});
        }finally{await isolated.DisposeAsync();}
    }

    [Fact]
    public async Task ExplicitThreeDayPolicyUsesCasAndHistoricalCommandReplay()
    {
        var current=await Run(service=>service.CurrentPolicyAsync(default));var command=Id();var input=RmaSqlHarness.Policy(current.Current?.Version);var actor=Staff;
        var first=await Run(service=>service.WritePolicyAsync(actor,command,input,default));var policy=first.Policy.Current!;
        Assert.Equal("deliveryDays",policy.WindowMode);Assert.Equal(3,policy.WindowDays);Assert.Null(policy.MaxOpenPerOwner);Assert.True(policy.PhysicalReturns);Assert.False(policy.DigitalComplaints);Assert.False(first.Policy.CanRefund);
        var newer=await Policy("manualReview",null);Assert.True(newer.Revision>policy.Revision);
        var replay=await Run(service=>service.WritePolicyAsync(actor,command,input,default));Assert.True(replay.Replayed);Assert.Equal(RmaRules.Serialize(first with{Replayed=true}),RmaRules.Serialize(replay));
        await Error("rma_idempotency_conflict",()=>Run(service=>service.WritePolicyAsync(actor,command,input with{ConditionsEn="Changed body"},default)));
        await Error("rma_policy_version_conflict",()=>Run(service=>service.WritePolicyAsync(actor,Id(),input,default)));
        var receipt=await Run(service=>service.PolicyReceiptAsync(actor,command,default));Assert.Equal(RmaRules.Serialize(replay),RmaRules.Serialize(receipt));
        Assert.Equal(newer.Id,(await Run(service=>service.CurrentPolicyAsync(default))).Current!.Id);
    }

    [Fact]
    public async Task PhysicalRequestNeedsHandoffAndExplicitManualPolicyForUnknownDeliveryDate()
    {
        await Policy();var s=await Create();using var customer=s.Customer;var before=await Effects(s);var context=await Context(s);Assert.False(context.CanRequest);Assert.Contains("no_requestable_fulfillment",context.Blockers);
        await Error("rma_fulfillment_or_window_conflict",()=>Submit(s,Input(context)));Assert.Equal(before,await Effects(s));
        await Handoff(s,deliver:false);context=await Context(s);Assert.Equal(1,context.Lines.Single().HandedOffOrAvailableQuantity);Assert.Equal(0,context.Lines.Single().RequestableQuantity);
        before=await Effects(s);await Error("rma_fulfillment_or_window_conflict",()=>Submit(s,Input(context)));Assert.Equal(before,await Effects(s));
        await Policy("manualReview",null);context=await Context(s);Assert.True(context.CanRequest);var result=await Submit(s,Input(context));
        Assert.Equal("submitted",result.Case.Case.State);Assert.False(result.Case.CanReceive);Assert.False(result.Case.CanRefund);Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task DeliveredLegacyOrderBindsCanonicalKeyAndCreatesOneCaseForConcurrentReplay()
    {
        await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var before=await Effects(s);var context=await Context(s);Assert.True(context.CanRequest);
        Assert.Equal(s.Variant.ToUpperInvariant(),context.Lines.Single().LineKey);Assert.Equal(1,context.OriginalSnapshotVersion);
        var adapted=await OrderFixture.Json(await customer.GetAsync("/api/orders/v2/"+s.OrderId));var publicId=adapted["lines"]![0]!["lineId"]!.GetValue<string>();Assert.NotEqual(publicId,context.Lines.Single().LineKey);
        var input=Input(context);await Error("invalid_rma",()=>Submit(s,input with{Lines=[new(publicId,1)]}));
        await Error("rma_fulfillment_or_window_conflict",()=>Submit(s,input with{Lines=[new(context.Lines.Single().LineKey,2)]}));
        var command=Id();var results=await Task.WhenAll(Submit(s,input,command),Submit(s,input,command));Assert.Single(results,x=>x.Replayed);var first=Assert.Single(results,x=>!x.Replayed);
        Assert.Equal(context.SnapshotHash,first.Case.SnapshotHash);Assert.Equal(s.Variant.ToUpperInvariant(),first.Case.Lines.Single().LineKey);
        Assert.Equal(RmaRules.Serialize(first with{Replayed=true}),RmaRules.Serialize(results.Single(x=>x.Replayed)));
        await Error("rma_idempotency_conflict",()=>Submit(s,input with{Reason="Different reason"},command));await Error("rma_active_request_conflict",()=>Submit(s,input));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Equal(1,await db.RmaCases.CountAsync(x=>x.OrderId==s.OrderId));Assert.Equal(1,await db.RmaCaseEvents.CountAsync(x=>x.CaseId==first.Case.Case.Id));Assert.Equal(1,await db.RmaCaseCommands.CountAsync(x=>x.CaseId==first.Case.Case.Id));return true;});
        Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task ThreeDayWindowUsesActualDeliveryTimestampIncludingExactBoundary()
    {
        await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var shipment=await Shipment(s);var at=shipment.Shipment!.DeliveredAt!.Value;var before=await Effects(s);
        var exact=await Context(s,new Clock(at.AddDays(3)));Assert.Equal(1,exact.Lines.Single().RequestableQuantity);Assert.True(exact.CanRequest);
        var late=await Context(s,new Clock(at.AddDays(3).AddTicks(1)));Assert.Equal(0,late.Lines.Single().RequestableQuantity);Assert.False(late.CanRequest);Assert.Contains("no_requestable_fulfillment",late.Blockers);
        Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task OwnerWithdrawalAndStaffReviewWithSameVersionHaveOneTransition()
    {
        await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var created=await Submit(s,Input(await Context(s)));var before=await Effects(s);var id=created.Case.Case.Id;var version=created.Case.Case.Version;
        async Task<(RmaCommandResult? Result,BusinessException? Error)> Attempt(Func<Task<RmaCommandResult>> action){try{return(await action(),null);}catch(BusinessException e){return(null,e);}}
        var race=await Task.WhenAll(
            Attempt(()=>Run(service=>service.WithdrawAsync(s.Owner,id,Id(),new(version,"Synthetic withdrawal",true),default))),
            Attempt(()=>Run(service=>service.ReviewAsync(Staff,id,Id(),new(s.Owner,version,"startReview",null,"Private review note",null,true),default))));
        Assert.Single(race,x=>x.Result is not null);Assert.Equal("rma_version_conflict",Assert.Single(race,x=>x.Error is not null).Error!.Code);
        var detail=await Run(service=>service.DetailAsync(s.Owner,id,true,default));Assert.Equal(2,detail.Events.Length);Assert.Contains(detail.Case.State,new[]{"reviewing","withdrawn"});Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task HistoricalCustomerReceiptsKeepOriginalPolicyAndHideStaffNotes()
    {
        var policy=await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var command=Id();var input=Input(await Context(s),"Private owner reason "+Id());var created=await Submit(s,input,command);var before=await Effects(s);var caseId=created.Case.Case.Id;var staffNote="Private staff note "+Id();var reviewCommand=Id();
        var review=await Run(service=>service.ReviewAsync(Staff,caseId,reviewCommand,new(s.Owner,created.Case.Case.Version,"startReview",null,staffNote,"Customer-visible progress",true),default));
        Assert.Equal(staffNote,review.Case.Events.Single(x=>x.Action=="startReview").StaffNote);
        var completed=await Run(service=>service.ReviewAsync(Staff,caseId,Id(),new(s.Owner,review.Case.Case.Version,"completeReview","followUp","Private retained conclusion","Manual follow-up only; no refund approved",true),default));
        Assert.True(completed.Case.Case.IsOpen);Assert.False(completed.Case.CanReceive);Assert.False(completed.Case.CanRefund);Assert.False(completed.Case.CanRestock);Assert.False(completed.Case.CanReship);
        await Policy("manualReview",null,enabled:false);
        await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();await catalog.Variants.Where(x=>x.Id==s.Variant).ExecuteUpdateAsync(x=>x.SetProperty(v=>v.PriceRial,1).SetProperty(v=>v.LabelEn,"Changed current label"));return true;});
        var own=await Run(service=>service.DetailAsync(s.Owner,caseId,false,default));Assert.All(own.Events,x=>Assert.Null(x.StaffNote));Assert.DoesNotContain(staffNote,RmaRules.Serialize(own));Assert.Equal(policy.Id,own.Policy.Id);Assert.Equal(created.Case.SnapshotHash,own.SnapshotHash);Assert.Equal(RmaRules.Serialize(created.Case.Lines),RmaRules.Serialize(own.Lines));
        var historical=await Submit(s,input,command);Assert.Equal(RmaRules.Serialize(created with{Replayed=true}),RmaRules.Serialize(historical));Assert.Equal("submitted",historical.Case.Case.State);
        var staffReceipt=await Run(service=>service.ReceiptAsync(Staff,reviewCommand,true,default));Assert.Equal(RmaRules.Serialize(review with{Replayed=true}),RmaRules.Serialize(staffReceipt));
        await Error("rma_not_found",()=>Run(service=>service.ReceiptAsync(s.Owner,reviewCommand,false,default)));
        var withdrawn=await Run(service=>service.WithdrawAsync(s.Owner,caseId,Id(),new(own.Case.Version,"Owner closes manual follow-up",true),default));Assert.Equal("withdrawn",withdrawn.Case.Case.State);Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task ProtectedNotesAndReceiptsAreBoundToPrincipalPurposeAndIdentity()
    {
        await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var command=Id();var reason="Private reason "+Id();var created=await Submit(s,Input(await Context(s),reason),command);var before=await Effects(s);
        await Scope(async sp=>{
            var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaCases.AsNoTracking().SingleAsync(x=>x.Id==created.Case.Case.Id);var receipt=await db.RmaCaseCommands.AsNoTracking().SingleAsync(x=>x.CaseId==row.Id);var protection=new RmaSqlHarness.Protection(sp.GetRequiredService<IDataProtectionProvider>());
            Assert.DoesNotContain(reason,Encoding.UTF8.GetString(row.ProtectedRequest));Assert.DoesNotContain(reason,Encoding.UTF8.GetString(receipt.ProtectedResult));
            var actor=RmaRules.Actor(s.Owner);Assert.Contains(reason,protection.Unprotect("receipt",actor,command,receipt.ProtectedResult));
            Assert.Throws<BusinessException>(()=>protection.Unprotect("request",actor,command,receipt.ProtectedResult));Assert.Throws<BusinessException>(()=>protection.Unprotect("receipt",RmaRules.Actor(Id()),command,receipt.ProtectedResult));Assert.Throws<BusinessException>(()=>protection.Unprotect("receipt",actor,Id(),receipt.ProtectedResult));return true;
        });
        await Error("rma_not_found",()=>Run(service=>service.DetailAsync(Id(),created.Case.Case.Id,false,default)));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.RmaCaseCommands.Where(x=>x.CaseId==created.Case.Case.Id).ExecuteUpdateAsync(x=>x.SetProperty(v=>v.ResultHash,new string('0',64)));return true;});
        await Error("rma_unavailable",()=>Run(service=>service.ReceiptAsync(s.Owner,command,false,default)));Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task CaseLinesEventsPolicyAndReceiptsCannotBeEditedThroughEf()
    {
        var policy=await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var created=await Submit(s,Input(await Context(s)));var before=await Effects(s);var caseId=created.Case.Case.Id;
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaCaseLines.SingleAsync(x=>x.CaseId==caseId);row.Name="Changed retained product";await Error("rma_history_immutable",()=>db.SaveChangesAsync());return true;});
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaCaseEvents.SingleAsync(x=>x.CaseId==caseId);row.ProtectedText=[1];await Error("rma_history_immutable",()=>db.SaveChangesAsync());return true;});
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaPolicyRevisions.SingleAsync(x=>x.Id==policy.Id);row.ConditionsEn="Changed retained terms";await Error("rma_history_immutable",()=>db.SaveChangesAsync());return true;});
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaCaseCommands.SingleAsync(x=>x.CaseId==caseId);row.ResultHash=new string('0',64);await Error("rma_history_immutable",()=>db.SaveChangesAsync());return true;});
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.RmaCases.SingleAsync(x=>x.Id==caseId);row.SnapshotHash=new string('0',64);await Error("rma_history_immutable",()=>db.SaveChangesAsync());return true;});
        Assert.Equal(RmaRules.Serialize(created.Case),RmaRules.Serialize(await Run(service=>service.DetailAsync(s.Owner,caseId,false,default))));Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task FailedReceiptSaveRollsBackCaseLinesEventsAndSameCommandRetries()
    {
        await Policy();var s=await Create();using var customer=s.Customer;await Handoff(s);var before=await Effects(s);var input=Input(await Context(s));var command=Id();
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[RmaCaseCommands] WITH NOCHECK ADD CONSTRAINT [CK_RmaQaReceiptFailure] CHECK (1=0)");return true;});
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Submit(s,input,command));}
        finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[RmaCaseCommands] DROP CONSTRAINT [CK_RmaQaReceiptFailure]");return true;});}
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.False(await db.RmaCases.AnyAsync(x=>x.OrderId==s.OrderId));Assert.False(await db.RmaCaseCommands.AnyAsync(x=>x.CommandId==command));Assert.False(await db.RmaCaseLines.AnyAsync(x=>x.VariantId==s.Variant));return true;});
        Assert.Equal(before,await Effects(s));var retried=await Submit(s,input,command);Assert.False(retried.Replayed);Assert.Single(retried.Case.Events);Assert.Equal(before,await Effects(s));
    }

    [Fact]
    public async Task DigitalComplaintUsesActualAvailableItemsWithoutInventingDeliveryOrRevealingContent()
    {
        var policy=await Policy();await Run(service=>service.WritePolicyAsync(Staff,Id(),RmaSqlHarness.Policy(policy.Version) with{DigitalComplaints=true},default));
        var s=await Create(digital:true);using var customer=s.Customer;var unavailable=await Context(s);Assert.False(unavailable.CanRequest);Assert.Equal(0,unavailable.Lines.Single().HandedOffOrAvailableQuantity);
        await Error("rma_fulfillment_or_window_conflict",()=>Submit(s,Input(unavailable) with{Kind="digitalComplaint"}));
        var path=$"/api/admin/orders/{s.Owner}/{s.OrderId}/fulfillment/digital";var page=await Body<AdminDigitalDeliveryPage>(await fixture.Admin.GetAsync(path));Assert.True(page.CanDeliver);
        var secret="SYNTHETIC-RMA-UNREVEALED-"+Id();var handoff=new DigitalDeliveryInput(s.Owner,Id(),page.OrderVersion,page.InventoryFingerprint!,"Synthetic digital availability for complaint test",true,[new(page.Lines.Single().LineKey,[secret])]);
        var available=await Body<DigitalDeliveryResult>(await fixture.Admin.PostAsJsonAsync(path+"/commands/"+handoff.CommandId,handoff));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.DigitalDeliveries.AsNoTracking().SingleAsync(x=>x.Id==available.Delivery.Id);Assert.Equal(available.Delivery.AvailableAt,row.AvailableAt);Assert.Equal(1,await db.DigitalItems.CountAsync(x=>x.DeliveryId==row.Id));Assert.False(await db.OrderShipments.AnyAsync(x=>x.OrderId==s.OrderId));Assert.False(await db.Parcels.AnyAsync(x=>x.OrderId==s.OrderId));return true;});
        var before=await Effects(s);var context=await Context(s);var line=Assert.Single(context.Lines);Assert.True(line.IsDigital);Assert.Equal(1,line.HandedOffOrAvailableQuantity);Assert.Equal(1,line.RequestableQuantity);Assert.True(context.CanRequest);
        // Digital complaints start their explicit window at availability;
        // neither a customer DeliveredAt nor a reveal event is fabricated.
        var exact=await Context(s,new Clock(available.Delivery.AvailableAt.AddDays(3)));Assert.True(exact.CanRequest);Assert.Equal(1,exact.Lines.Single().RequestableQuantity);
        var late=await Context(s,new Clock(available.Delivery.AvailableAt.AddDays(3).AddTicks(1)));Assert.False(late.CanRequest);Assert.Equal(0,late.Lines.Single().RequestableQuantity);
        await Error("invalid_rma",()=>Submit(s,Input(context)));
        var created=await Submit(s,Input(context,"Cannot use the available digital item; no content in request") with{Kind="digitalComplaint"});
        var review=await Run(service=>service.ReviewAsync(Staff,created.Case.Case.Id,Id(),new(s.Owner,created.Case.Case.Version,"startReview",null,"Manual digital complaint investigation",null,true),default));
        Assert.Equal("reviewing",review.Case.Case.State);Assert.Equal("digitalComplaint",review.Case.Case.Kind);Assert.False(review.Case.CanRefund);Assert.False(review.Case.CanReceive);Assert.False(review.Case.CanRestock);Assert.False(review.Case.CanReship);Assert.DoesNotContain(secret,RmaRules.Serialize(review));
        Assert.Equal(before,await Effects(s));
    }
}

public sealed partial class OrderV2HttpSqlTests
{
    [Fact]
    public async Task RmaSnapshot2KeepsSameSkuOrdinaryAndAcceptedLinesDistinctWithoutStockEffects()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,true,false);var s=data.Scenario;using var customer=s.Customer;
        var quote=await Order2Quote(s,data.Cart);var order=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created))["order"]!;var id=Text(order["summary"]!,"id");var originalLines=order["lines"]!.ToJsonString();
        await Scope(sp=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==id);await sp.GetRequiredService<IStockOrderReservationsV2>().AllocateAsync(s.Owner,row.ReservationId,"synthetic-rma-snapshot2",default);row.State=OrderState.Paid;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();return true;},inventoryOnly:true));
        using var admin=await ShipmentAdministrator();var read=$"/api/admin/orders/{s.Owner}/{id}/shipment";var write=$"/api/admin/orders/{id}/shipment/commands";
        foreach(var action in new[]{"pack","dispatch","deliver"}){var state=(await admin.GetFromJsonAsync<AdminShipmentData>(read))!;await Body(await admin.PostAsJsonAsync(write,new ShipmentCommandInput(s.Owner,Id(),action,state.OrderVersion,state.Shipment?.Version,state.InventoryFingerprint,"Synthetic RMA snapshot2 history",true,action=="dispatch"?"حمل مصنوعی":null,action=="dispatch"?"Synthetic carrier":null,null,action=="pack"?null:DateTimeOffset.UtcNow)));}
        var actor=new JwtSecurityTokenHandler().ReadJwtToken(admin.DefaultRequestHeaders.Authorization!.Parameter).Subject;
        await Scope(sp=>RmaSqlHarness.Run(sp,async service=>{var old=await service.CurrentPolicyAsync(default);return await service.WritePolicyAsync(actor,Id(),RmaSqlHarness.Policy(old.Current?.Version),default);}));
        var context=await Scope(sp=>RmaSqlHarness.Run(sp,service=>service.ContextAsync(s.Owner,id,default)));Assert.Equal(2,context.OriginalSnapshotVersion);Assert.Equal(2,context.Lines.Length);Assert.Single(context.Lines.Select(x=>x.VariantId).Distinct());Assert.Equal(2,context.Lines.Select(x=>x.LineKey).Distinct().Count());
        var before=await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();return JsonSerializer.Serialize(new{Stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant),Movements=await db.Movements.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync(),Transfers=await db.SourcingAllocationTransfers.AsNoTracking().Where(x=>x.OrderId==id).ToArrayAsync()});});
        var selected=context.Lines.Single(x=>x.OrderedQuantity==1);var input=new CreateRmaInput(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(selected.LineKey,1)],"Only the exact ordinary line; accepted price remains separate",true);
        var created=await Scope(sp=>RmaSqlHarness.Run(sp,service=>service.CreateAsync(s.Owner,id,Id(),input,default)));Assert.Equal(context.SnapshotHash,created.Case.SnapshotHash);Assert.Equal(selected.LineKey,created.Case.Lines.Single().LineKey);Assert.Equal(1,created.Case.Lines.Single().OrderedQuantity);
        var after=await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();return JsonSerializer.Serialize(new{Stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant),Movements=await db.Movements.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync(),Transfers=await db.SourcingAllocationTransfers.AsNoTracking().Where(x=>x.OrderId==id).ToArrayAsync()});});Assert.Equal(before,after);
        var historical=await Body(await customer.GetAsync("/api/orders/v2/"+id));Assert.Equal(originalLines,historical["lines"]!.ToJsonString());
    }
}

public sealed partial class OrderShipmentSqlTests
{
    private sealed class RmaParcelClock(DateTimeOffset instant):TimeProvider{public override DateTimeOffset GetUtcNow()=>instant;}

    [Fact]
    public async Task RmaWindowSelectsOnlyQuantitiesFromParcelsWhoseOwnDeliveryAnchorRemainsEligible()
    {
        var s=await Create(quantity:2);using var customer=s.Customer;
        var actor=new JwtSecurityTokenHandler().ReadJwtToken(fixture.Admin.DefaultRequestHeaders.Authorization!.Parameter).Subject;
        await Scope(sp=>RmaSqlHarness.Run(sp,async service=>{var old=await service.CurrentPolicyAsync(default);return await service.WritePolicyAsync(actor,Id(),RmaSqlHarness.Policy(old.Current?.Version),default);}));
        var delivered=new List<ParcelSummary>();
        for(var index=0;index<2;index++){
            var page=await Parcels(s);var key=page.Lines.Single().LineKey;
            var packed=await ParcelWrite(s,ParcelInput(page,"pack",null,new PartialDispatchSelection(key,1,[])));
            page=await Parcels(s);var sent=await ParcelWrite(s,ParcelInput(page,"dispatch",page.Parcels.Single(x=>x.Id==packed.Detail.Parcel.Id)));
            page=await Parcels(s);var received=await ParcelWrite(s,ParcelInput(page,"deliver",page.Parcels.Single(x=>x.Id==sent.Detail.Parcel.Id)));delivered.Add(received.Detail.Parcel);
        }
        var first=delivered[0].DeliveredAt!.Value;var second=delivered[1].DeliveredAt!.Value;Assert.True(second>first);
        var clock=new RmaParcelClock(first.AddDays(3).AddTicks(1));
        async Task<string> OriginalFacts()=>await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var order=await db.Orders.AsNoTracking().SingleAsync(x=>x.Id==s.OrderId);return JsonSerializer.Serialize(new{
            Order=order,Lines=await db.Set<SalesOrderLine>().AsNoTracking().Where(x=>x.OrderId==s.OrderId).ToArrayAsync(),Parcels=await db.Parcels.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),Commands=await db.ParcelCommands.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.CommandId).ToArrayAsync(),Stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant),Reservation=await inv.Reservations.AsNoTracking().SingleAsync(x=>x.Id==order.ReservationId),Dispatches=await inv.PartialDispatches.AsNoTracking().Where(x=>x.OrderId==s.OrderId).OrderBy(x=>x.Id).ToArrayAsync(),Movements=await inv.Movements.AsNoTracking().Where(x=>x.VariantId==s.Variant).OrderBy(x=>x.Id).ToArrayAsync()});});
        var before=await OriginalFacts();var context=await Scope(sp=>RmaSqlHarness.Run(sp,service=>service.ContextAsync(s.Owner,s.OrderId,default),clock));var line=Assert.Single(context.Lines);Assert.Equal(2,line.OrderedQuantity);Assert.Equal(2,line.HandedOffOrAvailableQuantity);Assert.Equal(1,line.RequestableQuantity);Assert.True(context.CanRequest);
        var input=new CreateRmaInput(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(line.LineKey,2)],"Synthetic split-parcel anchor request",true);
        var error=await Assert.ThrowsAsync<BusinessException>(()=>Scope(sp=>RmaSqlHarness.Run(sp,service=>service.CreateAsync(s.Owner,s.OrderId,Id(),input,default),clock)));Assert.Equal("rma_fulfillment_or_window_conflict",error.Code);
        var created=await Scope(sp=>RmaSqlHarness.Run(sp,service=>service.CreateAsync(s.Owner,s.OrderId,Id(),input with{Lines=[new(line.LineKey,1)]},default),clock));Assert.Equal(1,created.Case.Lines.Single().Quantity);Assert.Equal(2,created.Case.Lines.Single().HandedOffOrAvailableQuantity);Assert.Equal(context.SnapshotHash,created.Case.SnapshotHash);Assert.False(created.Case.CanReceive);Assert.False(created.Case.CanRefund);
        Assert.Equal(before,await OriginalFacts());
    }
}
