using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed class StaffProvisioningService(UserManager<ShopUser> users, RoleManager<IdentityRole> roles,
    IdentityDbContext db, IStaffProvisioningProtection protection, TimeProvider time) : IStaffProvisioning
{
    private static readonly JsonSerializerOptions ReceiptOptions = new() {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 8
    };

    public async Task<StaffAccountCreated> CreateAsync(string actorId, string stamp,
        CreateStaffAccountInput supplied, string traceId, CancellationToken ct)
    {
        var input = StaffProvisioningRules.Validate(supplied);
        await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
        var command = Guid.Parse(input.RequestId);
        var existing = await db.StaffCreationCommands.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ActorId == actorId && x.RequestId == command, ct);
        if (existing is not null) {
            string expected;
            try {
                expected = protection.Unprotect(actorId, input.RequestId, "fingerprint", existing.ProtectedFingerprint);
                if (expected.Length != 64 || !expected.All(char.IsAsciiHexDigit)) throw new CryptographicException();
            } catch (Exception error) when (error is CryptographicException or ArgumentException) {
                throw new BusinessException("staff_creation_unavailable", "The staff creation receipt could not be verified.");
            }
            var actual = StaffProvisioningRules.Fingerprint(input);
            if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual)))
                throw new BusinessException("staff_creation_idempotency_conflict", "This staff creation command has different fields.");
            return ReadReceipt(existing);
        }
        if (await users.FindByNameAsync(input.UserName) is not null)
            throw new BusinessException("staff_username_conflict", "This username already exists.");
        var user = new ShopUser {
            UserName = input.UserName, DisplayName = input.DisplayName, Email = input.Email,
            EmailConfirmed = false, PhoneNumberConfirmed = false, IsActive = true,
            ProvisionedByAdministrator = true, MustChangePassword = true, RequireMfa = true,
            CreatedAt = time.GetUtcNow()
        };
        var created = await users.CreateAsync(user, input.InitialPassword);
        if (!created.Succeeded && created.Errors.Any(x => x.Code == "DuplicateUserName"))
            throw new BusinessException("staff_username_conflict", "This username already exists.");
        MfaAccount.Ensure(created);
        foreach (var role in input.Roles) {
            if (!await roles.RoleExistsAsync(role)) MfaAccount.Ensure(await roles.CreateAsync(new IdentityRole(role)));
        }
        MfaAccount.Ensure(await users.AddToRolesAsync(user, input.Roles));
        Event(actorId, user.Id, "STAFF_CREATED", traceId);
        foreach (var role in input.Roles) Event(actorId, user.Id, "STAFF_ROLE_ADDED:" + role, traceId);
        var result = new StaffAccountCreated(1, input.RequestId, false,
            new StaffRow(user.Id, user.UserName!, user.DisplayName, true, false, false,
                user.CreatedAt, user.ConcurrencyStamp!, input.Roles, true, true));
        db.StaffCreationCommands.Add(new() {
            ActorId = actorId, RequestId = command, UserId = user.Id, CreatedAt = time.GetUtcNow(),
            ProtectedFingerprint = protection.Protect(actorId, input.RequestId, "fingerprint", StaffProvisioningRules.Fingerprint(input)),
            ProtectedReceipt = protection.Protect(actorId, input.RequestId, "receipt", JsonSerializer.Serialize(result, ReceiptOptions))
        });
        await db.SaveChangesAsync(ct);
        return result;
    }

    public async Task<StaffAccountCreated> ReceiptAsync(string actorId, string stamp, string requestId, CancellationToken ct)
    {
        StaffProvisioningRules.CommandId(requestId);
        await using var owned = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct) : null;
        await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
        var id = Guid.Parse(requestId);
        var row = await db.StaffCreationCommands.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ActorId == actorId && x.RequestId == id, ct)
            ?? throw new BusinessException("not_found", "This staff creation receipt was not found.");
        var result = ReadReceipt(row);
        if (owned is not null) await owned.CommitAsync(ct);
        return result;
    }

    private StaffAccountCreated ReadReceipt(StaffCreationCommand row)
    {
        try {
            var result = JsonSerializer.Deserialize<StaffAccountCreated>(protection.Unprotect(row.ActorId,
                row.RequestId.ToString("D"), "receipt", row.ProtectedReceipt), ReceiptOptions);
            if (result is null || result.Staff is null || result.SchemaVersion != 1 || result.RequestId != row.RequestId.ToString("D")
                || result.Staff.Id != row.UserId || result.Replayed || !result.Staff.RequiresPasswordChange
                || !result.Staff.ProvisionedByAdministrator || !result.Staff.IsActive || result.Staff.TwoFactorEnabled)
                throw new JsonException("Staff receipt binding changed.");
            return result with { Replayed = true };
        } catch (Exception error) when (error is JsonException or CryptographicException or ArgumentException) {
            throw new BusinessException("staff_creation_unavailable", "The staff creation receipt could not be verified.");
        }
    }

    private void Event(string actor, string target, string action, string trace) => db.Audit.Add(new() {
        ActorId = actor, Action = action, Resource = "/staff/" + target, TraceId = trace, At = time.GetUtcNow()
    });
}
