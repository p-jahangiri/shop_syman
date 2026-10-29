using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

public sealed class PhoneDiscoveryRulesTests
{
    private static readonly string ConfigurationId="11111111111141118111111111111111";
    private static readonly string Version="AAAAAAAAAAE=";
    private static readonly string Fingerprint=new('A',64);
    private static PhoneConfigurationSnapshot Configuration()=>new(ConfigurationId,"phone",8,256,"black","مشکی","Black","#000000","/products/phone.svg",null,Version,Fingerprint);
    private static SourcingAttributeSnapshot Memory(string key,string fa,string en)=>new(key,key,"Select",key,key,null,null,null,null,null,null,null,[new("option-"+key,fa,en)]);
    private static OfferSkuSnapshot Sku()=>new("variant","phone","seller","sku",new("phone","phone","phones","گوشی","Phones","samsung","Samsung","گوشی","Phone","شرح","Description",["/products/phone.svg"],[Memory("ram","۸ گیگابایت","8 GB"),Memory("storage","۱۲۸ گیگابایت","128 GB")]),"۲۵۶ گیگابایت","256 GB","#000000","مشکی","Black","ضمانت","Warranty",[Memory("storage","۲۵۶ گیگابایت","256 GB")],["online"],null,[],"9223372036854775807",Version,Fingerprint,Fingerprint);

