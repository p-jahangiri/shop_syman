using System.Globalization;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

internal sealed record SmsExecutionPlan(SmsConnection Connection, SmsTemplate Template, SmsOtpPolicy Policy)
{
    public override string ToString() => "SMS execution plan [redacted]";
}

public sealed class SmsDeliveryPlanner(NotificationsDbContext db, ISmsWorkspaceProtection protection,
    ICustomerOtpProtection legacyProtection, ITransactionalSmsGateway gateway, bool development = false) : ISmsOtpConfigurationSource
{
    public Task<bool> ExistsAsync(CancellationToken ct) => db.SmsWorkspace.AnyAsync(ct);

    public async Task<SmsOtpConfiguration?> ReadAsync(CancellationToken ct)
    {
        var state = await db.SmsWorkspace.AsNoTracking().SingleOrDefaultAsync(ct);
        if (state is null) return null;
        var policy = SmsWorkspaceRules.Policy(state);
        SmsWorkspaceRules.Policy(policy);
        var plan = await RouteAsync("otp", null, ct);
        return new(plan is not null, state.OtpGeneration, policy, (phone, code, token) => plan is null
            ? throw new BusinessException("otp_unavailable", "Mobile verification is unavailable.")
            : SendAsync(plan, phone, new Dictionary<string, string>(StringComparer.Ordinal) { ["code"] = code }, token));
    }

    internal async Task<SmsExecutionPlan?> RouteAsync(string kind, DateTimeOffset? eventAt, CancellationToken ct)
    {
        var route = await db.SmsEventRoutes.AsNoTracking().SingleOrDefaultAsync(r => r.Event == kind, ct);
        if (route is not { Enabled: true, TemplateId: not null, EnabledSince: not null }
            || eventAt is not null && eventAt < route.EnabledSince) return null;
        var plan = await TemplateAsync(route.TemplateId, false, ct);
        return plan is not null && plan.Template.Kind == kind ? plan : null;
    }

    internal async Task<SmsExecutionPlan?> TemplateAsync(string id, bool allowSandbox, CancellationToken ct)
    {
        var state = await db.SmsWorkspace.AsNoTracking().SingleOrDefaultAsync(ct);
        if (state is null) return null;
        var template = await db.SmsTemplates.AsNoTracking().Include(t => t.Parameters).SingleOrDefaultAsync(t => t.Id == id, ct);
        if (template is null) return null;
        var connection = await db.SmsConnections.AsNoTracking().SingleOrDefaultAsync(c => c.Id == template.ConnectionId, ct);
        if (connection is not { Enabled: true, ProtectedApiKey.Length: > 0 }
            || connection.Mode != "live" && !(allowSandbox && development && connection.Provider == "smsIr" && connection.Mode == "sandbox")
            || connection.Mode == "live" && !template.Approved) return null;
        return new(connection, template, SmsWorkspaceRules.Policy(state));
    }

    internal async Task<CustomerOtpSmsResult> SendAsync(SmsExecutionPlan plan, string phone,
        IReadOnlyDictionary<string, string> facts, CancellationToken ct)
    {
        try {
            var values = new Dictionary<string, string>(facts, StringComparer.Ordinal) {
                ["genericName"] = plan.Policy.GenericName,
                ["expiryMinutes"] = (plan.Policy.LifetimeSeconds / 60m).ToString("0.##", CultureInfo.InvariantCulture)
            };
            var parameters = plan.Template.Parameters.OrderBy(p => p.Name, StringComparer.Ordinal).Select(p =>
                new SmsValue(p.Name, p.Source == "constant" ? p.Constant!
                    : values.TryGetValue(p.Source, out var value) ? value : throw new ArgumentException("Missing SMS variable."))).ToArray();
            var connection = plan.Connection;
            var key = connection.LegacyKeyProtection
                ? legacyProtection.Unprotect("key", connection.KeyRevision, connection.ProtectedApiKey!)
                : protection.Unprotect("key", connection.KeyRevision, connection.ProtectedApiKey!);
            var envelope = new TransactionalSmsRequest(connection.Provider, key, phone, plan.Template.ProviderTemplate, parameters);
            return await gateway.SendAsync(envelope, ct);
        } catch (CryptographicException) {
            return new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.CredentialsRejected);
        } catch (ArgumentException) {
            return new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RequestRejected);
        }
    }
}
