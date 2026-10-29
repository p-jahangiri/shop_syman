using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CatalogReadVersionTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    private static CatalogReadVersion V(string id,byte last=1)=>new(id,[0,0,0,0,0,0,0,last]);
    [Fact] public void ServiceCompositionAndPolymorphicConcurrencyMetadataResolveWithoutDatabaseIo()
    {
        using var scope=factory.Services.CreateScope();Assert.IsType<CatalogService>(scope.ServiceProvider.GetRequiredService<ICatalogService>());var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        CatalogEntity[] rows=[new Brand{Id="brand"},new Category{Id="category"},new AttributeDefinition{Id="definition"},new Product{Id="product",CategoryId="category",BrandId="brand"},new ProductVariant{Id="variant",ProductId="product"}];db.AttachRange(rows);
        foreach(var row in rows){var entry=db.Entry(row);Assert.Equal(row.GetType(),entry.Metadata.ClrType);Assert.True(entry.Property(x=>x.Version).Metadata.IsConcurrencyToken);Assert.Equal(EntityState.Unchanged,entry.State);}
        Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void ReadValidationAcceptsAnyOrderButNotAMixedOrDeletedGraph(){var before=new[]{V("one"),V("two",2)};CatalogReadVersions.EnsureUnchanged(before,[V("two",2),V("one")]);CatalogReadVersions.EnsureUnchanged([],[]);Assert.Equal("version_conflict",Assert.Throws<BusinessException>(()=>CatalogReadVersions.EnsureUnchanged(before,[V("one"),V("two",3)])).Code);Assert.Throws<BusinessException>(()=>CatalogReadVersions.EnsureUnchanged(before,[V("one")]));Assert.Throws<BusinessException>(()=>CatalogReadVersions.EnsureUnchanged(before,[V("one"),V("other",2)]));}
    [Theory][InlineData("before-duplicate")][InlineData("after-duplicate")][InlineData("missing-version")][InlineData("invalid-version")][InlineData("empty-id")]
    public void InvalidVersionSnapshotsFailClosed(string kind){var before=new[]{V("one"),V("two")};var after=new[]{V("one"),V("two")};if(kind=="before-duplicate")before=[V("one"),V("one")];if(kind=="after-duplicate")after=[V("one"),V("one")];if(kind=="missing-version")after=[V("one"),new("two",[])];if(kind=="invalid-version")before=[new("one",[1]),V("two")];if(kind=="empty-id")after=[V("one"),V("")];Assert.Throws<BusinessException>(()=>CatalogReadVersions.EnsureUnchanged(before,after));}
    [Fact] public void CapturedVersionsAreIndependentOfMutableEfEntityBuffers(){var product=new Product{Id="one",Version=[0,0,0,0,0,0,0,1]};var snapshot=CatalogReadVersions.Capture([product]);product.Version[^1]=2;Assert.Equal((byte)1,snapshot[0].Version[^1]);Assert.Throws<BusinessException>(()=>CatalogReadVersions.EnsureUnchanged(snapshot,CatalogReadVersions.Capture([product])));}
    [Fact] public async Task DuplicateIdsAcrossBatchBoundariesAreRejectedBeforeAnyDatabaseRead(){await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var rows=Enumerable.Range(0,501).Select(i=>new Product{Id="p"+i,Version=[0,0,0,0,0,0,0,1]}).ToList();rows.Add(new(){Id="p0",Version=[0,0,0,0,0,0,0,1]});await Assert.ThrowsAsync<BusinessException>(()=>CatalogReadVersions.EnsureAsync(db,rows,CancellationToken.None));Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);}
    [Fact] public async Task EmptyGraphsDoNotQuerySqlAndBoundedVersionQueriesNeverLoadEditableOrFinancialData(){await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));await CatalogReadVersions.EnsureProductsAsync(db,[],CancellationToken.None);Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);foreach(var sql in new[]{CatalogReadVersions.Query<Product>(db,["one"]).ToQueryString(),CatalogReadVersions.Query<ProductVariant>(db,["one"]).ToQueryString(),CatalogReadVersions.Query<Category>(db,["one"]).ToQueryString(),CatalogReadVersions.Query<AttributeDefinition>(db,["one"]).ToQueryString()}){Assert.Contains("Version",sql);Assert.DoesNotContain("PriceRial",sql);Assert.DoesNotContain("UpdatedAt",sql);Assert.DoesNotContain("Translations",sql);Assert.DoesNotContain("PurchaseMethods",sql);}Assert.Throws<BusinessException>(()=>CatalogReadVersions.Query<Product>(db,Enumerable.Range(0,501).Select(i=>"p"+i).ToArray()));Assert.Throws<BusinessException>(()=>CatalogReadVersions.Query<Product>(db,["one","one"]));}
}
