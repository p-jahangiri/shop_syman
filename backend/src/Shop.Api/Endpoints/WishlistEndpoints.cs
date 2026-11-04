using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
public sealed class WishlistCoordinator(IdentityDbContext identity,SalesDbContext sales,CatalogDbContext catalog,WishlistService service)
{
    public async Task<WishlistData> WriteAsync(string actor,WishlistInput input,string trace,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var enlisted=new List<DbContext>();
        try{
            foreach(var db in new DbContext[]{sales,catalog}){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Wishlist audit requires closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}
            var result=await service.ReplaceAsync(actor,input,ct);if(result.Changed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="WISHLIST_REPLACE",Resource="/api/wishlist",TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result.Wishlist;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class WishlistEndpoints
{
    public static void MapWishlist(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/wishlist").RequireAuthorization("customer").RequireRateLimiting("addresses");group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var origin=h.Request.Headers.Origin.ToString();if(h.Request.QueryString.HasValue)return Results.BadRequest(new{title="invalid_wishlist"});if((!HttpMethods.IsGet(h.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(c);});
        group.MapGet("",async(HttpContext h,WishlistService s,CancellationToken ct)=>Results.Ok(await s.ReadAsync(h.User.FindFirstValue("sub")!,ct)));
        group.MapPut("",async(WishlistInput input,HttpContext h,WishlistCoordinator c,CancellationToken ct)=>Results.Ok(await c.WriteAsync(h.User.FindFirstValue("sub")!,input,h.TraceIdentifier,ct)));
    }
}
