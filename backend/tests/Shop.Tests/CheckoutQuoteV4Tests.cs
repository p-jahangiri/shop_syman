using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CheckoutQuoteV4Tests
{
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private const string V="AAAAAAAAAAA=";
    private static readonly string Hash=new('A',64);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed record Fixture(string CartId,CartOfferLine[] Cart,SourcingPriceAgreement Agreement,SourcingConversion Conversion);
    private static Fixture Data(int count=1)
    {
        var cartId=Id();var acceptance=Id();var agreementId=Id();var conversionId=Id();var allocationId=Id();
        var sku=new OfferSkuSnapshot("sku","model","seller","QA-QUOTE",new("model","qa-model","phones","گوشی","Phones","brand","Brand","نام پذیرفته","Accepted name","شرح","Description",[],[]),"گزینه پذیرفته","Accepted label","#123456","سبز","Green","گارانتی پذیرفته","Accepted warranty",[],["online"],null,[],"123",V,Hash,Hash);
        var plan=new AcceptedSourcingPurchasePlan(Id(),Id(),Id(),1,acceptance,"owner",Hash,V,V,V,At.AddHours(1),"شرایط","Terms",false,Enumerable.Range(0,count).Select(_=>new AcceptedSourcingPlanLine(Id(),Id(),2,"9007199254740993",sku)).ToArray());
        var agreement=new SourcingPriceAgreement{Id=agreementId,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,Revision=1,AcceptanceId=acceptance,OwnerId="owner",TermsHash=Hash,SnapshotHash=SourcingPriceAgreementRules.SnapshotHash(plan),TermsFa=plan.TermsFa,TermsEn=plan.TermsEn,PurchaseUntil=plan.PurchaseUntil,AllocationId=allocationId,State="Active",Version=Convert.FromBase64String(V),Lines=plan.Lines.Select(l=>new SourcingPriceAgreementLine{AgreementId=agreementId,Id=SourcingPriceAgreementRules.LineId(acceptance,l.OfferLineId),OfferLineId=l.OfferLineId,ListingId=l.ListingId,VariantId=l.Sku.VariantId,Quantity=l.Quantity,UnitPriceRial=9007199254740993,LineTotalRial=18014398509481986,SkuSnapshotJson=JsonSerializer.Serialize(l.Sku,new JsonSerializerOptions(JsonSerializerDefaults.Web))}).ToList()};
        var rows=agreement.Lines.Select(l=>new CartOfferLine{CartId=cartId,Id=CartOfferRules.OfferLineId(cartId,agreementId,l.Id),ConversionId=conversionId,AgreementId=agreementId,AgreementLineId=l.Id,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=acceptance,AllocationId=allocationId,AllocationVersion=V,AllocationExpiresAt=At.AddMinutes(10),OfferLineId=l.OfferLineId,VariantId=l.VariantId,Quantity=l.Quantity}).ToArray();
        var links=rows.Select(r=>new SourcingCartLineLink(r.Id,r.AgreementLineId,r.OfferLineId)).ToArray();
        var conversion=new SourcingConversion{Id=conversionId,OwnerId="owner",RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=acceptance,AgreementId=agreementId,AllocationId=allocationId,CartId=cartId,LineLinksJson=JsonSerializer.Serialize(links,new JsonSerializerOptions(JsonSerializerDefaults.Web))};
        return new(cartId,rows,agreement,conversion);
    }
    private static PreparedQuoteAgreementV4 Read(Fixture f,string locale="en")=>CheckoutQuoteV4Rules.Accepted(f.CartId,"OWNER",f.Cart,f.Agreement,f.Conversion,locale,At,false);
    [Fact] public void AcceptedPricesAndLocalizedMetadataRemainImmutableBeyondJavascriptPrecision()
    {
        var f=Data();var en=Assert.Single(Read(f).Lines);var fa=Assert.Single(Read(f,"fa").Lines);
        Assert.Equal("9007199254740993",en.UnitPriceRial);Assert.Equal("18014398509481986",en.LineTotalRial);Assert.Equal("Accepted name",en.Name);Assert.Equal("Accepted label",en.Label);Assert.Equal("Accepted warranty",en.Warranty);Assert.Equal("نام پذیرفته",fa.Name);Assert.Equal("گارانتی پذیرفته",fa.Warranty);Assert.Null(en.PriceVersion);Assert.Equal(f.Cart[0].Id,en.LineId);Assert.False(en.IsDigital);
        var stock=Read(f).StockPlan;Assert.Equal("sku",stock.Lines[0].VariantId);Assert.Equal(2,stock.Lines[0].Quantity);Assert.Equal(Hash,stock.Lines[0].MaterialFingerprint);Assert.DoesNotContain("Price",JsonSerializer.Serialize(stock),StringComparison.Ordinal);
    }
    [Theory] [InlineData("cart")] [InlineData("quantity")] [InlineData("allocation")] [InlineData("offer")] [InlineData("line")] [InlineData("conversion")] [InlineData("owner")] [InlineData("revoked")] [InlineData("consumed")] [InlineData("demo")]
    public void AcceptedSelectionCannotChangeOwnershipLineageQuantityOrLifecycle(string change)
    {
        var f=Data();switch(change){case "cart":f.Cart[0].CartId=Id();break;case "quantity":f.Cart[0].Quantity=1;break;case "allocation":f.Cart[0].AllocationId=Id();break;case "offer":f.Cart[0].OfferId=Id();break;case "line":f.Cart[0].Id=Id();break;case "conversion":f.Conversion.AllocationId=Id();break;case "owner":f.Agreement.OwnerId="another";break;case "revoked":f.Agreement.State="Revoked";break;case "consumed":f.Agreement.ConsumedOrderId=Id();break;case "demo":f.Agreement.ContainsDemo=true;break;}
        Assert.Equal("quote_accepted_offer_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
    }
    [Fact] public void WholeAgreementAndOriginalConversionLinksAreRequired()
    {
        var f=Data(2);Assert.Equal(2,Read(f).Lines.Length);
        Assert.Throws<BusinessException>(()=>CheckoutQuoteV4Rules.Accepted(f.CartId,"owner",f.Cart[..1],f.Agreement,f.Conversion,"en",At,false));
        f.Conversion.LineLinksJson=JsonSerializer.Serialize(new[]{new SourcingCartLineLink(Id(),f.Cart[0].AgreementLineId,f.Cart[0].OfferLineId),new SourcingCartLineLink(f.Cart[1].Id,f.Cart[1].AgreementLineId,f.Cart[1].OfferLineId)},new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal("quote_accepted_offer_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
    }
    [Fact] public void CommercialSnapshotAndArithmeticCorruptionCannotAuthorizeAQuote()
    {
        var f=Data();f.Agreement.TermsEn="Changed accepted terms";Assert.Equal("quote_accepted_offer_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
        f=Data();f.Agreement.Lines[0].LineTotalRial--;Assert.Equal("quote_accepted_offer_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
        f=Data();f.Agreement.Lines[0].UnitPriceRial=long.MaxValue;Assert.Equal("quote_amount_limit",Assert.Throws<BusinessException>(()=>Read(f)).Code);
    }
    [Fact] public void SameSkuHasIndependentAcceptedLineIdentitiesAndPrices()
    {
        var first=Read(Data()).Lines[0];var second=Read(Data()).Lines[0] with{UnitPriceRial="1",LineTotalRial="2"};
        Assert.Equal(first.VariantId,second.VariantId);Assert.NotEqual(first.LineId,second.LineId);Assert.NotEqual(first.UnitPriceRial,second.UnitPriceRial);Assert.NotEqual(CartOfferRules.OrdinaryLineId(Id(),first.VariantId),first.LineId);
        Assert.Equal(18014398509481988L,long.Parse(first.LineTotalRial,CultureInfo.InvariantCulture)+long.Parse(second.LineTotalRial,CultureInfo.InvariantCulture));
    }
    [Fact] public void DeadlinesAreStrictAndQuoteNeverOutlivesEitherAuthority()
    {
        var f=Data();var line=Read(f).Lines[0];Assert.Equal(At.AddMinutes(5),CheckoutQuoteV4Rules.Expiry(At,[line]));
        var nearer=line with{Accepted=line.Accepted! with{PurchaseUntil=At.AddMinutes(4),AllocationExpiresAt=At.AddMinutes(3)}};Assert.Equal(At.AddMinutes(3),CheckoutQuoteV4Rules.Expiry(At,[line,nearer]));
        Assert.Equal("quote_accepted_offer_expired_conflict",Assert.Throws<BusinessException>(()=>CheckoutQuoteV4Rules.Expiry(At.AddMinutes(3),[nearer])).Code);
        f.Cart[0].AllocationExpiresAt=At;Assert.Equal("quote_accepted_offer_expired_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
        f=Data();f.Agreement.PurchaseUntil=At;Assert.Equal("quote_accepted_offer_expired_conflict",Assert.Throws<BusinessException>(()=>Read(f)).Code);
    }
    [Fact] public void ConfiguredTemporaryOrderingIsStillExplicitlyUnavailableForAcceptedQuotes()
    {
        var enabled=new TemporaryOrderOption(true,60,true,[],V);var fenced=CheckoutQuoteV4Rules.Fence(enabled);Assert.False(fenced.CanCreate);Assert.Equal(60,fenced.ReservationMinutes);Assert.Equal(V,fenced.SettingsVersion);Assert.Equal(["accepted_offer_order_unavailable"],fenced.Blockers);Assert.Equal(fenced.Blockers,CheckoutQuoteV4Rules.Fence(fenced).Blockers);
    }
    [Fact] public void WireRetainsRequiredNullsDecimalStringsAndAnExplicitPaymentFence()
    {
        var accepted=Read(Data()).Lines[0];var ordinary=accepted with{LineId=Id(),LineKind="ordinary",UnitPriceRial="123",LineTotalRial="246",PriceVersion=V,Accepted=null};
        var data=new CheckoutQuoteV4Data(4,"en",null,V,Hash,At,At.AddMinutes(5),[ordinary,accepted],"18014398509482232","0","0","18014398509482232",true,null,null,null,[],[],null,null,[],false,false,[CheckoutQuoteV4Rules.OrderUnavailable],TemporaryOrder:CheckoutQuoteV4Rules.Fence(new(true,15,true,[])));
        var json=JsonSerializer.Serialize(data,new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull});using var doc=JsonDocument.Parse(json);
        Assert.Equal(JsonValueKind.Null,doc.RootElement.GetProperty("quoteId").ValueKind);
        Assert.Equal(JsonValueKind.Null,doc.RootElement.GetProperty("lines")[0].GetProperty("accepted").ValueKind);Assert.Equal(JsonValueKind.Null,doc.RootElement.GetProperty("lines")[1].GetProperty("priceVersion").ValueKind);Assert.Equal("9007199254740993",doc.RootElement.GetProperty("lines")[1].GetProperty("unitPriceRial").GetString());Assert.False(doc.RootElement.GetProperty("canPay").GetBoolean());Assert.False(doc.RootElement.GetProperty("canPlaceOrder").GetBoolean());
        foreach(var forbidden in new[]{"ownerId","supplierReference","snapshotHash"})Assert.DoesNotContain("\""+forbidden+"\":",json);
    }
    [Fact] public void AdditiveModelKeepsHistoricalKeysAndUsesLineIdentityForV4()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var model=db.GetService<IDesignTimeModel>().Model;var header=model.FindEntityType(typeof(CheckoutQuote))!;
        Assert.True(header.FindProperty(nameof(CheckoutQuote.ContractVersion))!.IsNullable);Assert.Equal(typeof(int?),header.FindProperty(nameof(CheckoutQuote.ContractVersion))!.ClrType);
        Assert.Equal(new[]{"QuoteId","VariantId"},model.FindEntityType(typeof(CheckoutQuoteLine))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));
        var line=model.FindEntityType(typeof(CheckoutQuoteLineV4))!;Assert.Equal(new[]{"QuoteId","LineId"},line.FindPrimaryKey()!.Properties.Select(p=>p.Name));Assert.Equal(typeof(long),line.FindProperty(nameof(CheckoutQuoteLineV4.UnitPriceRial))!.ClrType);Assert.True(line.FindProperty(nameof(CheckoutQuoteLineV4.PriceVersion))!.IsNullable);Assert.All(line.GetForeignKeys(),fk=>Assert.Equal(typeof(CheckoutQuote),fk.PrincipalEntityType.ClrType));
        var checks=line.GetCheckConstraints().ToArray();Assert.Contains(checks,c=>c.Name=="CK_QuoteLineV4_Provenance"&&c.Sql.Contains("[IsDigital]=0",StringComparison.Ordinal)&&c.Sql.Contains("[PriceVersion] IS NULL",StringComparison.Ordinal));Assert.Contains(checks,c=>c.Name=="CK_QuoteLineV4_Amount"&&c.Sql.Contains("decimal(38,0)",StringComparison.Ordinal));
    }
    [Fact] public async Task QuoteEntryRequiresParentSerializableBeforeAnySqlOrCapabilityRead()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var service=new CheckoutQuoteV4Service(db,null!,null!,null!,null!,null!,null!,null!,null!,TimeProvider.System,false);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CreateAsync(new("owner",null),"en",new(V,null,null,null),default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
}
