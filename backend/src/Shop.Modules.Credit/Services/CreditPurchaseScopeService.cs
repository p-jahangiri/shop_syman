using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed partial class CreditPurchaseScopeService(
    CreditDbContext db, CreditRequirementsService requirements,
    CreditApplicationService applications, CreditSubmissionService submissions,
    IPrivateFileVault vault, ICreditApplicationProtection protection, TimeProvider clock)
    : ICreditPurchaseScopeReader, ICreditPurchaseScopeClaims
{
    private static readonly JsonSerializerOptions Json = CreditRequirementsRules.Json;

    public async Task<CreditPurchaseScopePage> PageAsync(string actor, bool staff, bool writer, string id, CancellationToken ct)
    {
        var app = await Visible(actor, staff, id, false, ct);
        var grant = new List<string>(); var quote = new List<string>();
        if (!staff || !writer) grant.Add("credit_scope_grant_write_required");
        if (app.State != "Approved") { grant.Add("credit_application_not_approved"); quote.Add("credit_application_not_approved"); }
        var planCurrent = await PlanCurrent(app, ct);
        if (!planCurrent) { grant.Add("credit_scope_plan_changed"); quote.Add("credit_scope_plan_changed"); }
        CreditPurchaseScopeData? scope = null;
        if (app.CurrentPurchaseScopeId is not null)
        {
            var row = await Current(app, ct); scope = await Data(row, ct);
            grant.Add("credit_scope_already_granted");
            if (scope.State != "Active") quote.Add(scope.State == "Revoked" ? "credit_scope_revoked" : scope.State == "Used" ? "credit_scope_used" : "credit_scope_expired");
        }
        else
        {
            quote.Add("credit_scope_required");
            if (app.State == "Approved")
            {
                var review = await Approval(app, ct);
                if (review.ExpiresAt <= clock.GetUtcNow()) grant.Add("credit_scope_expired");
                var snapshot = await submissions.DetailAsync(actor, staff, app.Id, review.SubmissionId, ct);
                if (snapshot.Documents.Length > 0 && !vault.Configured) grant.Add("private_file_unavailable");
            }
        }
        return new(1, CreditApplicationService.Summary(app), app.CurrentReviewId, scope, grant.Count == 0,
            (!staff || writer) && scope?.State == "Active", quote.Count == 0,
            grant.ToArray(), quote.ToArray());
    }

    public async Task<CreditPurchaseScopeResult> GrantAsync(string actor, string id, string commandId, GrantCreditPurchaseScopeInput input, CancellationToken ct)
    {
        actor = CreditApplicationRules.Actor(actor); CreditApplicationRules.Id(commandId);
        CreditApplicationRules.Id(id); input = CreditPurchaseScopeRules.Validate(input);
        var hash = Hash(id, "Grant", true, input); await Locks(ct);
        var app = await Visible(actor, true, id, true, ct);
        if (await Replay(actor, id, commandId, "Grant", hash, ct) is {} old) return old;
        if (app.State != "Approved" || app.CurrentReviewId != input.ReviewId || app.CurrentPurchaseScopeId is not null ||
            Convert.ToBase64String(app.Version) != input.ApplicationVersion || !await PlanCurrent(app, ct))
            throw CreditPurchaseScopeRules.Conflict();
        var review = await Approval(app, ct); var now = Now(app);
        if (review.ExpiresAt <= now || await db.PurchaseScopes.AnyAsync(x => x.ReviewId == review.Id, ct))
            throw CreditPurchaseScopeRules.Conflict();
        // Validate the protected plan snapshot before granting a purchase authority.
        await applications.DetailAsync(actor, true, id, ct);
        var snapshot = await submissions.DetailAsync(actor, true, id, review.SubmissionId, ct);
        if (snapshot.Documents.Length > 0 && !vault.Configured)
            throw new BusinessException("private_file_unavailable", "Secure document access must be configured before granting this purchase scope.");
        var row = new CreditPurchaseScope {
            ApplicationId = id, ReviewId = review.Id, SubmissionId = review.SubmissionId,
            ApplicationVersion = input.ApplicationVersion, LimitBasis = input.LimitBasis,
            LimitAmountRial = review.ApprovedAmountRial!.Value, ExpiresAt = review.ExpiresAt!.Value,
            PlanId = app.PlanId, PlanVersion = app.PlanVersion, PlanSnapshotHash = app.PlanHash,
            ActorId = actor, GrantedAt = now
        };
        db.PurchaseScopes.Add(row); app.CurrentPurchaseScopeId = row.Id;
        Event(app, actor, "ScopeGranted", now); await db.SaveChangesAsync(ct);
        return await SaveReceipt(actor, commandId, "Grant", hash, app, row, now, ct);
    }

    public async Task<CreditPurchaseScopeResult> RevokeAsync(string actor, bool staff, string id, string commandId, RevokeCreditPurchaseScopeInput input, CancellationToken ct)
    {
        actor = CreditApplicationRules.Actor(actor); CreditApplicationRules.Id(commandId);
        CreditApplicationRules.Id(id); input = CreditPurchaseScopeRules.Validate(input, staff);
        var hash = Hash(id, "Revoke", staff, input); await Locks(ct);
        var app = await Visible(actor, staff, id, true, ct);
        if (await Replay(actor, id, commandId, "Revoke", hash, ct) is {} old) return old;
        if (app.State != "Approved" || app.CurrentPurchaseScopeId is null || Convert.ToBase64String(app.Version) != input.ApplicationVersion)
            throw CreditPurchaseScopeRules.Conflict();
        var row = await Current(app, ct); var now = Now(app);
        if (Convert.ToBase64String(row.Version) != input.ScopeVersion || row.ExpiresAt <= now ||
            await db.ScopeRevocations.AnyAsync(x => x.ScopeId == row.Id, ct) ||
            await db.PurchaseScopeUses.AnyAsync(x => x.ScopeId == row.Id, ct)) throw CreditPurchaseScopeRules.Conflict();
        var raw = JsonSerializer.Serialize(input.Note, Json);
        db.ScopeRevocations.Add(new() {
            ScopeId = row.Id, ApplicationId = id, ActorId = actor, ActorKind = staff ? "Staff" : "Owner",
            Locale = input.Locale, NoteHash = CreditApplicationRules.Hash(raw),
            ProtectedNote = protection.Protect(id, "scope-note", row.Id, raw), At = now
        });
        Event(app, actor, "ScopeRevoked", now); await db.SaveChangesAsync(ct);
        return await SaveReceipt(actor, commandId, "Revoke", hash, app, row, now, ct);
    }

    public async Task<CreditPurchaseScopeResult> ReceiptAsync(string actor, bool staff, string id, string commandId, CancellationToken ct)
    {
        actor = CreditApplicationRules.Actor(actor); CreditApplicationRules.Id(commandId);
        await Visible(actor, staff, id, false, ct);
        var row = await db.ScopeCommands.AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.ApplicationId == id && x.CommandId == commandId, ct)
            ?? throw CreditApplicationRules.Missing();
        return Receipt(row) with { Replayed = true };
    }

    public async Task<CreditPurchaseAuthority> ForQuoteAsync(string owner, string applicationId, string scopeId, string applicationVersion, string scopeVersion, CancellationToken ct)
    {
        CreditApplicationRules.Id(scopeId); CreditApplicationRules.Version(applicationVersion); CreditApplicationRules.Version(scopeVersion);
        // LockAsync requires the consumer's audited root Serializable transaction.
        await Locks(ct); var app = await Visible(owner, false, applicationId, false, ct);
        if (app.State != "Approved" || app.CurrentPurchaseScopeId != scopeId || Convert.ToBase64String(app.Version) != applicationVersion || !await PlanCurrent(app, ct))
            throw CreditPurchaseScopeRules.Conflict();
        var scope = await Current(app, ct);
        if (Convert.ToBase64String(scope.Version) != scopeVersion || scope.ExpiresAt <= clock.GetUtcNow() ||
            await db.ScopeRevocations.AnyAsync(x => x.ScopeId == scope.Id, ct) ||
            await db.PurchaseScopeUses.AnyAsync(x => x.ScopeId == scope.Id, ct)) throw CreditPurchaseScopeRules.Conflict();
        await applications.DetailAsync(owner, false, app.Id, ct);
        return new(app.Id, applicationVersion, scope.Id, scopeVersion, scope.ReviewId, scope.SubmissionId,
            scope.LimitBasis, scope.LimitAmountRial, scope.ExpiresAt, scope.PlanId, scope.PlanVersion, scope.PlanSnapshotHash);
    }

    private async Task Locks(CancellationToken ct)
    {
        await requirements.LockAsync("sayman:credit:requirements:v1", ct);
        await requirements.LockAsync("sayman:credit:application-commands:v1", ct);
    }
    private async Task<CreditApplication> Visible(string actor, bool staff, string id, bool tracking, CancellationToken ct)
    {
        actor = CreditApplicationRules.Actor(actor); CreditApplicationRules.Id(id);
        var q = tracking ? db.Applications.AsQueryable() : db.Applications.AsNoTracking();
        return await q.SingleOrDefaultAsync(x => x.Id == id && (staff || x.OwnerId == actor), ct) ?? throw CreditApplicationRules.Missing();
    }
    private async Task<bool> PlanCurrent(CreditApplication app, CancellationToken ct)
    {
        var plan = await db.Plans.AsNoTracking().SingleOrDefaultAsync(x => x.Id == app.PlanId, ct);
        return plan is { Enabled: true } && Convert.ToBase64String(plan.Version) == app.PlanVersion;
    }
    private async Task<CreditApplicationReview> Approval(CreditApplication app, CancellationToken ct)
    {
        var row = await db.ApplicationReviews.AsNoTracking().SingleOrDefaultAsync(x => x.Id == app.CurrentReviewId && x.ApplicationId == app.Id && x.SubmissionId == app.CurrentSubmissionId, ct);
        if (row is null || row.Outcome != "Approved" || row.ApprovedAmountRial is not > 0 || row.ApprovedAmountRial > app.RequestedAmountRial ||
            row.ExpiresAt is null || !CreditReviewRules.ValidApproval(row.Outcome, row.ApprovedAmountRial, row.ExpiresAt, row.At)) throw CreditApplicationRules.Unavailable();
        return row;
    }
    private async Task<CreditPurchaseScope> Current(CreditApplication app, CancellationToken ct)
    {
        var row = await db.PurchaseScopes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == app.CurrentPurchaseScopeId && x.ApplicationId == app.Id, ct) ?? throw CreditApplicationRules.Unavailable();
        var review = await Approval(app, ct);
        if (row.ReviewId != review.Id || row.SubmissionId != review.SubmissionId || row.LimitAmountRial != review.ApprovedAmountRial || row.ExpiresAt != review.ExpiresAt ||
            row.PlanId != app.PlanId || row.PlanVersion != app.PlanVersion || row.PlanSnapshotHash != app.PlanHash || row.GrantedAt < review.At || row.GrantedAt > app.ChangedAt)
            throw CreditApplicationRules.Unavailable();
        return row;
    }
    private DateTimeOffset Now(CreditApplication app) { var now = clock.GetUtcNow().ToUniversalTime(); return now < app.ChangedAt ? app.ChangedAt : now; }
    private void Event(CreditApplication app, string actor, string action, DateTimeOffset at)
    {
        app.ChangedAt = at;
        // A frozen test clock or two commands in the same tick must still rotate the case version.
        db.Entry(app).Property(x => x.ChangedAt).IsModified = true;
        db.ApplicationEvents.Add(new() { ApplicationId = app.Id, ActorId = actor, Action = action, At = at });
    }
    private async Task<CreditPurchaseScopeData> Data(CreditPurchaseScope row, CancellationToken ct)
    {
        CreditApplicationRules.Id(row.Id); CreditPurchaseScopeRules.Basis(row.LimitBasis);
        if (row.Version.Length != 8 || row.LimitAmountRial <= 0 || row.GrantedAt.Offset != TimeSpan.Zero || row.ExpiresAt.Offset != TimeSpan.Zero || row.ExpiresAt <= row.GrantedAt) throw CreditApplicationRules.Unavailable();
        var revoked = await db.ScopeRevocations.AsNoTracking().SingleOrDefaultAsync(x => x.ScopeId == row.Id, ct);
        CreditScopeRevocationData? detail = null;
        if (revoked is not null)
        {
            if (revoked.ApplicationId != row.ApplicationId || revoked.At < row.GrantedAt || revoked.At.Offset != TimeSpan.Zero || revoked.ActorKind is not ("Owner" or "Staff")) throw CreditApplicationRules.Unavailable();
            try {
                var raw = protection.Unprotect(row.ApplicationId, "scope-note", row.Id, revoked.ProtectedNote);
                if (CreditApplicationRules.Hash(raw) != revoked.NoteHash) throw CreditApplicationRules.Unavailable();
                var note = JsonSerializer.Deserialize<string>(raw, Json) ?? throw CreditApplicationRules.Unavailable();
                CreditRequirementsRules.Text(note, 2000, revoked.ActorKind == "Owner"); CreditApplicationRules.Locale(revoked.Locale);
                detail = new(revoked.ActorKind, revoked.Locale, note, revoked.At);
            } catch (JsonException) { throw CreditApplicationRules.Unavailable(); }
        }
        var used = await db.PurchaseScopeUses.AsNoTracking().SingleOrDefaultAsync(x => x.ScopeId == row.Id, ct);
        CreditScopeUseData? use = null;
        if (used is not null) {
            if (detail is not null || used.ApplicationId != row.ApplicationId || used.At < row.GrantedAt || used.At >= row.ExpiresAt || used.At.Offset != TimeSpan.Zero || used.AssessedAmountRial < 0 || used.AssessedAmountRial > row.LimitAmountRial) throw CreditApplicationRules.Unavailable();
            CreditApplicationRules.Id(used.OrderId); CreditApplicationRules.Id(used.CreditQuoteId); CreditApplicationRules.Digest(used.QuoteFingerprint);
            use = new(used.OrderId, used.CreditQuoteId, used.At);
        }
        return new(row.Id, Convert.ToBase64String(row.Version), row.ReviewId, row.SubmissionId, row.LimitBasis,
            row.LimitAmountRial.ToString(CultureInfo.InvariantCulture), row.ExpiresAt, row.GrantedAt,
            use is not null ? "Used" : detail is not null ? "Revoked" : row.ExpiresAt <= clock.GetUtcNow() ? "Expired" : "Active", detail, use);
    }
    private static string Hash(string id, string kind, bool staff, object input) => CreditApplicationRules.Hash(JsonSerializer.Serialize(new { ApplicationId = id, Kind = kind, Staff = staff, Input = input }, Json));
    private async Task<CreditPurchaseScopeResult?> Replay(string actor, string id, string commandId, string kind, string hash, CancellationToken ct)
    {
        var row = await db.ScopeCommands.AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.CommandId == commandId, ct);
        if (row is null) return null;
        if (row.ApplicationId != id || row.Kind != kind || row.PayloadHash != hash)
            throw new BusinessException("credit_scope_idempotency_conflict", "This scope command has different input.");
        return Receipt(row) with { Replayed = true };
    }
    private async Task<CreditPurchaseScopeResult> SaveReceipt(string actor, string commandId, string kind, string hash, CreditApplication app, CreditPurchaseScope scope, DateTimeOffset at, CancellationToken ct)
    {
        var result = new CreditPurchaseScopeResult(1, false, commandId, kind, CreditApplicationService.Summary(app), await Data(scope, ct));
        var raw = JsonSerializer.Serialize(result, Json);
        db.ScopeCommands.Add(new() { ActorId = actor, CommandId = commandId, ApplicationId = app.Id, ScopeId = scope.Id, Kind = kind, PayloadHash = hash,
            ResultHash = CreditApplicationRules.Hash(raw), ProtectedResult = protection.Protect(app.Id, "scope-receipt", CreditApplicationRules.Hash(actor + ":" + commandId), raw), At = at });
        await db.SaveChangesAsync(ct); return result;
    }
    private CreditPurchaseScopeResult Receipt(CreditScopeCommand row)
    {
        try {
            var raw = protection.Unprotect(row.ApplicationId, "scope-receipt", CreditApplicationRules.Hash(row.ActorId + ":" + row.CommandId), row.ProtectedResult);
            if (CreditApplicationRules.Hash(raw) != row.ResultHash) throw CreditApplicationRules.Unavailable();
            var value = JsonSerializer.Deserialize<CreditPurchaseScopeResult>(raw, Json) ?? throw CreditApplicationRules.Unavailable();
            if (value.SchemaVersion != 1 || value.Replayed || value.CommandId != row.CommandId || value.Kind != row.Kind || value.Application.Id != row.ApplicationId || value.Application.State != "Approved" || value.Scope.Id != row.ScopeId ||
                value.Scope.State != (row.Kind == "Grant" ? "Active" : "Revoked") || (row.Kind == "Grant" ? value.Scope.Revocation is not null : value.Scope.Revocation is null)) throw CreditApplicationRules.Unavailable();
            return value;
        } catch (JsonException) { throw CreditApplicationRules.Unavailable(); }
    }
}
