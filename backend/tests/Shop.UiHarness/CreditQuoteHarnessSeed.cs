using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Hosting;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
namespace Shop.UiHarness;
internal static class CreditQuoteHarnessSeed
{
    public static async Task RunAsync(IServiceProvider services,string database,string directory)
    {
        if(OperatingSystem.IsWindows())throw new PlatformNotSupportedException("Private QA metadata requires Unix file permissions.");
        var sales=services.GetRequiredService<SalesDbContext>();var file=Path.Combine(directory,"credit-quote.json");
        if(!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_QUOTE_QA")!="1"||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database||File.Exists(file)||sales.Database.GetDbConnection().Database!=database||Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN")is not null)throw new InvalidOperationException("Fresh explicitly owned Development cheque quote QA required.");
        if(await sales.Orders.AnyAsync()||await sales.ChargePolicies.AnyAsync()||await sales.OrderSettings.AnyAsync()||await services.GetRequiredService<InventoryDbContext>().Reservations.AnyAsync())throw new InvalidOperationException("Cheque quote QA starts without orders, reservations or commercial policies.");
        var method=await services.GetRequiredService<PaymentsDbContext>().Methods.AsNoTracking().Where(m=>m.Enabled&&m.Kind=="cheque").OrderBy(m=>m.Id).FirstAsync();
        var plans=await services.GetRequiredService<CreditDbContext>().Plans.AsNoTracking().Include(p=>p.Categories).Where(p=>p.Enabled).OrderBy(p=>p.Months).ThenBy(p=>p.Id).ToArrayAsync();
        var products=await services.GetRequiredService<CatalogDbContext>().Products.AsNoTracking().Include(p=>p.Translations).Include(p=>p.CreditPlans).Include(p=>p.Variants).Where(p=>p.Status=="Published"&&!p.IsDigital&&p.PurchaseMethods.Any(m=>m.MethodId==method.Id)).OrderBy(p=>p.Slug).ToArrayAsync();
        var stock=await services.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().ToDictionaryAsync(s=>s.VariantId);
        var chosen=(from p in products from v in p.Variants.Where(v=>v.IsActive&&v.UsedInspectionId==null&&v.PriceRial>0) from plan in plans where (p.CreditPlans.Count==0||p.CreditPlans.Any(x=>x.PlanId==plan.Id))&&(plan.Categories.Count==0||plan.Categories.Any(x=>x.CategoryId==p.CategoryId))&&stock.TryGetValue(v.Id,out var count)&&count.OnHand-count.Reserved-count.SourcingReserved>0 select new{Product=p,Variant=v,Plan=plan}).First();
        await using(var tx=await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable)){await services.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat","ارسال ساختگی QA","Synthetic QA delivery","فقط دیتابیس موقت D21","D21 temporary database only","12345",null,"exempt",null,"goods","half_up",null),default);await tx.CommitAsync();}
        var payload=JsonSerializer.Serialize(new{syntheticQaOnly=true,seedOnly=true,d21Only=true,database,productId=chosen.Product.Id,productSlug=chosen.Product.Slug,productNameFa=chosen.Product.Translations.Single(x=>x.Locale=="fa").Name,variantId=chosen.Variant.Id,sku=chosen.Variant.Sku,priceRial=chosen.Variant.PriceRial.ToString(System.Globalization.CultureInfo.InvariantCulture),methodId=method.Id,planId=chosen.Plan.Id,planMonths=chosen.Plan.Months,shippingFeeRial="12345",taxMode="exempt",orders=0,reservations=0,orderSettingsConfigured=false});
        await using var output=new FileStream(file,new FileStreamOptions{Mode=FileMode.CreateNew,Access=FileAccess.Write,Share=FileShare.None,UnixCreateMode=UnixFileMode.UserRead|UnixFileMode.UserWrite});await output.WriteAsync(System.Text.Encoding.UTF8.GetBytes(payload));
    }
}
