using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.Modules.Market;
using Shop.Modules.Reviews;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

// Composition-root coordination: modules retain ownership of their own contexts.
// Only the command's scoped contexts share Identity's connection/transaction.
// Normal reads and migration connection factories remain independent.
public sealed class AdminAuditFilter:IEndpointFilter
{
    private static readonly Type[] Participants=[typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(PaymentsDbContext),typeof(CreditDbContext),typeof(CmsDbContext),typeof(SalesDbContext),typeof(MarketDbContext),typeof(ReviewsDbContext),typeof(Shop.Modules.Support.SupportDbContext),typeof(Shop.Modules.Notifications.NotificationsDbContext),typeof(Shop.Modules.Files.FilesDbContext)];
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context,EndpointFilterDelegate next)
    {
        var http=context.HttpContext;
        if(HttpMethods.IsGet(http.Request.Method)||HttpMethods.IsHead(http.Request.Method)||HttpMethods.IsOptions(http.Request.Method)||http.GetEndpoint()?.Metadata.GetMetadata<ReadOnlyAdministrativeRequest>() is not null)return await next(context);
        var actor=http.User.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","User identity is missing.");
        var services=http.RequestServices;var identity=services.GetRequiredService<IdentityContext>();
        await using var transaction=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,http.RequestAborted);
        var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();
            foreach(var type in Participants){
                var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||!string.Equals(original.Database,connection.Database,StringComparison.OrdinalIgnoreCase)||!string.Equals(original.DataSource,connection.DataSource,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Atomic administrative commands require closed module connections to the same database.");
                // The owning Identity context disposes this scoped connection.
                db.Database.SetDbConnection(connection,contextOwnsConnection:false);
                await db.Database.UseTransactionAsync(transaction.GetDbTransaction(),http.RequestAborted);enlisted.Add(db);
            }
            // Auth publication and SMS reconfiguration take the same Identity
            // lock before reading CMS, so neither can strand OTP-only users or
            // invert the settings/policy lock order under concurrent changes.
            if(http.Request.Path.StartsWithSegments("/api/admin/content/auth"))
                await CustomerSmsRules.LockAsync(identity,http.RequestAborted);
            var result=await next(context);
            // A returned validation/problem result must not create a success audit.
            // Disposal rolls the transaction back when no commit was attempted.
            if(http.Response.StatusCode>=400||result is IStatusCodeHttpResult{StatusCode:>=400})return result;
            identity.Audit.Add(new AuditEvent{ActorId=actor,Action=http.Request.Method,Resource=http.Request.Path,TraceId=http.TraceIdentifier});
            await identity.SaveChangesAsync(http.RequestAborted);
            await transaction.CommitAsync(http.RequestAborted);
            return result;
        }finally{
            foreach(var db in enlisted){
                try{await db.Database.UseTransactionAsync(null,CancellationToken.None);}
                catch(Exception e)when(e is not OutOfMemoryException){services.GetRequiredService<ILogger<AdminAuditFilter>>().LogWarning("Could not detach {Module} transaction after {ExceptionType}",db.GetType().Name,e.GetType().Name);}
            }
        }
    }
}
