using System.Data;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Sales;
namespace Shop.UiHarness;
// D21 values are solely prerequisites in a newly generated disposable QA database.
// Real order creation, scope approval and all receipt recovery remain browser actions.
internal static class CreditOrderHarnessSeed
{
    internal static async Task RunAsync(IServiceProvider services,string database,string directory)
    {
        var db=services.GetRequiredService<SalesDbContext>();
        if(!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_ORDER_QA")!="1"||Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_QUOTE_QA")!="1"||Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN")is not null||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database||db.Database.GetDbConnection().Database!=database||!File.Exists(Path.Combine(directory,"credit-quote.json"))||!File.Exists(Path.Combine(directory,"orders.json"))||await db.Orders.AnyAsync()||await db.OrderSettings.AnyAsync()||await db.CreditOrderLinks.AnyAsync())throw new InvalidOperationException("Only fresh explicit synthetic cheque order QA prerequisites are permitted.");
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await services.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(false,60,2,null,true),default);await tx.CommitAsync();
        await UiHarnessProgram.WritePrivate(Path.Combine(directory,"credit-order.json"),new{syntheticQaOnly=true,d21Only=true,database,cashOrdersEnabled=false,chequeOrdersEnabled=true,reservationMinutes=60,maxOpenOrdersPerCustomer=2,orders=0,reservations=0,creditUses=0});
    }
}
