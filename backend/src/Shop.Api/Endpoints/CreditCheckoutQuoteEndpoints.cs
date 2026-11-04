using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

public sealed class CreditCheckoutQuoteCoordinator(IServiceProvider services,CreditCheckoutQuoteService service)
{
    public async Task<CreditCheckoutQuoteResult> RunAsync(string owner,string path,string trace,string locale,string commandId,CreditCheckoutQuoteInput input,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();
            foreach(var type in new[]{typeof(SalesDbContext),typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(PaymentsDbContext),typeof(CreditDbContext)}){
                var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Cheque quotes require closed module connections to the same database.");
                db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);
            }
            var result=await service.CreateAsync(owner,locale,commandId,input,ct);
            if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=owner,Action="SALES_CREDIT_QUOTE",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}
            await tx.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditCheckoutQuoteEndpoints
{
    public static bool IsScope(string path)=>path.StartsWith("/api/cart/",StringComparison.OrdinalIgnoreCase)&&System.Text.RegularExpressions.Regex.IsMatch(path,@"^/api/cart/[^/]+/v2/credit-quotes?(?:/|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase|System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    public static void MapCreditCheckoutQuotes(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/cart/{locale}/v2").RequireAuthorization("customer").RequireRateLimiting("cart");CreditApplicationEndpoints.Configure(group,origins);
        group.MapPost("/credit-quote/commands/{commandId}",async(string locale,string commandId,CreditCheckoutQuoteInput input,HttpContext h,CreditCheckoutQuoteCoordinator coordinator,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await coordinator.RunAsync(CreditApplicationEndpoints.Actor(h),h.Request.Path,h.TraceIdentifier,locale,commandId,input,ct)));
        group.MapGet("/credit-quote/commands/{commandId}",async(string locale,string commandId,HttpContext h,CreditCheckoutQuoteService service,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(CreditApplicationEndpoints.Actor(h),locale,commandId,ct)));
        group.MapGet("/credit-quotes/{id}",async(string locale,string id,HttpContext h,CreditCheckoutQuoteService service,CancellationToken ct)=>{
            if(locale is not("fa"or"en"))throw CreditCheckoutQuoteRules.Invalid();return !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.DetailAsync(CreditApplicationEndpoints.Actor(h),id,ct));
        });
    }
}