    [Fact]public void MatchingUsesTheExactModelMemoryAndColorWithVariantOverridesAndNeverThePublicPrice()
    {
        var configuration=Configuration();var sku=Sku();Assert.True(PhoneDiscoveryRules.Matches(configuration,sku));Assert.True(PhoneDiscoveryRules.Matches(configuration,sku with{PublicPriceRial="0"}));
        Assert.False(PhoneDiscoveryRules.Matches(configuration with{RamGb=12},sku));Assert.False(PhoneDiscoveryRules.Matches(configuration with{StorageGb=128},sku));Assert.False(PhoneDiscoveryRules.Matches(configuration,sku with{ProductId="another-phone"}));
        Assert.False(PhoneDiscoveryRules.Matches(configuration with{ColorNameFa="سفید",ColorNameEn="White",ColorHex="#ffffff"},sku));Assert.False(PhoneDiscoveryRules.Matches(configuration,sku with{ColorNameFa="سفید",ColorNameEn="White",Color="#000000"}));
        Assert.True(PhoneDiscoveryRules.Matches(configuration with{LinkedVariantId="variant"},sku));Assert.False(PhoneDiscoveryRules.Matches(configuration with{LinkedVariantId="different-variant"},sku));
    }
    [Fact]public void UnknownAmbiguousOrUnlabelledMemoryDoesNotPretendToMatchAConfiguredPhone()
    {
        var sku=Sku();Assert.False(PhoneDiscoveryRules.Matches(Configuration(),sku with{Attributes=[Memory("storage","نامعلوم","Unknown")]}));
        var ambiguous=Memory("storage","۲۵۶ گیگابایت","256 GB") with{Options=[new("a","۱۲۸ گیگابایت","128 GB"),new("b","۲۵۶ گیگابایت","256 GB")]};Assert.False(PhoneDiscoveryRules.Matches(Configuration(),sku with{Attributes=[ambiguous]}));
        Assert.False(PhoneDiscoveryRules.Matches(Configuration(),sku with{Attributes=[Memory("storage","۲۵۶","256")]}));
    }
    [Theory][InlineData("۱ ترابایت","1 TB",1024)][InlineData("۰٫۵ ترابایت","0.5 TB",512)][InlineData("۰٫۱ ترابایت","0.1 TB",null)][InlineData("۳۳ ترابایت","33 TB",null)]
    public void StorageUnitsConvertToExactGigabytesWithoutRounding(string fa,string en,int? expected)
    {
        Assert.Equal(expected,PhoneDiscoveryRules.MemoryGb(Memory("storage",fa,en)));Assert.Equal(1024,PhoneDiscoveryRules.MemoryGb(Memory("storage","","") with{Number=1,Unit="TB"}));
        Assert.True(PhoneDiscoveryRules.Matches(Configuration() with{StorageGb=1024},Sku() with{Attributes=[Memory("storage","۱ ترابایت","1 TB")]}));
    }
    [Fact]public void ConfigurationInputsNormalizeDisplayFieldsAndRejectUnboundedOrInventedNumericFacts()
    {
        var input=new PhoneConfigurationInput(true,8,256,"black"," مشکی "," Black ","#AaBbCc",null,null);var normalized=PhoneDiscoveryRules.Normalize(input);Assert.Equal("مشکی",normalized.ColorNameFa);Assert.Equal("Black",normalized.ColorNameEn);Assert.Equal("#aabbcc",normalized.ColorHex);
        foreach(var invalid in new[]{input with{RamGb=0},input with{RamGb=129},input with{StorageGb=0},input with{StorageGb=32769},input with{ColorKey="black white"},input with{ColorNameEn=" "},input with{ColorHex="#abc"},input with{LinkedVariantId="not a variant"}})Assert.Throws<BusinessException>(()=>PhoneDiscoveryRules.Normalize(invalid));
    }
    [Fact]public void SpecificationsUseMetadataLabelsAndLocalizedTypedValuesWithoutLosingDecimalPrecision()
    {
        var value=Memory("screen","هشت","Eight") with{Options=[],DataType="Number",Number=6.123456789m,Unit="inch",UnitFa="اینچ",UnitEn="inches"};Assert.Equal("6.123456789 اینچ",PhoneDiscoveryService.SpecificationValue("fa",value));Assert.Equal("6.123456789 inches",PhoneDiscoveryService.SpecificationValue("en",value));Assert.Equal("بله",PhoneDiscoveryService.SpecificationValue("fa",value with{Number=null,Bool=true}));Assert.Equal("Black, White",PhoneDiscoveryService.SpecificationValue("en",value with{Options=[new("black","مشکی","Black"),new("white","سفید","White")]}));
    }
    [Fact]public void ExistingSourcingRecordConstructorsAndNullDefaultWireShapesRemainCompatible()
    {
        Assert.NotNull(typeof(SourcingCandidate).GetConstructor([typeof(string),typeof(SourcingModelSnapshot),typeof(string),typeof(string),typeof(string),typeof(string),typeof(string),typeof(DateTimeOffset?),typeof(DateTimeOffset?),typeof(string),typeof(bool),typeof(bool),typeof(string)]));
        Assert.NotNull(typeof(SourcingCartSelection).GetConstructor([typeof(string),typeof(int)]));Assert.NotNull(typeof(CartSourcingLineData).GetConstructor([typeof(string),typeof(int),typeof(SourcingCandidate)]));Assert.NotNull(typeof(CartSourcingLineInput).GetConstructor([typeof(string),typeof(int)]));
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var candidate=new SourcingCandidate("listing",null,null,null,null,null,null,null,null,null,false,false,"unavailable");
        Assert.DoesNotContain("configurationId",JsonSerializer.Serialize(new CartSourcingLineData("listing",1,candidate),json));Assert.DoesNotContain("configuration",JsonSerializer.Serialize(candidate,json));Assert.DoesNotContain("configurationId",JsonSerializer.Serialize(new CartSourcingLineInput("listing",1),json));
        var configured=new CartSourcingLineInput("listing",1){ConfigurationId=ConfigurationId};Assert.Contains("\"configurationId\":\""+ConfigurationId+"\"",JsonSerializer.Serialize(configured,json));
    }
    [Fact]public void PhoneDiscoveryPublicDtoHasNoSourceReferencePriceOrPayableAmount()
    {
        var model=new CatalogModelDto("phone","phone","phones","samsung","Samsung","گوشی","Phone","Description","/products/phone.svg",["/products/phone.svg"],new());
        var choice=new PhoneChoice(ConfigurationId,8,256,"black","مشکی","Black",null,null,Version,false,null,null,true,true);var json=JsonSerializer.Serialize(new PhoneItem("listing",model,true,[choice]),new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull});
        foreach(var privateField in new[]{"source","referencePrice","publicPrice","unitPrice","canPay"})Assert.DoesNotContain(privateField,json,StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"colorHex\":null",json);Assert.Contains("\"imageUrl\":null",json);Assert.Contains("\"storeSlug\":null",json);Assert.Contains("\"variantId\":null",json);
    }
}
