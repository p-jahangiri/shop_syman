using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingOfferTests
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static OfferSkuSnapshot Sku(params SourcingAttributeSnapshot[] attributes)=>new("sku-id","model","seller","SKU-REAL",new("model","model-slug","phones","گوشی","Phones","brand","Brand","نمونه","Sample","توضیح","Description",["/products/phone-green.svg"],attributes),"نسخه","Version","#777777","خاکستری","Gray","گارانتی صریح نمونه","Explicit synthetic warranty",[],["online"],null,[],"9007199254740993",V,Hash,Hash);
    private static SourcingOfferLineInput Line(int quantity=1,string price="9007199254740993")=>new(Id(),Id(),"sku-id",quantity,price,Hash,Hash);
    private static SourcingOfferSaveInput Input(params SourcingOfferLineInput[] lines)=>new(Guid.NewGuid().ToString("D"),V,null,lines.Length==0?[Line()]:lines,"شرایط نمونهٔ صریح","Explicit synthetic terms",new(2030,1,1,0,0,0,TimeSpan.Zero),new(2030,1,2,0,0,0,TimeSpan.Zero));
    [Fact] public void DraftNormalizationKeepsExactMoneyCanonicalOrderAndExplicitTerms()
    {
        var a=Line(price:"0");var b=Line() with{VariantId="second-sku"};var input=Input(b,a) with{TermsFa="  متن\r\nنمونه  "};var result=SourcingOfferRules.Normalize(input);Assert.Equal(Guid.Parse(input.RequestId).ToString("N"),result.RequestId);Assert.Equal("متن\nنمونه",result.TermsFa);Assert.Null(result.Version);Assert.Null(result.ExpectedAt);Assert.Equal(new[]{a.LineId,b.LineId}.Order(StringComparer.Ordinal),result.Lines.Select(l=>l.LineId));Assert.Equal("9007199254740993",result.Lines.Single(l=>l.VariantId=="second-sku").UnitPriceRial);
        Assert.Equal(SourcingRules.Payload(result),SourcingRules.Payload(SourcingOfferRules.Normalize(input with{Lines=input.Lines.Reverse().ToArray()})));
    }
    [Theory][InlineData("0",0L)][InlineData("9007199254740993",9007199254740993L)][InlineData("9223372036854775807",long.MaxValue)]
    public void RialIsCanonicalNonnegativeInt64(string value,long expected)=>Assert.Equal(expected,SourcingOfferRules.Price(value));
    [Theory][InlineData("-1")][InlineData("00")][InlineData("01")][InlineData("۱")][InlineData("1.0")][InlineData("1,000")][InlineData("9223372036854775808")][InlineData("")]
    public void RialRejectsLossyOrNoncanonicalRepresentations(string value)=>Assert.Throws<BusinessException>(()=>SourcingOfferRules.Price(value));
    [Fact] public void CheckedLineAndAggregateTotalsRejectOverflowWithoutRounding()
    {
        Assert.Equal(long.MaxValue,SourcingOfferRules.Total([(1,long.MaxValue),(1000000,0)]));Assert.Equal("sourcing_offer_amount_limit",Assert.Throws<BusinessException>(()=>SourcingOfferRules.Total([(2,long.MaxValue)])).Code);Assert.Equal("sourcing_offer_amount_limit",Assert.Throws<BusinessException>(()=>SourcingOfferRules.Total([(1,long.MaxValue),(1,1)])).Code);Assert.Throws<BusinessException>(()=>SourcingOfferRules.Normalize(Input(Line(2,long.MaxValue.ToString(System.Globalization.CultureInfo.InvariantCulture)))));
    }
    [Fact] public void DraftRejectsAmbiguousDatesQuantitiesDuplicatesAndUnboundedTerms()
    {
        var input=Input();var line=input.Lines[0];foreach(var invalid in new[]{input with{AcceptUntil=input.AcceptUntil.ToOffset(TimeSpan.FromHours(1))},input with{PurchaseUntil=input.AcceptUntil.AddTicks(-1)},input with{ExpectedAt=input.AcceptUntil.ToOffset(TimeSpan.FromHours(1))},input with{Lines=[]},input with{Lines=[line,line]},input with{Lines=[line with{Quantity=0}]},input with{Lines=[line with{Quantity=1000001}]},input with{TermsFa=" "},input with{TermsEn=new string('a',4001)},input with{Version="bad"},input with{RequestVersion="bad"},input with{Lines=[line with{MaterialFingerprint=new string('a',64)}]}})Assert.Throws<BusinessException>(()=>SourcingOfferRules.Normalize(invalid));
    }
    [Fact] public void TypedRelationalSnapshotRetainsZeroFalseBothUnitsOptionsAndNullMethodOverride()
    {
        var number=new SourcingAttributeSnapshot("number","number","Number","عدد","Number","GB","گیگابایت","Gigabytes",null,null,0,null,[]);var boolean=new SourcingAttributeSnapshot("bool","bool","Bool","بله","Yes",null,null,null,null,null,null,false,[]);var choice=new SourcingAttributeSnapshot("port","port","MultiSelect","درگاه","Ports",null,null,null,null,null,null,null,[new("usb","یو‌اس‌بی","USB"),new("typec","تایپ سی","Type C")]);var text=new SourcingAttributeSnapshot("text","text","Text","متن","Text",null,null,null,"فارسی","English",null,null,[]);var select=choice with{AttributeId="color",Key="color",DataType="Select",Options=[new("gray","خاکستری","Gray")]};
        var sku=Sku(number,boolean,choice,text,select) with{Attributes=[number,boolean]};var input=Line();var row=SourcingOfferSnapshots.Store(Id(),input,sku);var restored=SourcingOfferSnapshots.Read(row);Assert.Equal(7,row.Attributes.Count);Assert.Equal(2,restored.Sku.Attributes.Length);Assert.Equal(5,restored.Sku.Model.Attributes.Length);Assert.Equal(0,restored.Sku.Model.Attributes.Single(a=>a.DataType=="Number").Number);Assert.False(restored.Sku.Model.Attributes.Single(a=>a.DataType=="Bool").Bool);Assert.Equal("گیگابایت",restored.Sku.Attributes[1].UnitFa);Assert.Equal("Gigabytes",restored.Sku.Attributes[1].UnitEn);Assert.Null(restored.Sku.VariantMethodIds);Assert.Equal("9007199254740993",restored.UnitPriceRial);Assert.Equal("9007199254740993",restored.LineTotalRial);Assert.Contains("\"number\":\"0\"",JsonSerializer.Serialize(restored,new JsonSerializerOptions(JsonSerializerDefaults.Web)));Assert.Contains("\"bool\":false",JsonSerializer.Serialize(restored,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    [Fact] public void MaterialConsentHashExcludesPublicPriceAndCatalogVersionButIncludesAgreedTerms()
    {
        var offer=new SourcingOffer{Id=Id(),RequestId=Id(),Revision=1,TermsFa="فارسی",TermsEn="English",AcceptUntil=Input().AcceptUntil,PurchaseUntil=Input().PurchaseUntil};offer.Lines.Add(SourcingOfferSnapshots.Store(offer.Id,Line(),Sku()));var initial=SourcingOfferSnapshots.TermsHash(offer);offer.Lines[0].PublicPriceRial=1;offer.Lines[0].CatalogVersion="AAAAAAAAAAI=";offer.Lines[0].CurrentFingerprint=new string('B',64);Assert.Equal(initial,SourcingOfferSnapshots.TermsHash(offer));offer.Lines[0].UnitPriceRial++;Assert.NotEqual(initial,SourcingOfferSnapshots.TermsHash(offer));offer.Lines[0].UnitPriceRial--;offer.Lines[0].MaterialFingerprint=new string('C',64);Assert.NotEqual(initial,SourcingOfferSnapshots.TermsHash(offer));offer.Lines[0].MaterialFingerprint=Hash;offer.PurchaseUntil=offer.PurchaseUntil.AddSeconds(1);Assert.NotEqual(initial,SourcingOfferSnapshots.TermsHash(offer));
    }
    [Fact] public void SnapshotAcceptsActualCatalogStringBoundsAndRejectsInvalidIdentityOrTypedValues()
    {
        var sku=Sku() with{LabelFa=new string('x',2000),Color=new string('c',2000),ColorNameEn=new string('c',2000),WarrantyFa=new string('w',2000)};SourcingOfferSnapshots.Validate(sku);Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{WarrantyFa=new string('w',2001)}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{ProductId="foreign"}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{ProductMethodIds=[]}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{VariantMethodIds=["foreign-method"]}));
    }
    [Theory][InlineData(201)][InlineData(2000)]
    public void OfferMetadataRetainsActualCatalogLabelsOptionLabelsAndTranslatedUnits(int length)
    {
        var fa=new string('ف',length);var en=new string('e',length);var number=new SourcingAttributeSnapshot("number","number","Number",fa,en,"GB",fa,en,null,null,0,null,[]);var select=new SourcingAttributeSnapshot("select","select","Select",fa,en,null,null,null,null,null,null,null,[new("option",fa,en)]);var sku=Sku(number,select) with{Attributes=[number,select]};SourcingOfferSnapshots.Validate(sku);var stored=SourcingOfferSnapshots.Store(Id(),Line(),sku);var restored=SourcingOfferSnapshots.Read(stored).Sku;
        foreach(var values in new[]{restored.Model.Attributes,restored.Attributes}){Assert.Equal(fa,values[0].LabelFa);Assert.Equal(en,values[0].LabelEn);Assert.Equal("GB",values[0].Unit);Assert.Equal(fa,values[0].UnitFa);Assert.Equal(en,values[0].UnitEn);Assert.Equal(fa,values[1].Options[0].LabelFa);Assert.Equal(en,values[1].Options[0].LabelEn);Assert.Equal(0,values[0].Number);}
        Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{Attributes=[number with{LabelFa=new string('ف',2001)}]}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{Attributes=[number with{UnitFa=new string('ف',2001)}]}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{Attributes=[number with{Unit=new string('u',81)}]}));Assert.Throws<BusinessException>(()=>SourcingOfferSnapshots.Validate(sku with{Attributes=[select with{Options=[new("option",new string('ف',2001),en)]}]}));
    }
    [Fact] public void ExpiryUsesDeadlineBoundaryAndNeverChangesHistoricalAcceptedState()
    {
        var until=Input().AcceptUntil;var purchase=Input().PurchaseUntil;Assert.Equal("Published",SourcingOfferRules.EffectiveState("Published",until,purchase,until.AddTicks(-1)));Assert.Equal("Expired",SourcingOfferRules.EffectiveState("Published",until,purchase,until));Assert.Equal("Accepted",SourcingOfferRules.EffectiveState("Accepted",until,purchase,until));Assert.True(SourcingOfferRules.AcceptedBlocks("Accepted",true,purchase,purchase.AddTicks(-1)));Assert.False(SourcingOfferRules.AcceptedBlocks("Accepted",true,purchase,purchase));Assert.Equal("Expired",SourcingOfferRules.EffectiveState("Accepted",until,purchase,purchase));Assert.Equal("Withdrawn",SourcingOfferRules.EffectiveState("Withdrawn",until,purchase,purchase));Assert.False(SourcingOfferRules.AcceptedBlocks("Accepted",false,purchase,until));
    }
    [Fact] public void OfferWireNullsAndHistoricalMutationStayExplicitUnderApplicationSerializer()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var at=Input().AcceptUntil;var summary=new SourcingOfferSummary(Id(),1,"Draft","Draft",V,Hash,"9007199254740993",1,1,at,at,null,at,at,null,null,true);var page=JsonSerializer.Serialize(new SourcingOfferPage(1,Id(),"SR-1",V,20,[summary],null,true,false),options);Assert.Contains("\"expectedAt\":null",page);Assert.Contains("\"publishedAt\":null",page);Assert.Contains("\"acceptedAt\":null",page);Assert.Contains("\"nextCursor\":null",page);Assert.Contains("\"consentOnly\":true",page);Assert.Contains("\"canPay\":false",page);Assert.DoesNotContain("actorId",page);Assert.Contains("\"stateBefore\":null",JsonSerializer.Serialize(new SourcingOfferEventData("9007199254740993",1,null,"Draft","staff","offer_draft_saved","",at),options));Assert.Contains("\"acceptanceId\":null",JsonSerializer.Serialize(new SourcingOfferMutation(1,Id(),Id(),"save",1,"Draft",V,V,"9007199254740993",null,at,true),options));
    }
    [Fact] public void ModelUsesOwnedRelationalSnapshotsConcurrencyAndUniqueActiveOfferPerRequest()
    {
        using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedOfferModel;Integrated Security=true;TrustServerCertificate=true").Options);var offer=db.Model.FindEntityType(typeof(SourcingOffer))!;Assert.False(db.Model.FindEntityType(typeof(SourcingOfferAcceptance))!.FindProperty(nameof(SourcingOfferAcceptance.Id))!.IsNullable);Assert.True(offer.FindProperty(nameof(SourcingOffer.Version))!.IsConcurrencyToken);Assert.Contains(offer.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual([nameof(SourcingOffer.RequestId)])&&i.GetFilter()=="[IsActive] = 1");Assert.Equal(28,db.Model.FindEntityType(typeof(SourcingOfferAttribute))!.FindProperty(nameof(SourcingOfferAttribute.Number))!.GetPrecision());Assert.Equal(8,db.Model.FindEntityType(typeof(SourcingOfferAttribute))!.FindProperty(nameof(SourcingOfferAttribute.Number))!.GetScale());Assert.Equal(2000,db.Model.FindEntityType(typeof(SourcingOfferLine))!.FindProperty(nameof(SourcingOfferLine.WarrantyFa))!.GetMaxLength());foreach(var name in new[]{"LabelFa","LabelEn","UnitFa","UnitEn"})Assert.Equal(2000,db.Model.FindEntityType(typeof(SourcingOfferAttribute))!.FindProperty(name)!.GetMaxLength());Assert.Equal(80,db.Model.FindEntityType(typeof(SourcingOfferAttribute))!.FindProperty("Unit")!.GetMaxLength());foreach(var name in new[]{"LabelFa","LabelEn"})Assert.Equal(2000,db.Model.FindEntityType(typeof(SourcingOfferOption))!.FindProperty(name)!.GetMaxLength());Assert.All(db.Model.GetEntityTypes().Where(t=>t.ClrType.Name.StartsWith("SourcingOffer",StringComparison.Ordinal)).SelectMany(t=>t.GetForeignKeys()),fk=>Assert.Equal("market",fk.PrincipalEntityType.GetSchema()));
    }
    private sealed class NoReader:ICatalogOfferReader
    {
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)=>throw new InvalidOperationException("Reader must not run before the root transaction assertion.");
        public Task<OfferSkuPage> LookupAsync(string model,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class NoPurchase:IPurchaseConfiguration
    {
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new NotSupportedException();
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new NotSupportedException();
    }
    [Fact] public async Task EveryCommandRejectsMissingRootSerializableTransactionBeforeAnyReadOrWrite()
    {
        using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedOfferTransaction;Integrated Security=true;TrustServerCertificate=true").Options);var service=new SourcingOfferService(db,new NoReader(),new NoPurchase(),TimeProvider.System,true);var request=Id();var offer=Id();var input=Input();var action=new SourcingOfferActionInput(input.RequestId,V,V,Hash);foreach(var call in new Func<Task>[] {()=>service.SaveDraftAsync("actor",request,offer,input,CancellationToken.None),()=>service.PublishAsync("actor",request,offer,new(input.RequestId,V,V,Hash),CancellationToken.None),()=>service.WithdrawAsync("actor",request,offer,action,CancellationToken.None),()=>service.AcceptAsync("owner",request,offer,action,CancellationToken.None),()=>service.DeclineAsync("owner",request,offer,action,CancellationToken.None)}){var error=await Assert.ThrowsAsync<InvalidOperationException>(call);Assert.Contains("root Serializable",error.Message);}Assert.Empty(db.ChangeTracker.Entries());
    }
}
