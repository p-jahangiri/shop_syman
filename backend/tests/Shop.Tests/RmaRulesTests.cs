using Microsoft.EntityFrameworkCore;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class RmaRulesTests
{
    private const string Id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",Version="AAAAAAAAAAE=";
    private static RmaPolicyInput Policy()=>new(null,true,true,true,"ثبت درخواست به معنای پذیرش یا بازپرداخت نیست.","A request is reviewed; it does not guarantee acceptance or a refund.","deliveryDays",3,null,"Explicit synthetic policy, not a main seed",true);
    private static CreateRmaInput Request()=>new(Id,Version,"physicalReturn",[new("LEGACY_VARIANT",1)],"Private synthetic customer concern",true);
    [Fact]public void PolicyRequiresExplicitTermsClockAndConfirmationWithoutAHiddenQuota()
    {
        var p=RmaRules.Normalize(Policy());Assert.Equal(3,p.WindowDays);Assert.Null(p.MaxOpenPerOwner);
        Assert.Null(RmaRules.Normalize(p with{WindowMode="manualReview",WindowDays=null}).WindowDays);
        foreach(var invalid in new[]{p with{Confirmed=false},p with{ConditionsFa=""},p with{ConditionsEn=""},p with{WindowDays=null},p with{WindowDays=0},p with{WindowDays=3651},
            p with{WindowMode="orderCreatedDays"},p with{WindowMode="manualReview"},p with{MaxOpenPerOwner=0},p with{MaxOpenPerOwner=10001},p with{PhysicalReturns=false,DigitalComplaints=false},p with{Version="bad"}})
            Assert.Throws<BusinessException>(()=>RmaRules.Normalize(invalid));
    }
    [Theory][InlineData(-1,false)][InlineData(0,true)][InlineData(259199,true)][InlineData(259200,true)][InlineData(259201,false)]
    public void ThreeDayWindowUsesExplicitCustomerDeliveryAndExactUtcBoundary(int seconds,bool expected)
    {
        var delivered=DateTimeOffset.Parse("2026-10-30T00:00:00Z");Assert.Equal(expected,RmaRules.WithinWindow("deliveryDays",3,delivered,delivered.AddSeconds(seconds)));
    }
    [Fact]public void AHandOffOrFulfilledLabelCannotReplaceMissingCustomerDelivery()
    {
        var now=DateTimeOffset.UtcNow;Assert.False(RmaRules.WithinWindow("deliveryDays",3,null,now));
        Assert.True(RmaRules.WithinWindow("manualReview",null,null,now));Assert.False(RmaRules.WithinWindow("manualReview",3,null,now));
        Assert.False(RmaRules.WithinWindow("warehouseDelivered",3,now,now));
    }
    [Fact]public void OnlyPhysicalReturnOrDigitalComplaintPurposesAreAccepted()
    {
        RmaRules.Normalize(Request());RmaRules.Normalize(Request()with{Kind="digitalComplaint"});
        foreach(var kind in new[]{"cancelRemaining","refund","exchange","received","Refunded"})Assert.Throws<BusinessException>(()=>RmaRules.Normalize(Request()with{Kind=kind}));
    }
    [Fact]public void RequestCannotSupplyDuplicateOrUnboundedLineClaimsOrSkipAcknowledgement()
    {
        foreach(var input in new[]{Request()with{Lines=[]},Request()with{Lines=[new("ONE",1),new("ONE",1)]},Request()with{Lines=[new("ONE",0)]},Request()with{Lines=[new("ONE",1000001)]},
            Request()with{Lines=[new("NOT/A/LINE",1)]},Request()with{Lines=Enumerable.Range(0,65).Select(i=>new RmaLineSelection("K"+i,1)).ToArray()},
            Request()with{Reason=""},Request()with{Reason="a\u202eb"},Request()with{AcknowledgeNoFinancialAction=false}})Assert.Throws<BusinessException>(()=>RmaRules.Normalize(input));
        var sorted=RmaRules.Normalize(Request()with{Lines=[new("B",1),new("A",1)]});Assert.Equal(new[]{"A","B"},sorted.Lines.Select(x=>x.LineKey));
    }
    [Fact]public void ReviewOutcomesDescribeTriageAndCannotInventRefundReceiptOrInventoryAuthority()
    {
        var review=new ReviewRmaInput("OWNER",Version,"startReview",null,"Private staff note",null,true);RmaRules.Normalize(review);
        RmaRules.Normalize(review with{Action="completeReview",Outcome="followUp"});RmaRules.Normalize(review with{Action="completeReview",Outcome="declined"});
        foreach(var input in new[]{review with{Outcome="followUp"},review with{Action="completeReview"},review with{Action="refund"},review with{Action="completeReview",Outcome="Refunded"},
            review with{Action="completeReview",Outcome="received"},review with{AcknowledgeNoFinancialAction=false},review with{Note=""}})Assert.Throws<BusinessException>(()=>RmaRules.Normalize(input));
    }
    [Fact]public void PaginationCursorIsBoundToOwnerAndFilterAndRejectsNormalization()
    {
        var cursor=RmaRules.Cursor(42,"owner-A:submitted");Assert.Equal(42,RmaRules.Cursor(cursor,"owner-A:submitted"));
        Assert.Throws<BusinessException>(()=>RmaRules.Cursor(cursor,"owner-B:submitted"));Assert.Throws<BusinessException>(()=>RmaRules.Cursor(cursor,"owner-A:reviewed"));
        Assert.Throws<BusinessException>(()=>RmaRules.Cursor(cursor+"\n","owner-A:submitted"));
    }
    [Fact]public void EveryRetainedRmaGraphIsAppendOnlyAndCaseIdentityCannotBeRewritten()
    {
        using var db=new SalesDbContext(new DbContextOptionsBuilder<SalesDbContext>().UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;TrustServerCertificate=True").Options);
        object[] immutable=[new RmaPolicyRevision{Id=Id},new RmaPolicyCommand{ActorId="OWNER",CommandId=Id},new RmaCaseLine{CaseId=Id,LineKey="ONE"},
            new RmaCaseEvent{Id=1,CaseId=Id},new RmaCaseCommand{ActorId="OWNER",CommandId=Id}];
        foreach(var entity in immutable){db.ChangeTracker.Clear();db.Attach(entity);db.Entry(entity).State=EntityState.Deleted;Assert.Equal("rma_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);}
        db.ChangeTracker.Clear();var row=new RmaCase{Id=Id,OwnerId="OWNER",OrderId=Id};db.Attach(row);row.SnapshotHash=new string('F',64);
        Assert.Equal("rma_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);
    }
    [Fact]public void DefaultsRemainFinanciallyAndOperationallyDisabledAfterReview()
    {
        var current=new RmaPolicyCurrent(1,null);Assert.False(current.CanRefund);Assert.Equal("provider_unconfigured",current.RefundAvailability);
        var summary=new RmaSummary(Id,"RMA-1",Id,"en","physicalReturn","reviewed","followUp",true,Version,1,DateTimeOffset.UtcNow,DateTimeOffset.UtcNow);
        var policy=new RmaPolicyData(Id,1,Version,true,true,true,"شرایط","Terms","deliveryDays",3,null,DateTimeOffset.UtcNow);
        var detail=new RmaDetail(1,summary,1,new string('F',64),policy,"Private reason",[],[],true);
        Assert.False(detail.CanRefund);Assert.False(detail.CanReceive);Assert.False(detail.CanRestock);Assert.False(detail.CanReship);Assert.Equal("provider_unconfigured",detail.RefundAvailability);
    }
    [Fact]public void AFullSupportedOrderWithHistoricalUnicodeLabelsFitsTheProtectedReceiptBound()
    {
        var now=DateTimeOffset.UtcNow;var summary=new RmaSummary(Id,"RMA-1",Id,"fa","physicalReturn","reviewed","followUp",true,Version,64,now,now);
        var policy=new RmaPolicyData(Id,1,Version,true,true,true,new string('ش',4000),new string('ش',4000),"deliveryDays",3,null,now);
        var lines=Enumerable.Range(0,64).Select(i=>new RmaLineData("LINE"+i,"VARIANT"+i,new string('ش',80),new string('ش',250),new string('ش',4000),false,1,1,1)).ToArray();
        var events=new[]{"submitted","startReview","completeReview","withdrawn"}.Select((action,i)=>new RmaEventData((i+1).ToString(),action,"reviewed","followUp","staff",now,new string('ش',2000),new string('ش',4000))).ToArray();
        var detail=new RmaDetail(1,summary,2,new string('F',64),policy,new string('ش',4000),lines,events,true);
        var bytes=System.Text.Encoding.UTF8.GetByteCount(RmaRules.Serialize(new RmaCommandResult(1,Id,new string('F',64),false,detail)));
        Assert.True(bytes>524288);Assert.True(bytes<RmaRules.MaxProtectedBytes-1024);
    }
}
