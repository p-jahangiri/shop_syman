using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Xunit;

namespace Shop.SqlTests;
public sealed class DevelopmentMarketSeedSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task ExplicitSamplesAreAtomicVersionedAndIdempotentWithoutAccountsOrSellableStock()
    {
        int variants,users,stock;long audits;
        await using(var before=fixture.Factory.Services.CreateAsyncScope()){
            variants=await before.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.CountAsync();users=await before.ServiceProvider.GetRequiredService<IdentityDbContext>().Users.CountAsync();stock=await before.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.CountAsync();audits=await before.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync();
        }
        async Task Seed(){await using var scope=fixture.Factory.Services.CreateAsyncScope();await DevelopmentMarketSeed.RunAsync(scope.ServiceProvider,scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>(),CancellationToken.None);}
        await Seed();Dictionary<string,string> versions;
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){
            var rows=await check.ServiceProvider.GetRequiredService<MarketDbContext>().Listings.AsNoTracking().ToArrayAsync();Assert.Equal(3,rows.Length);Assert.All(rows,l=>Assert.True(l.IsDemo));Assert.All(rows,l=>Assert.Equal("Published",l.Status));versions=rows.ToDictionary(l=>l.Id,l=>Convert.ToBase64String(l.Version));
            var catalogue=check.ServiceProvider.GetRequiredService<CatalogDbContext>();var ids=rows.Select(l=>l.ModelId).ToArray();Assert.Equal(3,await catalogue.Products.CountAsync(p=>ids.Contains(p.Id)&&p.Status=="Draft"));Assert.False(await catalogue.Variants.AnyAsync(v=>ids.Contains(v.ProductId)));Assert.Equal(variants,await catalogue.Variants.CountAsync());Assert.Equal(users,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Users.CountAsync());Assert.Equal(stock,await check.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.CountAsync());Assert.Equal(audits+3,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());
        }
        await Seed();
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){
            var rows=await check.ServiceProvider.GetRequiredService<MarketDbContext>().Listings.AsNoTracking().ToArrayAsync();Assert.Equal(3,rows.Length);Assert.All(rows,l=>Assert.Equal(versions[l.Id],Convert.ToBase64String(l.Version)));Assert.Equal(audits+3,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());
            var reader=check.ServiceProvider.GetRequiredService<MarketService>();var page=await reader.PageAsync("en",new(),CancellationToken.None);Assert.Equal(3,page.Total);Assert.Equal(new[]{"available","stale","unknown"},page.Items.Select(i=>i.Availability).Order().ToArray());Assert.All(page.Items,i=>Assert.True(i.IsDemo));
        }
    }
}
