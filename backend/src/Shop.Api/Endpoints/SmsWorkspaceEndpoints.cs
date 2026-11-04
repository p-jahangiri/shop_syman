using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.SharedKernel;

public sealed class SmsWorkspaceCoordinator(IdentityDbContext identity, NotificationsDbContext notifications,
    ISmsAdministratorAuthorization authorization, ISmsWorkspace workspace, ICustomerOtpPolicy policy,
    ICustomerLoginContinuity continuity, SmsMessageService messages)
{
    public async Task<SmsWorkspaceInfo> ReadAsync(string actor, string stamp, CancellationToken ct)
        => await ReadAuthorizedAsync(actor, stamp, () => workspace.ReadAsync(ct), ct);
    public Task<SmsMessagesPage> MessagesAsync(string actor, string stamp, string? state, string? kind, string? cursor, CancellationToken ct)
        => ReadAuthorizedAsync(actor, stamp, () => messages.PageAsync(state, kind, cursor, ct), ct);
    private async Task<T> ReadAuthorizedAsync<T>(string actor, string stamp, Func<Task<T>> read, CancellationToken ct)
    {
        await using var transaction = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var connection = identity.Database.GetDbConnection(); var old = notifications.Database.GetDbConnection();
        if (old.State != ConnectionState.Closed || old.Database != connection.Database || old.DataSource != connection.DataSource)
            throw new InvalidOperationException("SMS administration requires the canonical module transaction.");
        notifications.Database.SetDbConnection(connection, contextOwnsConnection: false);
        await notifications.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct);
        try {
            await SmsWorkspaceService.LockAsync(notifications, ct);
            await authorization.RequireAsync(actor, stamp, ct);
            var value = await read();
            await transaction.CommitAsync(ct); return value;
        } finally { await notifications.Database.UseTransactionAsync(null, CancellationToken.None); }
    }
    public async Task<SmsWorkspaceInfo> SaveAsync(string actor, string stamp, SmsWorkspaceInput input, string trace, CancellationToken ct)
    {
        if (identity.Database.CurrentTransaction is null || notifications.Database.CurrentTransaction is null)
            throw new InvalidOperationException("The audited SMS command transaction is required.");
        await SmsWorkspaceService.LockAsync(notifications, ct);
        await authorization.RequireAsync(actor, stamp, ct);
        var result = await workspace.SaveAsync(actor, input, trace, ct);
        var login = await policy.ReadAsync(ct);
        await continuity.RequireAsync(login.EmailPasswordEnabled, login.UsernamePasswordEnabled, login.MobileOtpEnabled, ct);
        return result;
    }
    public async Task<SmsMessageInfo> TestAsync(string actor, string stamp, SmsTestInput input, CancellationToken ct)
    {
        if (identity.Database.CurrentTransaction is null || notifications.Database.CurrentTransaction is null)
            throw new InvalidOperationException("The audited SMS test transaction is required.");
        await SmsWorkspaceService.LockAsync(notifications, ct);
        await authorization.RequireAsync(actor, stamp, ct);
        return await messages.TestAsync(actor, input, ct);
    }
}

public static class SmsWorkspaceEndpoints
{
    public static void MapSmsWorkspace(this RouteGroupBuilder admin, string[] origins)
    {
        var group = admin.MapGroup("/sms/workspace").RequireAuthorization("staff_mfa", "staff.write").RequireRateLimiting("orders");
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext; var origin = http.Request.Headers.Origin.ToString();
            if (http.Request.Headers["X-Sayman-Client"] != "admin"
                || (!HttpMethods.IsGet(http.Request.Method) || origin.Length > 0) && !origins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return await next(context);
        });
        group.MapGet("", async (HttpContext http, SmsWorkspaceCoordinator service, CancellationToken ct) =>
            Results.Ok(await service.ReadAsync(Actor(http), Stamp(http), ct)));
        group.MapPut("", async (SmsWorkspaceInput input, HttpContext http, SmsWorkspaceCoordinator service, CancellationToken ct) =>
            Results.Ok(await service.SaveAsync(Actor(http), Stamp(http), input, http.TraceIdentifier, ct)));
        var log = admin.MapGroup("/sms/messages").RequireAuthorization("staff_mfa", "staff.write").RequireRateLimiting("orders");
        log.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext; var origin = http.Request.Headers.Origin.ToString();
            if (http.Request.Headers["X-Sayman-Client"] != "admin"
                || (!HttpMethods.IsGet(http.Request.Method) || origin.Length > 0) && !origins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        log.MapGet("", async (string? state, string? kind, string? cursor, HttpContext http, SmsWorkspaceCoordinator service, CancellationToken ct) => {
            if (http.Request.Query.Any(p => p.Key is not ("state" or "kind" or "cursor") || p.Value.Count != 1)) return Results.BadRequest();
            return Results.Ok(await service.MessagesAsync(Actor(http), Stamp(http), state, kind, cursor, ct));
        });
        log.MapPost("/test", async (SmsTestInput input, HttpContext http, SmsWorkspaceCoordinator service, CancellationToken ct) => {
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return Results.Ok(await service.TestAsync(Actor(http), Stamp(http), input, ct));
        });
    }
    private static string Actor(HttpContext http) => http.User.FindFirstValue("sub") ?? throw SmsWorkspaceRules.Invalid();
    private static string Stamp(HttpContext http) => http.User.FindFirstValue("sst") ?? "";
}
