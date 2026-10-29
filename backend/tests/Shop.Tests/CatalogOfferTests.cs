using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CatalogOfferTests
{
    private static OfferSkuSnapshot Snapshot()=>new("variant","model","sayman","SKU-1",
        new("model","sample-model","phones","گوشی","Phones","brand","Brand","گوشی نمونه","Sample phone","توضیح","Description",["/products/phone-green.svg"],[]),
        "مشکی ۱۲۸","Black 128","#000000","مشکی","Black","گارانتی نمونه","Sample warranty",[],["online","cheque"],null,["plan"],"9007199254740993","AAAAAAAAAAE=","","");
    private static CatalogOfferVersion[] Versions()=>[new("product","model","AAAAAAAAAAE="),new("variant","variant","AAAAAAAAAAI=")];
    private static AttributeDefinition Definition(AttributeDataType type)=>new(){Id="attribute",Key="attribute",DataType=type,Unit="unit",Translations=[new(){Locale="fa",Name="عنوان",Unit="واحد"},new(){Locale="en",Name="Label",Unit="Unit"}]};

    [Fact] public async Task EmptyOrInvalidSelectedReadsNeverOpenSql()
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var reader=new CatalogOfferReader(db,TimeProvider.System);
        Assert.Empty(await reader.ReadAsync([],CancellationToken.None));
        foreach(var ids in new[]{new[]{"same","SAME"},new[]{"invalid/id"},Enumerable.Range(0,65).Select(i=>"v"+i).ToArray(),null!}){
            Assert.Equal("invalid_offer_catalog",(await Assert.ThrowsAsync<BusinessException>(()=>reader.ReadAsync(ids,CancellationToken.None))).Code);
        }
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public async Task InvalidLookupAndCrossModelCursorFailBeforeSql()
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var reader=new CatalogOfferReader(db,TimeProvider.System);
        var cursor=CatalogOfferPaging.Encode("variant",CatalogOfferLookup.Create("model-one",null));
        Assert.Equal("invalid_offer_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>reader.LookupAsync("model-two",null,cursor,CancellationToken.None))).Code);
        Assert.Equal("invalid_offer_catalog",(await Assert.ThrowsAsync<BusinessException>(()=>reader.LookupAsync("model",new string('q',121),null,CancellationToken.None))).Code);
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void EligibilityQueryUsesRealPublishedPhysicalSkuWithoutAnyInventoryOrMarketDependency()
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql=CatalogOfferQuery.Read(db,DateTimeOffset.Parse("2026-10-24T00:00:00Z")).Where(r=>r.Variant.Id=="variant").ToQueryString();
        foreach(var field in new[]{"PublishAt","Published","IsDigital","IsActive","ProductPurchaseMethod","Version","Sku"})Assert.Contains(field,sql);
        Assert.DoesNotContain("AvailableStock",sql);Assert.DoesNotContain("MarketModels",sql);Assert.DoesNotContain("Stock",sql);
    }
    [Fact] public void LookupQueryBindsTheModelAndKeysetAndNeverReturnsAllProducts()
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql=CatalogOfferQuery.Lookup(db,CatalogOfferLookup.Create("requested-model","SKU 12"),"last-variant",DateTimeOffset.UtcNow).Take(21).ToQueryString();
        Assert.Contains("requested-model",sql);Assert.Contains("last-variant",sql);Assert.Contains("SearchSku",sql);Assert.Contains("ORDER BY",sql);Assert.Contains("TOP",sql);Assert.DoesNotContain("AvailableStock",sql);
    }
    [Fact] public void CursorIsBoundToNormalizedSearchAndRequestedModel()
    {
        var first=CatalogOfferLookup.Create("model","گوشي ۱۲");var normalized=CatalogOfferLookup.Create("model","گوشی 12");
        var cursor=CatalogOfferPaging.Encode("after",first);Assert.Equal("after",CatalogOfferPaging.Decode(cursor,normalized));
        Assert.Equal("invalid_offer_cursor",Assert.Throws<BusinessException>(()=>CatalogOfferPaging.Decode(cursor,CatalogOfferLookup.Create("other","گوشی 12"))).Code);
        Assert.Equal("invalid_offer_cursor",Assert.Throws<BusinessException>(()=>CatalogOfferPaging.Decode(cursor,CatalogOfferLookup.Create("model","گوشی 13"))).Code);
        Assert.Null(CatalogOfferPaging.Decode(null,first));
    }
    [Fact] public void CursorRejectsMalformedOversizeAndUnknownFields()
    {
        var query=CatalogOfferLookup.Create("model",null);
        var unknown=Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{After="x",Filter=query.Binding,Unexpected=true}))).TrimEnd('=').Replace('+','-').Replace('/','_');
        foreach(var value in new[]{"",new string('x',201),"bad=",unknown})Assert.Equal("invalid_offer_cursor",Assert.Throws<BusinessException>(()=>CatalogOfferPaging.Decode(value,query)).Code);
    }
    [Fact] public void PublicPriceAndRowversionChangesDoNotChangeMaterialConsent()
    {
        var before=Snapshot();var price=before with{PublicPriceRial="9223372036854775807",Version="AAAAAAAAAAM="};
        Assert.Equal(CatalogOfferSnapshots.MaterialFingerprint(before),CatalogOfferSnapshots.MaterialFingerprint(price));
        Assert.NotEqual(CatalogOfferSnapshots.CurrentFingerprint(before,Versions()),CatalogOfferSnapshots.CurrentFingerprint(price,Versions()));
        Assert.NotEqual(CatalogOfferSnapshots.CurrentFingerprint(before,Versions()),CatalogOfferSnapshots.CurrentFingerprint(before,[Versions()[0],Versions()[1] with{Version="AAAAAAAAAAQ="}]));
    }
    [Fact] public void WarrantyModelContentAndMethodChangesAreMaterial()
    {
        var before=Snapshot();var original=CatalogOfferSnapshots.MaterialFingerprint(before);
        foreach(var changed in new[]{before with{WarrantyEn="Different warranty"},before with{Model=before.Model with{DescriptionFa="توضیح جدید"}},before with{VariantMethodIds=["online"]},before with{ChequePlanIds=[]},before with{ColorNameFa="سفید"}})Assert.NotEqual(original,CatalogOfferSnapshots.MaterialFingerprint(changed));
    }
    [Fact] public void MaterialHashCanonicalizesAttributeOptionAndMethodOrderButPreservesImageOrder()
    {
        var selected=new SourcingAttributeSnapshot("select","select","MultiSelect","گزینه","Option",null,null,null,null,null,null,null,[new("b","ب","B"),new("a","الف","A")]);
        var number=new SourcingAttributeSnapshot("number","number","Number","عدد","Number",null,null,null,null,null,0,null,[]);
        var value=Snapshot() with{Attributes=[selected,number]};
        var reordered=value with{Attributes=[number,selected with{Options=selected.Options.Reverse().ToArray()}],ProductMethodIds=value.ProductMethodIds.Reverse().ToArray()};
        Assert.Equal(CatalogOfferSnapshots.MaterialFingerprint(value),CatalogOfferSnapshots.MaterialFingerprint(reordered));
        var images=value with{Model=value.Model with{Images=["first","second"]}};Assert.NotEqual(CatalogOfferSnapshots.MaterialFingerprint(images),CatalogOfferSnapshots.MaterialFingerprint(images with{Model=images.Model with{Images=images.Model.Images.Reverse().ToArray()}}));
    }
    [Fact] public void InheritedMethodsAndAnExplicitEmptySubsetRemainDifferentAndNullIsSerialized()
    {
        var inherited=Snapshot();Assert.NotEqual(CatalogOfferSnapshots.MaterialFingerprint(inherited),CatalogOfferSnapshots.MaterialFingerprint(inherited with{VariantMethodIds=[]}));
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};
        using var document=JsonDocument.Parse(JsonSerializer.Serialize(inherited,options));Assert.Equal(JsonValueKind.Null,document.RootElement.GetProperty("variantMethodIds").ValueKind);
        Assert.Equal("9007199254740993",document.RootElement.GetProperty("publicPriceRial").GetString());
        using var page=JsonDocument.Parse(JsonSerializer.Serialize(new OfferSkuPage(1,20,[],null),options));Assert.Equal(JsonValueKind.Null,page.RootElement.GetProperty("nextCursor").ValueKind);
    }
    [Fact] public void TypedSnapshotsKeepZeroFalseUnitsAndSelectedOptionTranslations()
    {
        var number=CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Number),null,null,0,null,null,[],new Dictionary<string,AttributeOption>());
        var flag=CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Bool),null,null,null,false,null,[],new Dictionary<string,AttributeOption>());
        Assert.Equal(0,number.Number);Assert.False(flag.Bool);Assert.Equal("واحد",number.UnitFa);Assert.Equal("Unit",number.UnitEn);
        using var json=JsonDocument.Parse(JsonSerializer.Serialize(number,new JsonSerializerOptions(JsonSerializerDefaults.Web)));Assert.Equal("0",json.RootElement.GetProperty("number").GetString());
        var option=new AttributeOption{AttributeId="attribute",Id="option",Value="black",LabelFa="مشکی",LabelEn="Black"};
        var select=CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Select),null,null,null,null,"option",[],new Dictionary<string,AttributeOption>{{"option",option}});
        Assert.Equal("مشکی",Assert.Single(select.Options).LabelFa);Assert.Equal("Black",Assert.Single(select.Options).LabelEn);
        var multi=CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.MultiSelect),null,null,null,null,null,["option"],new Dictionary<string,AttributeOption>{{"option",option}});Assert.Equal("MultiSelect",multi.DataType);
    }
    [Fact] public void InvalidTypedPersistedValuesNeverBecomeInventedDisplayText()
    {
        foreach(var action in new Action[]{
            ()=>CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Number),null,null,null,null,null,[],new Dictionary<string,AttributeOption>()),
            ()=>CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Number),null,null,0,false,null,[],new Dictionary<string,AttributeOption>()),
            ()=>CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Number),null,null,0.000000001m,null,null,[],new Dictionary<string,AttributeOption>()),
            ()=>CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.Select),null,null,null,null,"missing",[],new Dictionary<string,AttributeOption>()),
            ()=>CatalogOfferSnapshots.Attribute(Definition(AttributeDataType.MultiSelect),null,null,null,null,null,["same","same"],new Dictionary<string,AttributeOption>())
        })Assert.Equal("catalog_unavailable",Assert.Throws<BusinessException>(action).Code);
    }
}
