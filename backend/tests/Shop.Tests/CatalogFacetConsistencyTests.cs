using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Transactions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CatalogFacetConsistencyTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    private static void Closed(CatalogDbContext db)=>Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);
    [Fact] public async Task InvalidFacetInputsFailBeforeReadingCategoriesOrOpeningSql()
    {
        using var scope=factory.Services.CreateScope();var service=scope.ServiceProvider.GetRequiredService<ICatalogService>();
        foreach(var input in new[]{new FacetValuesInput("","key"),new("category",""),new("category","key",PageSize:61)})Assert.Equal("invalid_facet_query",(await Assert.ThrowsAsync<BusinessException>(()=>service.FacetValuesAsync("fa",input,CancellationToken.None))).Code);
        Closed(scope.ServiceProvider.GetRequiredService<CatalogDbContext>());
    }
    [Theory][InlineData(true)][InlineData(false)]
    public async Task CanceledFacetReadsDoNotStartAnAttemptOrOpenSql(bool values)
    {
        using var scope=factory.Services.CreateScope();var service=scope.ServiceProvider.GetRequiredService<ICatalogService>();using var cancel=new CancellationTokenSource();cancel.Cancel();
        if(values)await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>service.FacetValuesAsync("en",new("category","key"),cancel.Token));else await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>service.FiltersAsync("en","category",cancel.Token));
        Closed(scope.ServiceProvider.GetRequiredService<CatalogDbContext>());
    }
    [Fact] public async Task MaintenanceRejectsPendingWritesWithoutClearingOrSavingThem()
    {
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var brand=new Brand{Name="Pending brand",Slug="pending"};db.Brands.Add(brand);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>scope.ServiceProvider.GetRequiredService<ICatalogService>().RepairSearchFieldsAsync(CancellationToken.None));Assert.Equal(EntityState.Added,db.Entry(brand).State);Assert.Equal("",brand.SearchName);Assert.Single(db.ChangeTracker.Entries());Closed(db);
    }
    [Fact] public async Task CanceledMaintenancePreservesAnOtherwiseCleanTracker()
    {
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var brand=new Brand{Name="Tracked brand",SearchName="tracked brand",Slug="tracked",Version=new byte[8]};db.Attach(brand);using var cancel=new CancellationTokenSource();cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>scope.ServiceProvider.GetRequiredService<ICatalogService>().RepairSearchFieldsAsync(cancel.Token));Assert.Same(brand,Assert.Single(db.ChangeTracker.Entries()).Entity);Assert.Equal(EntityState.Unchanged,db.Entry(brand).State);Closed(db);
    }
    [Fact] public async Task MaintenanceRejectsAmbientTransactionsBeforeClearingOrOpeningSql()
    {
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var brand=new Brand{Name="Tracked brand",SearchName="tracked brand",Slug="tracked",Version=new byte[8]};db.Attach(brand);using var transaction=new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);
        var failure=await Assert.ThrowsAsync<InvalidOperationException>(()=>scope.ServiceProvider.GetRequiredService<ICatalogService>().RepairSearchFieldsAsync(CancellationToken.None));Assert.Contains("own transactions",failure.Message);Assert.Same(brand,Assert.Single(db.ChangeTracker.Entries()).Entity);Closed(db);
    }
    [Theory][InlineData(false)][InlineData(true)]
    public async Task UnstableFacetEndpointsReturnNative503AndNoSuccessfulEmptyResult(bool values)
    {
        var stub=DispatchProxy.Create<ICatalogService,UnavailableFacet>();using var host=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.AddSingleton(stub)));using var client=host.CreateClient();using var response=values?await client.PostAsJsonAsync("/api/catalog/en/facet-values",new FacetValuesInput("category","key")):await client.GetAsync("/api/catalog/en/filters?categoryId=category");Assert.Equal(HttpStatusCode.ServiceUnavailable,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var body=await response.Content.ReadAsStringAsync();Assert.Contains("catalog_unavailable",body);Assert.DoesNotContain("selectedValues",body);Assert.DoesNotContain("attributes",body);
    }
    public class UnavailableFacet:DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method,object?[]? args)=>throw new BusinessException("catalog_unavailable","Controlled test-only facet failure.");
    }
}
