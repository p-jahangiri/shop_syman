using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CartV2Tests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private const string V="AAAAAAAAAAE=";
    private static readonly string H=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static OfferSkuSnapshot Sku()=>new("v1-silver","model","seller","QA-SKU",new("model","qa-phone","phones","گوشی","Phone","brand","Brand","نام اصلی","Original name","شرح","Description",[],[]),"تنوع","Variant","silver","نقره‌ای","Silver","گارانتی اصلی","Original warranty",[],["online"],null,[],"100",V,H,H);
    private static AcceptedSourcingPurchasePlan Plan()=>new(Id(),Id(),Id(),1,Id(),"owner",H,V,V,V,At.AddHours(2),"شرایط اصلی","Original terms",false,[new(Id(),Id(),2,"9007199254740993",Sku())]);
    private static SourcingConversionInput Input()=>new(Id(),Id(),V,V,V,Id(),Id(),V,Id(),V,H,null);
    private static SourcingPriceAgreementData Agreement(AcceptedSourcingPurchasePlan p)=>new(1,p.AcceptanceId,p.RequestId,p.TaskId,p.OfferId,p.Revision,p.AcceptanceId,p.TermsHash,Id(),"Active","Active",V,p.TermsFa,p.TermsEn,p.PurchaseUntil,p.ContainsDemo,p.Lines.Select(l=>new SourcingPriceAgreementLineData(SourcingPriceAgreementRules.LineId(p.AcceptanceId,l.OfferLineId),l.OfferLineId,l.ListingId,l.Quantity,l.UnitPriceRial,"18014398509481986",l.Sku)).ToArray());
    [Fact] public void StableLineIdentitySeparatesOrdinaryAndAcceptedPricesOfTheSameNonGuidSku()
    {
        var cart=Id();var agreement=Id();var line=Id();var ordinary=CartOfferRules.OrdinaryLineId(cart,"v1-silver");Assert.Equal(ordinary,CartOfferRules.OrdinaryLineId(cart,"V1-SILVER"));Assert.Matches("^[0-9a-f]{32}$",ordinary);var accepted=CartOfferRules.OfferLineId(cart,agreement,line);Assert.NotEqual(ordinary,accepted);Assert.Equal(accepted,CartOfferRules.OfferLineId(cart,agreement,line));Assert.NotEqual(accepted,CartOfferRules.OfferLineId(cart,Id(),line));
    }
    [Fact] public void CommandUuidCanonicalizationDoesNotRelaxTargetIdsOrUppercaseTermsProof()
    {
        var input=Input();var dashed=Guid.ParseExact(input.RequestId,"N").ToString("D");Assert.Equal(input,CartOfferRules.Normalize(input with{RequestId=dashed}));Assert.Equal(input.RequestId,CartOfferRules.CommandId(dashed));Assert.Throws<BusinessException>(()=>CartOfferRules.Id(dashed));Assert.Throws<BusinessException>(()=>CartOfferRules.Normalize(input with{TermsHash=new string('a',64)}));Assert.Throws<BusinessException>(()=>CartOfferRules.CommandId(Guid.Empty.ToString("D")));
    }
    [Fact] public void AggregateSkuBoundIsSharedAcrossDifferentCaseAndBothPurchaseLanes()
    {
        CartOfferRules.EnsureSkuCapacity([("v1-silver",500000),("V1-SILVER",500000)]);Assert.Equal("cart_limit",Assert.Throws<BusinessException>(()=>CartOfferRules.EnsureSkuCapacity([("v1-silver",500001),("V1-SILVER",500000)])).Code);CartOfferRules.EnsureSkuCapacity([("v1-silver",1000000),("v2-black",1000000)]);
    }
    [Fact] public void CandidateProofRetainsExactLargeMoneyAndEveryCommercialSnapshotField()
    {
        var plan=Plan();var agreement=Agreement(plan);SourcingConversionRules.AssertCandidate(plan,agreement);
        foreach(var changed in new[]{agreement with{TermsEn="Changed terms"},agreement with{PurchaseUntil=agreement.PurchaseUntil.AddTicks(1)},agreement with{Revision=2},agreement with{Lines=[agreement.Lines[0] with{Quantity=1,LineTotalRial="9007199254740993"}]},agreement with{Lines=[agreement.Lines[0] with{UnitPriceRial="1",LineTotalRial="2"}]},agreement with{Lines=[agreement.Lines[0] with{Sku=agreement.Lines[0].Sku with{PublicPriceRial="999"}}]},agreement with{Lines=[agreement.Lines[0] with{Sku=agreement.Lines[0].Sku with{WarrantyEn="Other warranty"}}]}})Assert.Throws<BusinessException>(()=>SourcingConversionRules.AssertCandidate(plan,changed));
    }
    [Theory]
    [InlineData("{\"lines\":[],\"version\":null,\"ownerId\":\"forged\"}")]
    [InlineData("{\"lines\":[{\"variantId\":\"v1-silver\",\"quantity\":1,\"unitPriceRial\":\"1\"}],\"version\":null}")]
    public void OrdinaryV2InputRejectsOverposting(string json)=>Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CartV2Input>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    [Fact] public void RemovalInputDoesNotAcceptReleaseOrCommercialFields()=>Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CartOfferRemoveInput>("{\"requestId\":\""+Id()+"\",\"version\":\""+V+"\",\"releaseStock\":true}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    [Fact] public void V2WirePreservesExplicitNullsAndDecimalStringsWithNoCheckoutForAcceptedLines()
    {
        var p=Plan();var cart=Id();var line=p.Lines[0];var offer=new CartOfferLineData(Id(),"acceptedOffer",Id(),p.AcceptanceId,Id(),p.RequestId,p.TaskId,p.OfferId,p.AcceptanceId,Id(),line.OfferLineId,line.Sku.VariantId,2,line.Sku.ProductId,line.Sku.Model.Slug,line.Sku.Sku,line.Sku.Model.NameEn,line.Sku.LabelEn,line.Sku.WarrantyEn,null,line.UnitPriceRial,"18014398509481986",p.PurchaseUntil,At.AddMinutes(30),null);
        var value=new CartSnapshotV2(2,"en",V,[new(CartOfferRules.OrdinaryLineId(cart,"missing"),"ordinary","missing",1,null,null,null,null,null,0,null,"unavailable")],[offer],new(1,"en",V,24,true,false,[],false),null,"18014398509481986",null,true,false,false,["accepted_offer_checkout_unavailable"]);
        var json=JsonSerializer.Serialize(value,new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull});using var doc=JsonDocument.Parse(json);var root=doc.RootElement;Assert.Equal(JsonValueKind.Null,root.GetProperty("buySubtotalRial").ValueKind);Assert.Equal(JsonValueKind.Null,root.GetProperty("ordinarySubtotalRial").ValueKind);Assert.Equal(JsonValueKind.Null,root.GetProperty("offerLines")[0].GetProperty("imageUrl").ValueKind);Assert.Equal(JsonValueKind.Null,root.GetProperty("offerLines")[0].GetProperty("issue").ValueKind);Assert.Equal("9007199254740993",root.GetProperty("offerLines")[0].GetProperty("unitPriceRial").GetString());Assert.False(root.GetProperty("canCheckout").GetBoolean());Assert.False(root.GetProperty("canPay").GetBoolean());foreach(var forbidden in new[]{"ownerId","unitIds","internalNote","supplierReference"})Assert.DoesNotContain("\""+forbidden+"\":",json);
    }
    [Fact] public void SalesModelAddsSeparateLinesWithoutReplacingHistoricalVariantKeys()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var model=db.GetService<IDesignTimeModel>().Model;Assert.Equal(new[]{"CartId","VariantId"},model.FindEntityType(typeof(ShoppingCartLine))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));Assert.Equal(new[]{"QuoteId","VariantId"},model.FindEntityType(typeof(CheckoutQuoteLine))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));Assert.Equal(new[]{"OrderId","VariantId"},model.FindEntityType(typeof(SalesOrderLine))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));var accepted=model.FindEntityType(typeof(CartOfferLine))!;Assert.False(accepted.FindProperty(nameof(CartOfferLine.Id))!.IsNullable);Assert.Equal(new[]{"CartId","AgreementLineId"},accepted.FindPrimaryKey()!.Properties.Select(p=>p.Name));Assert.All(accepted.GetForeignKeys(),fk=>Assert.Equal("sales",fk.PrincipalEntityType.GetSchema()));Assert.Contains(model.FindEntityType(typeof(SourcingConversion))!.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual(["AcceptanceId"]));Assert.Equal(new[]{"ActorId","Operation","CommandId"},model.FindEntityType(typeof(CartOfferCommandReceipt))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));
    }
    [Fact] public async Task ConversionAndV2CoreRequireSerializableBeforeDatabaseUse()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var carts=new CartService(db,null!,null!,TimeProvider.System);var conversion=new SourcingConversionService(db,carts,new(db,TimeProvider.System,true),null!,TimeProvider.System,true);var input=Input();await Assert.ThrowsAsync<InvalidOperationException>(()=>conversion.AcquireCommandLockAsync("owner",input.RequestId,default));await Assert.ThrowsAsync<InvalidOperationException>(()=>conversion.ReplayAsync("owner",Id(),Id(),input,default));var v2=new CartV2Service(db,carts,null!,null!,null!,TimeProvider.System,true);await Assert.ThrowsAsync<InvalidOperationException>(()=>v2.ReadVersionAsync(new("owner",null),default));await Assert.ThrowsAsync<InvalidOperationException>(()=>v2.ReadAsync(new("owner",null),"en",default));await Assert.ThrowsAsync<InvalidOperationException>(()=>new CartOfferService(db,carts,TimeProvider.System,true).RemoveAsync("owner","en",Id(),new(Id(),V),default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
}
