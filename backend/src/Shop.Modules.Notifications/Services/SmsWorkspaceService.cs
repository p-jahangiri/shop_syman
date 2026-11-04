using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

public sealed class SmsWorkspaceService(NotificationsDbContext db, ISmsWorkspaceProtection protection,
    ISmsOtpChallengeInvalidator challenges, TimeProvider clock, bool development = false) : ISmsWorkspace
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true, RespectNullableAnnotations = true, MaxDepth = 12
    };
    public static Task LockAsync(NotificationsDbContext db, CancellationToken ct) => db.Database.ExecuteSqlRawAsync("""
        DECLARE @result int;
        EXEC @result=sys.sp_getapplock @Resource=N'Sayman.CustomerOtp.v1',
          @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=5000;
        IF @result<0 THROW 51001,'SMS configuration is busy.',1;
        """, ct);

    public async Task<SmsWorkspaceInfo> ReadAsync(CancellationToken ct)
    {
        var state = await db.SmsWorkspace.AsNoTracking().SingleOrDefaultAsync(ct);
        if (state is null) return new(1, null, new(), [], [],
            SmsWorkspaceRules.Events.Select(e => new SmsRouteInfo(e, false, null, null)).ToArray());
        var connections = await db.SmsConnections.AsNoTracking().ToArrayAsync(ct);
        var templates = await db.SmsTemplates.AsNoTracking().Include(t => t.Parameters).ToArrayAsync(ct);
        var routes = await db.SmsEventRoutes.AsNoTracking().ToArrayAsync(ct);
        return Info(state, connections, templates, routes);
    }

    public async Task<SmsWorkspaceInfo> SaveAsync(string actorId, SmsWorkspaceInput supplied, string traceId, CancellationToken ct)
    {
        var input = SmsWorkspaceRules.Validate(supplied, development);
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable)
            throw new InvalidOperationException("SMS configuration requires the shared audited Serializable transaction.");
        await LockAsync(db, ct);
        var binding = Binding(actorId, input.RequestId);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { Contract = "Sayman.SmsWorkspace.v1", Input = input }, Json);
        string fingerprint;
        try { fingerprint = Convert.ToHexStringLower(SHA256.HashData(bytes)); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
        var previous = await db.SmsWorkspaceCommands.AsNoTracking()
            .SingleOrDefaultAsync(c => c.ActorId == actorId && c.RequestId == input.RequestId, ct);
        if (previous is not null) {
            var expected = protection.Unprotect("fingerprint", binding, previous.ProtectedFingerprint);
            if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(fingerprint)))
                throw SmsWorkspaceRules.Conflict();
            return JsonSerializer.Deserialize<SmsWorkspaceInfo>(protection.Unprotect("receipt", binding, previous.ProtectedReceipt), Json)
                ?? throw new BusinessException("sms_workspace_unavailable", "The settings receipt could not be verified.");
        }
        var state = await db.SmsWorkspace.SingleOrDefaultAsync(ct);
        if (input.Version != (state is null ? null : Convert.ToBase64String(state.Version))) throw SmsWorkspaceRules.Conflict();
        var connections = (await db.SmsConnections.ToArrayAsync(ct)).ToDictionary(c => c.Id, StringComparer.Ordinal);
        var templates = (await db.SmsTemplates.Include(t => t.Parameters).ToArrayAsync(ct)).ToDictionary(t => t.Id, StringComparer.Ordinal);
        var routes = (await db.SmsEventRoutes.ToArrayAsync(ct)).ToDictionary(r => r.Event, StringComparer.Ordinal);
        var beforeOtp = state is null ? "uninitialized" : OtpSeal(state, connections, templates, routes);
        if (state is null) { state = new(); db.SmsWorkspace.Add(state); }
        SmsWorkspaceRules.Apply(state, input.Otp);
        state.ChangedAt = clock.GetUtcNow();

        foreach (var value in input.Connections) {
            if (!connections.TryGetValue(value.Id, out var row)) {
                row = new() { Id = value.Id }; connections.Add(row.Id, row); db.SmsConnections.Add(row);
            } else if ((row.Provider != value.Provider || row.Mode != value.Mode)
                && row.ProtectedApiKey is not null && value.KeyAction == "keep") throw SmsWorkspaceRules.Invalid();
            row.Name = value.Name; row.Provider = value.Provider; row.Mode = value.Mode; row.Enabled = value.Enabled;
            if (value.KeyAction != "keep") {
                row.KeyRevision = Guid.NewGuid().ToString("N"); row.LegacyKeyProtection = false;
                row.ProtectedApiKey = value.KeyAction == "clear" ? null : protection.Protect("key", row.KeyRevision, value.ApiKey!);
            }
        }
        foreach (var value in input.Templates) {
            if (!templates.TryGetValue(value.Id, out var row)) {
                row = new() { Id = value.Id }; templates.Add(row.Id, row); db.SmsTemplates.Add(row);
            }
            row.Name = value.Name; row.Kind = value.Kind; row.ConnectionId = value.ConnectionId;
            row.ProviderTemplate = value.ProviderTemplate; row.Approved = value.Approved; row.PreviewText = value.PreviewText;
            foreach (var old in row.Parameters.Where(p => !value.Parameters.Any(v => v.Name == p.Name)).ToArray()) {
                row.Parameters.Remove(old); db.SmsTemplateParameters.Remove(old);
            }
            foreach (var parameter in value.Parameters) {
                var target = row.Parameters.SingleOrDefault(p => p.Name == parameter.Name);
                if (target is null) { target = new() { TemplateId = row.Id, Name = parameter.Name }; row.Parameters.Add(target); }
                target.Source = parameter.Source; target.Constant = parameter.Constant;
            }
        }
        foreach (var value in input.Routes) {
            if (!routes.TryGetValue(value.Event, out var row)) {
                row = new() { Event = value.Event }; routes.Add(row.Event, row); db.SmsEventRoutes.Add(row);
            }
            if (value.Enabled && (!row.Enabled || row.TemplateId != value.TemplateId)) row.EnabledSince = clock.GetUtcNow();
            if (value.Enabled) {
                var template = templates[value.TemplateId!]; var connection = connections[template.ConnectionId];
                if (connection.ProtectedApiKey is not { Length: > 0 }) throw SmsWorkspaceRules.Invalid();
            }
            row.Enabled = value.Enabled; row.TemplateId = value.TemplateId;
        }
        foreach (var old in templates.Values.Where(t => !input.Templates.Any(v => v.Id == t.Id)).ToArray()) {
            templates.Remove(old.Id); db.SmsTemplates.Remove(old);
        }
        foreach (var old in connections.Values.Where(c => !input.Connections.Any(v => v.Id == c.Id)).ToArray()) {
            connections.Remove(old.Id); db.SmsConnections.Remove(old);
        }
        if (beforeOtp != OtpSeal(state, connections, templates, routes)) {
            state.OtpGeneration = Guid.NewGuid().ToString("N");
            await challenges.InvalidateAsync(ct);
        }
        // A new successful metadata command always obtains a fresh CAS version,
        // even when the clock and non-OTP settings happen to match exactly.
        db.Entry(state).Property(s => s.ChangedAt).IsModified = true;
        await db.SaveChangesAsync(ct);
        var info = Info(state, connections.Values, templates.Values, routes.Values);
        db.SmsWorkspaceCommands.Add(new() {
            ActorId = actorId, RequestId = input.RequestId, At = clock.GetUtcNow(),
            ProtectedFingerprint = protection.Protect("fingerprint", binding, fingerprint),
            ProtectedReceipt = protection.Protect("receipt", binding, JsonSerializer.Serialize(info, Json))
        });
        await db.SaveChangesAsync(ct);
        return info;
    }

    internal static string Binding(string actorId, string requestId) => Convert.ToHexStringLower(
        SHA256.HashData(Encoding.UTF8.GetBytes("Sayman.SmsWorkspace.v1:" + actorId + "\0" + requestId)));

    private static SmsWorkspaceInfo Info(SmsWorkspaceState state, IEnumerable<SmsConnection> connections,
        IEnumerable<SmsTemplate> templates, IEnumerable<SmsEventRoute> routes) => new(1,
        Convert.ToBase64String(state.Version), SmsWorkspaceRules.Policy(state),
        connections.OrderBy(c => c.Id, StringComparer.Ordinal).Select(c => new SmsConnectionInfo(c.Id, c.Name, c.Provider, c.Mode, c.Enabled, c.ProtectedApiKey is { Length: > 0 })).ToArray(),
        templates.OrderBy(t => t.Id, StringComparer.Ordinal).Select(t => new SmsTemplateInfo(t.Id, t.Name, t.Kind, t.ConnectionId,
            t.ProviderTemplate, t.Approved, t.PreviewText, t.Parameters.OrderBy(p => p.Name, StringComparer.Ordinal)
                .Select(p => new SmsParameterBinding(p.Name, p.Source, p.Constant)).ToArray())).ToArray(),
        routes.OrderBy(r => r.Event, StringComparer.Ordinal).Select(r => new SmsRouteInfo(r.Event, r.Enabled, r.TemplateId, r.EnabledSince)).ToArray());

    private static string OtpSeal(SmsWorkspaceState state, IReadOnlyDictionary<string, SmsConnection> connections,
        IReadOnlyDictionary<string, SmsTemplate> templates, IReadOnlyDictionary<string, SmsEventRoute> routes)
    {
        routes.TryGetValue("otp", out var route);
        var template = route?.TemplateId is { } id && templates.TryGetValue(id, out var t) ? t : null;
        var connection = template is not null && connections.TryGetValue(template.ConnectionId, out var c) ? c : null;
        var raw = JsonSerializer.SerializeToUtf8Bytes(new {
            state.LifetimeSeconds, state.ResendSeconds, state.MaxAttempts, state.PhoneHourlyLimit, state.PhoneDailyLimit,
            state.GlobalHourlyLimit, state.GlobalDailyLimit, state.GenericName,
            Enabled = route?.Enabled, TemplateId = route?.TemplateId, template?.ProviderTemplate, template?.Approved,
            Parameters = template?.Parameters.OrderBy(p => p.Name, StringComparer.Ordinal).Select(p => new { p.Name, p.Source, p.Constant }).ToArray(),
            connection?.Provider, connection?.Mode, ConnectionEnabled = connection?.Enabled, connection?.KeyRevision,
            HasKey = connection?.ProtectedApiKey is { Length: > 0 }
        }, Json);
        try { return Convert.ToHexStringLower(SHA256.HashData(raw)); }
        finally { CryptographicOperations.ZeroMemory(raw); }
    }
}
