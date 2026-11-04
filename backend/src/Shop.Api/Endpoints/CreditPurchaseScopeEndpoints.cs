using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using IdentityContext = Shop.Modules.Identity.IdentityDbContext;
using static CreditApplicationEndpoints;

public sealed class CreditPurchaseScopeCoordinator(IdentityContext identity, CreditDbContext credit, FilesDbContext files, CreditPurchaseScopeService service)
{
    public async Task<CreditPurchaseScopeResult> RunAsync(string actor, string path, string trace, Func<CreditPurchaseScopeService, Task<CreditPurchaseScopeResult>> work, CancellationToken ct)
    {
        await using var tx = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        DbContext[] participants = [credit, files]; var enlisted = new List<DbContext>();
        try {
            var connection = identity.Database.GetDbConnection();
            foreach (var db in participants) {
                var original = db.Database.GetDbConnection();
                if (original.State != ConnectionState.Closed || original.Database != connection.Database || original.DataSource != connection.DataSource)
                    throw new InvalidOperationException("Credit purchase scopes require closed module connections to the same database.");
                db.Database.SetDbConnection(connection, false);
                await db.Database.UseTransactionAsync(tx.GetDbTransaction(), ct); enlisted.Add(db);
            }
            var result = await work(service);
            if (!result.Replayed) {
                identity.Audit.Add(new AuditEvent { ActorId = actor, Action = "CREDIT_PURCHASE_SCOPE", Resource = path, TraceId = trace });
                await identity.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct); return result;
        } finally { foreach (var db in enlisted) await db.Database.UseTransactionAsync(null, CancellationToken.None); }
    }
}
public static class CreditPurchaseScopeEndpoints
{
    public static void MapCreditPurchaseScopes(this WebApplication app, string[] origins, string[] adminOrigins)
    {
        var customer = app.MapGroup("/api/credit").RequireAuthorization("customer").RequireRateLimiting("credit_applications");
        Configure(customer, origins); Routes(customer, false);
        var staff = app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa", "credit.read").RequireRateLimiting("credit_applications");
        Configure(staff, adminOrigins); Routes(staff, true);
        staff.MapPost("/applications/{id}/purchase-scope/grant/{commandId}", async (string id, string commandId, GrantCreditPurchaseScopeInput input, HttpContext h, CreditPurchaseScopeCoordinator coordinator, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await coordinator.RunAsync(Actor(h), h.Request.Path, h.TraceIdentifier, s => s.GrantAsync(Actor(h), id, commandId, input, ct), ct)))
            .RequireAuthorization("credit.write");
    }
    private static void Routes(RouteGroupBuilder group, bool staff)
    {
        group.MapGet("/applications/{id}/purchase-scope", async (string id, HttpContext h, CreditPurchaseScopeService service, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await service.PageAsync(Actor(h), staff, !staff || h.User.HasClaim("permission", "credit.write"), id, ct)));
        var revoke = group.MapPost("/applications/{id}/purchase-scope/revoke/{commandId}", async (string id, string commandId, RevokeCreditPurchaseScopeInput input, HttpContext h, CreditPurchaseScopeCoordinator coordinator, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await coordinator.RunAsync(Actor(h), h.Request.Path, h.TraceIdentifier, s => s.RevokeAsync(Actor(h), staff, id, commandId, input, ct), ct)));
        var receipt = group.MapGet("/applications/{id}/purchase-scope/commands/{commandId}", async (string id, string commandId, HttpContext h, CreditPurchaseScopeService service, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await service.ReceiptAsync(Actor(h), staff, id, commandId, ct)));
        if (staff) { revoke.RequireAuthorization("credit.write"); receipt.RequireAuthorization("credit.write"); }
    }
}
