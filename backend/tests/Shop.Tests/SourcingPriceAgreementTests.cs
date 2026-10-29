using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingPriceAgreementTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private const string V="AAAAAAAAAAA=";
    private static readonly string Hash=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static OfferSkuSnapshot Sku()=>new("sku","model","sayman","QA-AGREEMENT",new("model","qa-model","phones","گوشی","Phones","brand","Brand","مدل نمونه","Synthetic model","شرح","Description",["/products/phone-green.svg"],[]),"پیکربندی","Configuration","#123456","رنگ","Colour","گارانتی پذیرفته‌شده","Accepted warranty",[],["online"],null,[],"101",V,Hash,Hash);
    private static AcceptedSourcingPurchasePlan Plan()=>new(Id(),Id(),Id(),1,Id(),"owner",Hash,V,V,V,At.AddHours(2),"شرایط پذیرفته‌شده","Accepted terms",false,[new(Id(),Id(),2,"9007199254740993",Sku())]);

    [Theory]
    [InlineData("0",0L)]
    [InlineData("9007199254740993",9007199254740993L)]
    [InlineData("9223372036854775807",long.MaxValue)]
    public void IntegerRialKeepsExactValuesAboveJavascriptPrecision(string text,long expected)=>Assert.Equal(expected,SourcingPriceAgreementRules.Price(text));

    [Theory]
    [InlineData("")][InlineData("00")][InlineData("01")][InlineData("+1")][InlineData("-1")][InlineData("1.0")][InlineData(" 1")][InlineData("۱")][InlineData("9223372036854775808")]
    public void AcceptedMoneyMustUseCanonicalNonnegativeInt64(string text)=>Assert.Equal("invalid_sourcing_agreement",Assert.Throws<BusinessException>(()=>SourcingPriceAgreementRules.Price(text)).Code);

    [Fact] public void ProductAndBasketOverflowAreBothExplicitBusinessConflicts()
    {
        var plan=Plan();Assert.Equal(18014398509481986L,SourcingPriceAgreementRules.Total(plan.Lines));var maximum=plan.Lines[0] with{Quantity=1,UnitPriceRial=long.MaxValue.ToString(CultureInfo.InvariantCulture)};Assert.Equal(long.MaxValue,SourcingPriceAgreementRules.Total([maximum]));Assert.Equal("sourcing_agreement_amount_limit",Assert.Throws<BusinessException>(()=>SourcingPriceAgreementRules.Total([maximum with{Quantity=2}])).Code);Assert.Equal("sourcing_agreement_amount_limit",Assert.Throws<BusinessException>(()=>SourcingPriceAgreementRules.Total([maximum,maximum with{OfferLineId=Id(),UnitPriceRial="1"}])).Code);
    }

    [Fact] public void SnapshotHashExcludesLiveVersionsButBindsAllAcceptedCommercialTerms()
    {
        var plan=Plan();var hash=SourcingPriceAgreementRules.SnapshotHash(plan);Assert.Equal(hash,SourcingPriceAgreementRules.SnapshotHash(plan with{RequestVersion="AQAAAAAAAAA=",TaskVersion="AgAAAAAAAAA=",OfferVersion="AwAAAAAAAAA="}));foreach(var changed in new[]{plan with{OwnerId="other"},plan with{TermsFa="شرایط دیگر"},plan with{TermsEn="Changed terms"},plan with{Revision=2},plan with{PurchaseUntil=plan.PurchaseUntil.AddTicks(1)},plan with{ContainsDemo=true},plan with{Lines=[plan.Lines[0] with{Quantity=1}]},plan with{Lines=[plan.Lines[0] with{UnitPriceRial="101"}]},plan with{Lines=[plan.Lines[0] with{Sku=plan.Lines[0].Sku with{WarrantyEn="Changed warranty"}}]}})Assert.NotEqual(hash,SourcingPriceAgreementRules.SnapshotHash(changed));
    }

    [Fact] public void PublicPriceWithinTheAcceptedSnapshotCannotBeSilentlyReplacedByLiveCatalog()
    {
        var plan=Plan();var hash=SourcingPriceAgreementRules.SnapshotHash(plan);var liveSku=plan.Lines[0].Sku with{PublicPriceRial="777",Version="AQAAAAAAAAA="};Assert.Equal("101",plan.Lines[0].Sku.PublicPriceRial);Assert.Equal("9007199254740993",plan.Lines[0].UnitPriceRial);Assert.NotEqual(hash,SourcingPriceAgreementRules.SnapshotHash(plan with{Lines=[plan.Lines[0] with{Sku=liveSku}]}));
    }

    [Fact] public void LineIdentityAndSnapshotOrderingStayStableAcrossExplicitReallocation()
    {
        var plan=Plan();var second=plan.Lines[0] with{OfferLineId=Id(),ListingId=Id()};plan=plan with{Lines=[plan.Lines[0],second]};Assert.Equal(SourcingPriceAgreementRules.SnapshotHash(plan),SourcingPriceAgreementRules.SnapshotHash(plan with{Lines=plan.Lines.Reverse().ToArray()}));var line=SourcingPriceAgreementRules.LineId(plan.AcceptanceId,plan.Lines[0].OfferLineId);Assert.Equal(32,line.Length);Assert.Equal(line,SourcingPriceAgreementRules.LineId(plan.AcceptanceId,plan.Lines[0].OfferLineId));Assert.NotEqual(line,SourcingPriceAgreementRules.LineId(Id(),plan.Lines[0].OfferLineId));Assert.NotEqual(line,SourcingPriceAgreementRules.LineId(plan.AcceptanceId,second.OfferLineId));
    }

    [Fact] public void AcceptedPlanRejectsDuplicateLinesInvalidQuantitiesAndNonUtcDeadline()
    {
        var plan=Plan();foreach(var invalid in new[]{plan with{Lines=[]},plan with{Lines=[plan.Lines[0],plan.Lines[0]]},plan with{Lines=[plan.Lines[0] with{Quantity=0}]},plan with{Lines=[plan.Lines[0] with{Quantity=1000001}]},plan with{PurchaseUntil=At.ToOffset(TimeSpan.FromHours(1))},plan with{Revision=0},plan with{OwnerId="owner@email.test"},plan with{TermsEn=""}})Assert.Throws<BusinessException>(()=>SourcingPriceAgreementRules.Validate(invalid));
    }

    [Fact] public void SnapshotCapacityRejectsOneOversizedAcceptedGraphWithoutTruncation()
    {
        var plan=Plan();plan=plan with{Lines=[plan.Lines[0] with{Sku=plan.Lines[0].Sku with{Model=plan.Lines[0].Sku.Model with{DescriptionEn=new string('x',1048577)}}}]};Assert.Equal("sourcing_agreement_capacity_unavailable",Assert.Throws<BusinessException>(()=>SourcingPriceAgreementRules.SnapshotHash(plan)).Code);
    }

    [Fact] public void PrivateWireUsesDecimalStringsAndNeverAuthorizesPaymentOrExposesOwner()
    {
        var plan=Plan();var line=plan.Lines[0];var data=new SourcingPriceAgreementData(1,plan.AcceptanceId,plan.RequestId,plan.TaskId,plan.OfferId,plan.Revision,plan.AcceptanceId,plan.TermsHash,Id(),"Active","Active",V,plan.TermsFa,plan.TermsEn,plan.PurchaseUntil,false,[new(SourcingPriceAgreementRules.LineId(plan.AcceptanceId,line.OfferLineId),line.OfferLineId,line.ListingId,line.Quantity,line.UnitPriceRial,"18014398509481986",line.Sku)]);var json=JsonSerializer.Serialize(data,new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.Contains("\"unitPriceRial\":\"9007199254740993\"",json);Assert.Contains("\"lineTotalRial\":\"18014398509481986\"",json);Assert.Contains("\"canPay\":false",json);foreach(var forbidden in new[]{"ownerId","consumedOrderId","snapshotHash","supplierReference","actorId"})Assert.DoesNotContain("\""+forbidden+"\":",json);
    }

    [Fact] public void ModelKeepsOneAcceptanceAuthorityAndSalesOnlyRestrictForeignKeys()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var model=db.GetService<IDesignTimeModel>().Model;var agreement=model.FindEntityType(typeof(SourcingPriceAgreement))!;Assert.True(agreement.FindProperty(nameof(SourcingPriceAgreement.Version))!.IsConcurrencyToken);Assert.Contains(agreement.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual(["AcceptanceId"]));var line=model.FindEntityType(typeof(SourcingPriceAgreementLine))!;Assert.Equal(typeof(long),line.FindProperty(nameof(SourcingPriceAgreementLine.UnitPriceRial))!.ClrType);Assert.Contains(line.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual(["AgreementId","OfferLineId"]));Assert.All(line.GetForeignKeys(),fk=>{Assert.Equal("sales",fk.PrincipalEntityType.GetSchema());Assert.Equal(DeleteBehavior.Restrict,fk.DeleteBehavior);});
    }

    [Fact] public async Task AllFinancialMutationEntrypointsRequireParentSerializableBeforeSql()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var service=new SourcingPriceAgreementService(db,TimeProvider.System,false);var plan=Plan();await Assert.ThrowsAsync<InvalidOperationException>(()=>service.LockAsync(plan.AcceptanceId,default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.EnsureForAllocationAsync(plan,Id(),default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.AssertReleaseAllowedAsync(plan.AcceptanceId,plan.RequestId,plan.TaskId,default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.BeforeCloseAsync(plan.AcceptanceId,plan.RequestId,plan.TaskId,default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
}
