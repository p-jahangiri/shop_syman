using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed class CustomerOtpService(IdentityDbContext db, UserManager<ShopUser> users,
    AuthService auth, ICustomerOtpProtection protection, ICustomerOtpPolicy policy,
    ICustomerOtpSmsGateway gateway, TimeProvider time, ISmsOtpConfigurationSource? workspace = null) : ICustomerOtpService
{
    public async Task<CustomerOtpStarted> StartAsync(CustomerOtpStartInput input, string traceId, CancellationToken ct)
    {
        var phone = CustomerOtpRules.NormalizePhone(input.Mobile);
        CustomerOtpRules.Id(input.RequestId);
        if (db.Database.CurrentTransaction is not null)
            throw new InvalidOperationException("OTP dispatch must own its transaction and release it before HTTP.");
        CustomerOtpChallenge challenge;
        Func<CancellationToken, Task<CustomerOtpSmsResult>> dispatch;
        await using (var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            await CustomerSmsRules.LockAsync(db, ct);
            var context = await RequireLiveSettingsAsync(ct);
            var previous = await db.CustomerOtpChallenges.SingleOrDefaultAsync(x => x.RequestId == input.RequestId, ct);
            if (previous is not null)
            {
                if (previous.CanonicalPhone != phone) throw CustomerOtpRules.Invalid();
                if (previous.SettingsKeyRevision != context.Generation) throw ConfigurationChanged();
                if (previous.State == "Rejected") throw DeliveryRejected();
                if (previous.ExpiresAt <= time.GetUtcNow() || previous.SupersededAt is not null || previous.ConsumedAt is not null)
                    throw CustomerOtpRules.Invalid();
                await transaction.CommitAsync(ct);
                return CustomerOtpRules.Dto(previous);
            }
            var now = time.GetUtcNow();
            var latest = await db.CustomerOtpChallenges.Where(x => x.CanonicalPhone == phone)
                .OrderByDescending(x => x.CreatedAt).FirstOrDefaultAsync(ct);
            if (latest is not null && latest.ResendAt > now)
                throw new BusinessException("otp_cooldown", "Wait before requesting another verification.");
            await RequireLimitsAsync(phone, now, context.Policy, ct);
            var code = CustomerOtpRules.NewCode();
            challenge = new()
            {
                RequestId = input.RequestId, CanonicalPhone = phone,
                CreatedAt = now, ExpiresAt = now.AddSeconds(context.Policy.LifetimeSeconds), ResendAt = now.AddSeconds(context.Policy.ResendSeconds),
                SettingsKeyRevision = context.Generation, LifetimeSeconds = context.Policy.LifetimeSeconds,
                ResendSeconds = context.Policy.ResendSeconds, MaxAttempts = context.Policy.MaxAttempts
            };
            try
            {
                challenge.ProtectedCode = protection.Protect("otp-code", challenge.Id, code);
                if (context.Workspace is { } configured) dispatch = token => configured.SendAsync(phone, code, token);
                else {
                    var settings = context.Legacy!;
                    var envelope = new CustomerOtpSmsRequest(protection.Unprotect("key", settings.KeyRevision, settings.ProtectedApiKey!),
                        phone, code, settings.TemplateId, settings.CodeParameterName, settings.NameParameterName,
                        settings.NameParameterName is null ? null : settings.GenericName);
                    dispatch = token => gateway.SendAsync(envelope, token);
                }
            }
            catch (Exception error) when (error is CryptographicException or ArgumentException)
            {
                throw CustomerSmsRules.Unavailable();
            }
            await db.CustomerOtpChallenges.Where(x => x.CanonicalPhone == phone && x.SupersededAt == null
                && x.ConsumedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.SupersededAt, now), ct);
            db.CustomerOtpChallenges.Add(challenge);
            await db.SaveChangesAsync(ct);
            challenge.State = "Dispatching";
            db.Audit.Add(new() { ActorId = "customer-otp", Action = "CUSTOMER_OTP_DISPATCH_CLAIMED",
                Resource = "/otp/" + challenge.Id, TraceId = traceId, At = now });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        // No SQL transaction/lock spans the one outbound attempt. Even a lost
        // HTTP response is not a permission to send this request id again.
        CustomerOtpSmsResult sent;
        try { sent = await dispatch(ct); }
        catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException)
        {
            sent = new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain);
        }
        if (sent is null || sent.Disposition == CustomerOtpSmsDisposition.Accepted
            && (!long.TryParse(sent.MessageId, NumberStyles.None, CultureInfo.InvariantCulture, out var messageId)
                || messageId <= 0 || messageId.ToString(CultureInfo.InvariantCulture) != sent.MessageId))
            sent = new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain);
        using var finalizationDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var finishCt = finalizationDeadline.Token;
        await using (var finish = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, finishCt))
        {
            await CustomerSmsRules.LockAsync(db, finishCt);
            await db.Entry(challenge).ReloadAsync(finishCt);
            if (challenge.State == "Dispatching")
            {
                challenge.State = sent.Disposition switch
                {
                    CustomerOtpSmsDisposition.Accepted => "Accepted",
                    CustomerOtpSmsDisposition.Rejected => "Rejected",
                    _ => "Unknown"
                };
                challenge.ProviderMessageId = sent.Disposition == CustomerOtpSmsDisposition.Accepted
                    ? sent.MessageId : null;
                db.Audit.Add(new() { ActorId = "customer-otp", Action = "CUSTOMER_OTP_DISPATCH_" + challenge.State.ToUpperInvariant(),
                    Resource = "/otp/" + challenge.Id, TraceId = traceId, At = time.GetUtcNow() });
                await db.SaveChangesAsync(finishCt);
            }
            await finish.CommitAsync(finishCt);
        }
        if (challenge.State == "Rejected") throw DeliveryRejected();
        return CustomerOtpRules.Dto(challenge);
    }

    public async Task<AuthResult> VerifyAsync(CustomerOtpVerifyInput input, string traceId, CancellationToken ct)
    {
        CustomerOtpRules.VerifyInput(input);
        if (db.Database.CurrentTransaction is not null)
            throw new InvalidOperationException("OTP verification must own its atomic transaction.");
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await CustomerSmsRules.LockAsync(db, ct);
        var settings = await RequireLiveSettingsAsync(ct);
        var row = await db.CustomerOtpChallenges.SingleOrDefaultAsync(x => x.Id == input.ChallengeId, ct);
        var now = time.GetUtcNow();
        if (row is null || row.ConsumedAt is not null || row.SupersededAt is not null
            || row.State is not ("Accepted" or "Unknown" or "Dispatching") || row.FailedAttempts >= row.MaxAttempts)
            throw CustomerOtpRules.Invalid();
        if (row.ExpiresAt <= now)
            throw new BusinessException("otp_expired", "The verification has expired.");
        if (row.SettingsKeyRevision != settings.Generation) throw ConfigurationChanged();
        string code;
        try { code = protection.Unprotect("otp-code", row.Id, row.ProtectedCode); }
        catch (Exception error) when (error is CryptographicException or ArgumentException) { throw CustomerSmsRules.Unavailable(); }
        if (code.Length != 6 || code.AsSpan().IndexOfAnyExceptInRange('0', '9') >= 0)
            throw CustomerSmsRules.Unavailable();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(code), Encoding.ASCII.GetBytes(input.Code)))
        {
            using var failureDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var failureCt = failureDeadline.Token;
            row.FailedAttempts++;
            db.Audit.Add(new() { ActorId = "customer-otp", Action = "CUSTOMER_OTP_VERIFY_FAILED",
                Resource = "/otp/" + row.Id, TraceId = traceId, At = now });
            await db.SaveChangesAsync(failureCt);
            await transaction.CommitAsync(failureCt);
            throw CustomerOtpRules.Invalid();
        }

        var owners = await CustomerPhoneOwnership.FindAsync(db, row.CanonicalPhone, ct);
        ShopUser user;
        if (owners.Length > 1) throw CustomerOtpRules.Invalid();
        if (owners.Length == 1)
        {
            user = await users.FindByIdAsync(owners[0]) ?? throw CustomerOtpRules.Invalid();
            await db.Entry(user).ReloadAsync(ct);
            if (!user.IsActive || !user.PhoneNumberConfirmed || user.MustChangePassword || user.MfaRecoveryPending
                || !CustomerOtpRules.TryNormalizePhone(user.PhoneNumber, out var current) || current != row.CanonicalPhone
                || user.CanonicalPhone is not null && user.CanonicalPhone != current
                || await users.IsLockedOutAsync(user)
                || (await users.GetRolesAsync(user)).Count != 0) throw CustomerOtpRules.Invalid();
            // Establish the index binding only after proof of an already verified
            // legacy phone; never confirm or take over an unverified contact.
            user.CanonicalPhone = current;
            MfaAccount.Ensure(await users.UpdateAsync(user));
        }
        else
        {
            if (!(await policy.ReadAsync(ct)).RegistrationEnabled) throw CustomerOtpRules.Invalid();
            user = new()
            {
                UserName = "customer_" + Guid.NewGuid().ToString("N"), DisplayName = "کاربر سایمان",
                PhoneNumber = row.CanonicalPhone, CanonicalPhone = row.CanonicalPhone,
                PhoneNumberConfirmed = true, CreatedAt = now
            };
            MfaAccount.Ensure(await users.CreateAsync(user));
        }
        row.ConsumedAt = now;
        db.Audit.Add(new() { ActorId = user.Id, Action = "CUSTOMER_OTP_VERIFIED",
            Resource = "/otp/" + row.Id, TraceId = traceId, At = now });
        await db.SaveChangesAsync(ct);
        var result = await auth.CompleteCustomerOtpAsync(user.Id, ct);
        await transaction.CommitAsync(ct);
        return result;
    }

    private sealed record DispatchContext(SmsOtpPolicy Policy, string Generation, CustomerSmsSettings? Legacy, SmsOtpConfiguration? Workspace);
    private async Task<DispatchContext> RequireLiveSettingsAsync(CancellationToken ct)
    {
        var configured = workspace is null ? null : await workspace.ReadAsync(ct);
        if (configured is not null) {
            if (!configured.Available || !(await policy.ReadAsync(ct)).MobileOtpEnabled) throw CustomerSmsRules.Unavailable();
            return new(configured.Policy, configured.Generation, null, configured);
        }
        var settings = await db.CustomerSmsSettings.AsNoTracking().SingleOrDefaultAsync(ct);
        if (!CustomerSmsRules.LoginAvailable(settings) || !(await policy.ReadAsync(ct)).MobileOtpEnabled)
            throw CustomerSmsRules.Unavailable();
        return new(new(), settings!.KeyRevision, settings, null);
    }

    private async Task RequireLimitsAsync(string phone, DateTimeOffset now, SmsOtpPolicy limits, CancellationToken ct)
    {
        var day = now.AddDays(-1);
        var hour = now.AddHours(-1);
        var recent = db.CustomerOtpChallenges.Where(x => x.CreatedAt > day);
        if (await recent.CountAsync(x => x.CanonicalPhone == phone, ct) >= limits.PhoneDailyLimit
            || await recent.CountAsync(x => x.CanonicalPhone == phone && x.CreatedAt > hour, ct) >= limits.PhoneHourlyLimit
            || await recent.CountAsync(ct) >= limits.GlobalDailyLimit
            || await recent.CountAsync(x => x.CreatedAt > hour, ct) >= limits.GlobalHourlyLimit)
            throw new BusinessException("otp_rate_limited", "Verification requests are temporarily limited.");
    }

    private static BusinessException DeliveryRejected() => new("otp_delivery_rejected", "The verification message was not accepted. Try again later.");
    private static BusinessException ConfigurationChanged() => new("otp_configuration_conflict", "Request a new verification after the SMS configuration change.");
}
