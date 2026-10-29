using System.Data;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingReceiptCatalogTests
{
    [Fact] public async Task InvalidAndEmptyReadsNeverOpenSql()
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var reader=new SourcingReceiptCatalogReader(db);
        Assert.Empty(await reader.ReadAsync([],CancellationToken.None));
        foreach(var ids in new[]{null!,new[]{"same","SAME"},new[]{"../variant"},Enumerable.Range(0,65).Select(i=>"v"+i).ToArray()})
            Assert.Equal("invalid_receiving_catalog",(await Assert.ThrowsAsync<BusinessException>(()=>reader.ReadAsync(ids,CancellationToken.None))).Code);
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public async Task ActualIdentityReadsRequireRootTransactionBeforeOpeningConnection()
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var reader=new SourcingReceiptCatalogReader(db);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>reader.ReadAsync(["physical"],CancellationToken.None));
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void QueryBindsOnlySelectedIdentitiesAndDoesNotImposePublicSaleEligibility()
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql=SourcingReceiptCatalogQuery.Read(db,["selected-sku"]).ToQueryString();
        Assert.Contains("selected-sku",sql);Assert.Contains("IsDigital",sql);Assert.Contains("ProductId",sql);
        foreach(var field in new[]{"PriceRial","Published","PublishAt","IsActive","AvailableStock","Translations","Stock]"})Assert.DoesNotContain(field,sql);
    }
    [Fact] public void MappingRejectsUnknownAndDigitalSku()
    {
        IReadOnlyDictionary<string,SourcingReceiptSkuIdentity> rows=new Dictionary<string,SourcingReceiptSkuIdentity>{{"physical",new("physical","model",false)},{"digital",new("digital","model",true)}};
        SourcingReceiptCatalogRules.AssertPhysical("physical",rows);
        foreach(var id in new[]{"missing","digital"})Assert.Equal("receiving_catalog_conflict",Assert.Throws<BusinessException>(()=>SourcingReceiptCatalogRules.AssertPhysical(id,rows)).Code);
    }
    [Fact] public void ReceivingCannotRemapAnAcceptedLineToAnotherModel()
    {
        var plan=new SourcingReceivingPlan("request","task","offer","acceptance","owner","hash",false,false,"version","version",[new("line","physical","accepted-model",2,0,"material")]);
        foreach(var current in new[]{new SourcingReceiptSkuIdentity("physical","other-model",false),new("physical","accepted-model",true)})
            Assert.Equal("receiving_catalog_conflict",Assert.Throws<BusinessException>(()=>SourcingReceiptCatalogRules.AssertPlan(plan,new Dictionary<string,SourcingReceiptSkuIdentity>{{"physical",current}})).Code);
        SourcingReceiptCatalogRules.AssertPlan(plan,new Dictionary<string,SourcingReceiptSkuIdentity>{{"physical",new("physical","accepted-model",false)}});
    }
    [Fact] public void AChangedUnreceivedSkuDoesNotPreventRecordingAnotherActuallyArrivedPhysicalLine()
    {
        var plan=new SourcingReceivingPlan("request","task","offer","acceptance","owner","hash",false,true,"version","version",[new("arrived","physical","accepted-model",2,0,"material"),new("later","now-digital","other-model",1,0,"old")]);
        var selected=SourcingReceiptCatalogRules.ForReceipt(plan,["arrived","arrived"]);Assert.Single(selected.Lines);Assert.True(selected.RequiresNewOffer);
        SourcingReceiptCatalogRules.AssertPlan(selected,new Dictionary<string,SourcingReceiptSkuIdentity>{{"physical",new("physical","accepted-model",false)}});
        Assert.Equal("receiving_line_conflict",Assert.Throws<BusinessException>(()=>SourcingReceiptCatalogRules.ForReceipt(plan,["foreign"])).Code);
    }
}
