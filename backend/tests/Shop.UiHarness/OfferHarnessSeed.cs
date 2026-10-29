using System.Data;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;

namespace Shop.UiHarness;

// Disposable QA preparation only. This creates actual synthetic Catalog SKUs,
// never Stock, an Offer, a request, consent or an Order. Browser actions own the
// complete sourcing/offer flow after the harness reports ready.
internal static class OfferHarnessSeed
{
    internal static async Task<object> RunAsync(IServiceProvider services,IWebHostEnvironment environment,string expectedDatabase,CancellationToken ct)
    {
        if(!environment.IsDevelopment()||Environment.GetEnvironmentVariable("SHOP_UI_OFFERS_QA")!="1"||Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA")!="1"||Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN") is not null||!Regex.IsMatch(expectedDatabase,"^SaymanTest_Ui_[a-f0-9]{32}$"))throw new InvalidOperationException("Offer UI samples require a fresh explicitly enabled Development GUID-only sourcing QA database.");
        var catalog=services.GetRequiredService<CatalogDbContext>();var market=services.GetRequiredService<MarketDbContext>();var inventory=services.GetRequiredService<InventoryDbContext>();var sales=services.GetRequiredService<SalesDbContext>();
        foreach(var context in new DbContext[]{catalog,market,inventory,sales})if(context.Database.GetDbConnection().Database!=expectedDatabase||context.Database.GetDbConnection().DataSource!="127.0.0.1,11433")throw new InvalidOperationException("Offer UI samples cannot cross the isolated QA database boundary.");
        var sourceItems=new[]{"phone-a","phone-b","phone-c"};var listings=await market.Listings.AsNoTracking().Where(l=>l.SourceKey=="development-sample").ToArrayAsync(ct);
        if(listings.Length!=3||listings.Any(l=>!l.IsDemo||l.Status!="Published"||!sourceItems.Contains(l.SourceItemKey))||listings.Select(l=>l.SourceItemKey).Distinct(StringComparer.Ordinal).Count()!=3||listings.Select(l=>l.ModelId).Distinct(StringComparer.Ordinal).Count()!=3||await market.SourcingRequests.AnyAsync(ct)||await market.SourcingOffers.AnyAsync(ct)||await sales.Orders.AnyAsync(ct))throw new InvalidOperationException("Offer UI samples require precisely the three original untouched Development market samples and no sourcing/order activity.");
        var methods=await services.GetRequiredService<IPurchaseConfiguration>().MethodsAsync("fa",ct);if(!methods.Any(m=>m.Id=="online"&&m.Enabled&&m.Kind=="online"))throw new InvalidOperationException("The explicit Development online method is missing; QA will not enable or replace financial configuration.");
        var beforeStock=await inventory.Stock.Select(s=>new{s.VariantId,s.OnHand,s.Reserved}).OrderBy(s=>s.VariantId).ToArrayAsync(ct);var modelIds=listings.Select(l=>l.ModelId).ToArray();
        var products=await catalog.Products.AsNoTracking().Where(p=>modelIds.Contains(p.Id)).Include(p=>p.Translations).Include(p=>p.Variants).Include(p=>p.Attributes).ThenInclude(a=>a.Selections).Include(p=>p.Media).AsSplitQuery().ToArrayAsync(ct);
        if(products.Length!=3||products.Any(p=>p.Status!="Draft"||p.IsDigital||p.Variants.Count!=0||!p.Slug.StartsWith("sample-market-phone-",StringComparison.Ordinal)||p.Translations.Count(t=>t.Locale is "fa" or "en")!=2||p.Media.Count==0||!listings.Any(l=>l.ModelId==p.Id&&p.Slug=="sample-market-"+l.SourceItemKey)))throw new InvalidOperationException("Only the fresh original physical sample models without SKUs may receive offer QA SKUs.");
        var service=services.GetRequiredService<ICatalogService>();var saved=new List<object>();await using var transaction=await catalog.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        foreach(var listing in listings.OrderBy(l=>l.SourceItemKey,StringComparer.Ordinal)){
            var product=products.Single(p=>p.Id==listing.ModelId);var label=listing.SourceItemKey[^1].ToString().ToUpperInvariant();var sku="QA-OFFER-"+Guid.NewGuid().ToString("N").ToUpperInvariant();var price=listing.SourceItemKey=="phone-a"?"9007199254740993":"420000000";
            var input=new ProductInput(product.CategoryId,product.BrandId,product.Slug,"Published",false,false,product.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description,t.Badge)).ToArray(),product.Attributes.Select(a=>new AttributeValueInput(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Count==0?null:a.Selections.Select(s=>s.OptionId).ToArray())).ToArray(),[new(null,sku,price,null,"#537662","سبز نمونه","Synthetic green","تنوع واقعیِ نمونهٔ QA "+label,"Actual synthetic QA SKU "+label,"شرایط گارانتی صرفاً مصنوعی برای آزمون SQL/UI؛ سیاست فروشگاه نیست.","Synthetic SQL/UI warranty terms only; this is not store policy.",true,[],[],null)],product.Media.OrderBy(m=>m.SortOrder).Select(m=>m.Url).ToArray(),["online"],[],Convert.ToBase64String(product.Version));
            await service.SaveProductAsync(product.Id,input,"development-qa:offers",ct);saved.Add(new{ListingId=listing.Id,ModelId=product.Id,Sku=sku,IsDemo=true,PublicPriceRial=price});
        }
        await transaction.CommitAsync(ct);
        var afterStock=await inventory.Stock.Select(s=>new{s.VariantId,s.OnHand,s.Reserved}).OrderBy(s=>s.VariantId).ToArrayAsync(ct);if(!beforeStock.SequenceEqual(afterStock)||await market.SourcingRequests.AnyAsync(ct)||await market.SourcingOffers.AnyAsync(ct)||await sales.Orders.AnyAsync(ct))throw new InvalidOperationException("Offer UI sample preparation must not change Inventory, requests, offers, consents or orders.");
        return new{Created=3,IsDemo=true,Database=expectedDatabase,Items=saved,Scope="Disposable GUID QA Catalog SKUs only; zero Stock/order/request/offer/consent effects"};
    }
}
