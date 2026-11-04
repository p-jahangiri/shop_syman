using System.Security.Cryptography;
using System.Text.Json;
using System.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Real GUID SQL fixtures; every gateway below is in-memory and every key/contact
// synthetic. No owner database, key, actual SMS, or external login is used.
public sealed class CustomerOtpSqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    private readonly Clock clock = new();
    private readonly Policy policy = new();
    private readonly Gateway gateway = new();
    private const string Phone = "+989120000000";
    private static string Id() => Guid.NewGuid().ToString("N");
    public async Task InitializeAsync()
    {
        await sql.InitializeAsync();
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var protector = Protection(scope.ServiceProvider);
        var settings = new CustomerSmsSettings { Enabled = true };
        settings.ProtectedApiKey = protector.Protect("key", settings.KeyRevision, "synthetic-key-only");
        db.CustomerSmsSettings.Add(settings);
        await db.SaveChangesAsync();
    }
    public Task DisposeAsync() => sql.DisposeAsync();

    private static ICustomerOtpProtection Protection(IServiceProvider services) =>
        new DataProtectionCustomerOtpProtection(services.GetRequiredService<IDataProtectionProvider>());

    private CustomerOtpService Service(IServiceProvider services, AuthService? auth = null) => new(
        services.GetRequiredService<IdentityDbContext>(), services.GetRequiredService<UserManager<ShopUser>>(),
        auth ?? services.GetRequiredService<AuthService>(), Protection(services), policy, gateway, clock);

    private async Task<CustomerOtpStarted> Start(string phone = Phone, string? request = null)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        gateway.OnSend = () => Assert.Null(db.Database.CurrentTransaction);
        return await Service(scope.ServiceProvider).StartAsync(new(phone, request ?? Id()), "synthetic-trace", default);
    }

    private async Task<AuthResult> Verify(string challenge, string? code = null)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        return await Service(scope.ServiceProvider).VerifyAsync(new(challenge, code ?? gateway.Code), "synthetic-trace", default);
    }

    private static string UserId(AuthResult result) => JsonSerializer.SerializeToElement(result.User).GetProperty("Id").GetString()!;

    private async Task<ShopUser> Account(bool confirmed = true, string? role = null, bool password = false,
        string phone = Phone, bool mfa = false)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var manager = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var user = new ShopUser { UserName = "customer_" + Id(), Email = Id() + "@example.invalid",
            EmailConfirmed = true, PhoneNumber = phone, PhoneNumberConfirmed = confirmed, DisplayName = "Synthetic customer",
            RequireMfa = mfa, TwoFactorEnabled = mfa };
        var created = password ? await manager.CreateAsync(user, "Synthetic-Password!123") : await manager.CreateAsync(user);
        Assert.True(created.Succeeded);
        if (role is not null)
        {
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
            if (!await roles.RoleExistsAsync(role)) Assert.True((await roles.CreateAsync(new(role))).Succeeded);
            Assert.True((await manager.AddToRoleAsync(user, role)).Succeeded);
        }
        return user;
    }

    [Fact]
    public async Task AcceptedStartIsIdempotentAndAtomicConsumptionCreatesOnePasswordlessCustomerSession()
    {
        var request = Id();
        var started = await Start(request: request);
        var replayed = await Start("۰۹۱۲۰۰۰۰۰۰۰", request);
        Assert.Equal(started, replayed);
        Assert.Equal(1, gateway.Attempts);
        Assert.Equal("accepted", started.Delivery);
        var login = await Verify(started.ChallengeId);
        Assert.False(login.RequiresMfa);
        Assert.NotNull(login.RefreshToken);
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(started.ChallengeId))).Code);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = await db.Users.SingleAsync(x => x.Id == UserId(login));
        Assert.Null(user.PasswordHash);
        Assert.True(user.PhoneNumberConfirmed);
        Assert.Equal(Phone, user.CanonicalPhone);
        Assert.False(user.RequireMfa);
        Assert.Empty(await db.UserRoles.Where(x => x.UserId == user.Id).ToArrayAsync());
        Assert.Equal(1, await db.Sessions.CountAsync(x => x.UserId == user.Id));
        var challenge = await db.CustomerOtpChallenges.SingleAsync();
        Assert.NotNull(challenge.ConsumedAt);
        Assert.Equal("12", challenge.ProviderMessageId);
        Assert.Equal(clock.Now.AddSeconds(300), challenge.ExpiresAt);
        Assert.Equal(clock.Now.AddSeconds(60), challenge.ResendAt);
        Assert.Equal(gateway.Code, Protection(scope.ServiceProvider).Unprotect("otp-code", challenge.Id, challenge.ProtectedCode));
        Assert.Throws<CryptographicException>(() => Protection(scope.ServiceProvider).Unprotect("otp-code", Id(), challenge.ProtectedCode));
        Assert.DoesNotContain(gateway.Code, string.Join('|', await db.Audit.Select(x => x.Action + x.Resource + x.TraceId).ToArrayAsync()));
    }

    [Fact]
    public async Task TwoConcurrentVerificationsConsumeOnceAndCreateExactlyOneSession()
    {
        var start = await Start();
        async Task<bool> Attempt()
        {
            try { _ = await Verify(start.ChallengeId); return true; }
            catch (BusinessException error) { Assert.Equal("otp_invalid", error.Code); return false; }
        }
        var results = await Task.WhenAll(Attempt(), Attempt());
        Assert.Single(results, x => x);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var userId = await db.Users.Where(x => x.CanonicalPhone == Phone).Select(x => x.Id).SingleAsync();
        Assert.Equal(1, await db.Sessions.CountAsync(x => x.UserId == userId));
        Assert.Equal(1, await db.Audit.CountAsync(x => x.Action == "CUSTOMER_OTP_VERIFIED"));
    }

    [Theory]
    [InlineData("unconfirmed")]
    [InlineData("staff")]
    [InlineData("unknown-role")]
    [InlineData("inactive")]
    [InlineData("collision")]
    public async Task ExistingNoneligibleOrAmbiguousPhonesNeverGrantOrConfirmAnAccount(string kind)
    {
        var user = await Account(confirmed: kind != "unconfirmed", role: kind == "staff" ? "SupportAgent"
            : kind == "unknown-role" ? "UnknownAssignedRole" : null);
        if (kind == "inactive")
        {
            await using var change = sql.Factory.Services.CreateAsyncScope();
            await change.ServiceProvider.GetRequiredService<IdentityDbContext>().Users.Where(x => x.Id == user.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsActive, false));
        }
        if (kind == "collision") _ = await Account(phone: "09120000000");
        var started = await Start();
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(started.ChallengeId))).Code);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(kind != "unconfirmed", await db.Users.Where(x => x.Id == user.Id).Select(x => x.PhoneNumberConfirmed).SingleAsync());
        Assert.Null((await db.CustomerOtpChallenges.SingleAsync()).ConsumedAt);
    }

    [Fact]
    public async Task VerifiedLegacyAliasLogsIntoItsOwnCustomerAndCustomerMfaRemainsMandatory()
    {
        var user = await Account(phone: "۰۹۱۲۰۰۰۰۰۰۰", mfa: true);
        var started = await Start();
        var result = await Verify(started.ChallengeId);
        Assert.True(result.RequiresMfa);
        Assert.Null(result.RefreshToken);
        Assert.Equal(user.Id, UserId(result));
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(Phone, await db.Users.Where(x => x.Id == user.Id).Select(x => x.CanonicalPhone).SingleAsync());
        Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == user.Id));
        Assert.NotNull((await db.CustomerOtpChallenges.SingleAsync()).ConsumedAt);
    }

    [Theory]
    [InlineData("role", "otp_invalid")]
    [InlineData("phone", "otp_invalid")]
    [InlineData("disabled", "otp_unavailable")]
    [InlineData("key", "otp_configuration_conflict")]
    public async Task VerificationRechecksCurrentEligibilityAndAvailabilityAfterDispatch(string change, string expected)
    {
        var user = await Account();
        var start = await Start();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            if (change == "role") Assert.True((await scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>()
                .AddToRoleAsync((await db.Users.SingleAsync(x => x.Id == user.Id)), "SupportAgent")).Succeeded);
            else if (change == "phone") await db.Users.Where(x => x.Id == user.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.PhoneNumberConfirmed, false));
            else if (change == "disabled") await db.CustomerSmsSettings.ExecuteUpdateAsync(s => s.SetProperty(x => x.Enabled, false));
            else await db.CustomerSmsSettings.ExecuteUpdateAsync(s => s.SetProperty(x => x.KeyRevision, Id()));
        }
        Assert.Equal(expected, (await Assert.ThrowsAsync<BusinessException>(() => Verify(start.ChallengeId))).Code);
        await using var check = sql.Factory.Services.CreateAsyncScope();
        var current = check.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(0, await current.Sessions.CountAsync(x => x.UserId == user.Id));
        Assert.Null((await current.CustomerOtpChallenges.SingleAsync()).ConsumedAt);
    }

    [Fact]
    public async Task AttemptsExpiryResendAndRequestBindingArePersistent()
    {
        var firstRequest = Id();
        var first = await Start(request: firstRequest);
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Start("+989130000000", firstRequest))).Code);
        Assert.Equal("otp_cooldown", (await Assert.ThrowsAsync<BusinessException>(() => Start())).Code);
        var wrong = gateway.Code == "999999" ? "000000" : "999999";
        for (var attempt = 0; attempt < 5; attempt++)
            Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(first.ChallengeId, wrong))).Code);
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(first.ChallengeId))).Code);
        clock.Now = clock.Now.AddSeconds(60);
        var next = await Start();
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(first.ChallengeId))).Code);
        clock.Now = clock.Now.AddSeconds(300);
        Assert.Equal("otp_expired", (await Assert.ThrowsAsync<BusinessException>(() => Verify(next.ChallengeId))).Code);
        Assert.Equal(2, gateway.Attempts);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var rows = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().CustomerOtpChallenges.OrderBy(x => x.CreatedAt).ToArrayAsync();
        Assert.Equal(5, rows[0].FailedAttempts);
        Assert.NotNull(rows[0].SupersededAt);
        Assert.All(rows, x => Assert.Null(x.ConsumedAt));
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("rejected")]
    public async Task AmbiguousAndRejectedSendsAreNeverRepeatedForTheSameRequest(string outcome)
    {
        gateway.Disposition = outcome == "unknown" ? CustomerOtpSmsDisposition.Unknown : CustomerOtpSmsDisposition.Rejected;
        var request = Id();
        if (outcome == "rejected")
        {
            Assert.Equal("otp_delivery_rejected", (await Assert.ThrowsAsync<BusinessException>(() => Start(request: request))).Code);
            Assert.Equal("otp_delivery_rejected", (await Assert.ThrowsAsync<BusinessException>(() => Start(request: request))).Code);
        }
        else
        {
            var first = await Start(request: request);
            Assert.Equal("unknown", first.Delivery);
            Assert.Equal(first, await Start(request: request));
            Assert.NotNull((await Verify(first.ChallengeId)).RefreshToken);
        }
        Assert.Equal(1, gateway.Attempts);
    }

    [Theory]
    [InlineData("phone-hour", 5)]
    [InlineData("phone-day", 20)]
    [InlineData("global-hour", 100)]
    [InlineData("global-day", 1000)]
    public async Task PersistentLimitsCountRejectedAttemptsAcrossRequests(string kind, int count)
    {
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var at = clock.Now.AddHours(kind.EndsWith("day", StringComparison.Ordinal) ? -2 : -0.1);
            db.CustomerOtpChallenges.AddRange(Enumerable.Range(0, count).Select(_ => new CustomerOtpChallenge
            {
                RequestId = Id(), CanonicalPhone = kind.StartsWith("phone", StringComparison.Ordinal) ? Phone : "+989130000000",
                CreatedAt = at, ExpiresAt = at.AddSeconds(300), ResendAt = at.AddSeconds(60),
                State = "Rejected", ProtectedCode = [1], SettingsKeyRevision = Id()
            }));
            await db.SaveChangesAsync();
        }
        Assert.Equal("otp_rate_limited", (await Assert.ThrowsAsync<BusinessException>(() => Start())).Code);
        Assert.Equal(0, gateway.Attempts);
    }

    [Fact]
    public async Task RegistrationAndSandboxAreSeparateFromVerifiedExistingCustomerAccess()
    {
        policy.Value = new(true, false);
        var started = await Start();
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(started.ChallengeId))).Code);
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            Assert.Equal(0, await db.Users.CountAsync(x => x.CanonicalPhone == Phone));
            var row = await db.CustomerSmsSettings.SingleAsync();
            row.Mode = "sandbox"; row.TemplateId = 123456; row.CodeParameterName = "Code"; row.NameParameterName = null;
            await db.SaveChangesAsync();
        }
        Assert.Equal("otp_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Verify(started.ChallengeId))).Code);
        Assert.Equal("otp_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Start("+989140000000"))).Code);
        Assert.Equal(1, gateway.Attempts);
    }

    [Fact]
    public async Task FailureAfterUserAndSessionPreparationRollsBackAccountConsumptionSessionAndAudit()
    {
        var start = await Start();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var services = scope.ServiceProvider;
            var broken = new AuthService(services.GetRequiredService<UserManager<ShopUser>>(),
                services.GetRequiredService<RoleManager<IdentityRole>>(), services.GetRequiredService<IdentityDbContext>(),
                new("too-short", "test", "test"), clock);
            await Assert.ThrowsAnyAsync<Exception>(() => Service(services, broken).VerifyAsync(new(start.ChallengeId, gateway.Code), "rollback-test", default));
        }
        await using var check = sql.Factory.Services.CreateAsyncScope();
        var db = check.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(0, await db.Users.CountAsync(x => x.CanonicalPhone == Phone));
        Assert.Null((await db.CustomerOtpChallenges.SingleAsync()).ConsumedAt);
        Assert.Equal(0, await db.Audit.CountAsync(x => x.Action == "CUSTOMER_OTP_VERIFIED"));
    }

    [Fact]
    public async Task SettingsCasFreshAdminAndReplayInvalidateOnlyPendingCodesAndProtectOtpOnlyContinuity()
    {
        var admin = await Account(role: "Administrator", password: true, phone: "+989190000000", mfa: true);
        var first = await Start();
        CustomerSmsSettingsInput input;
        CustomerSmsSettingsDto saved;
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var services = scope.ServiceProvider;
            var service = Settings(services);
            var current = await service.GetAsync(admin.Id, admin.SecurityStamp!, default);
            input = new(current.Version, Id(), "smsIr", true, "live", 170274, "CODE", null, "", "keep");
            saved = await service.SaveAsync(admin.Id, admin.SecurityStamp!, input, "settings-trace", default);
            Assert.True(saved.KeyConfigured);
        }
        Assert.Equal("otp_invalid", (await Assert.ThrowsAsync<BusinessException>(() => Verify(first.ChallengeId))).Code);
        var second = await Start("+989130000000");
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var service = Settings(scope.ServiceProvider);
            Assert.Equal(saved, await service.SaveAsync(admin.Id, admin.SecurityStamp!, input, "settings-replay", default));
            Assert.Equal("sms_settings_conflict", (await Assert.ThrowsAsync<BusinessException>(() => service.SaveAsync(admin.Id,
                admin.SecurityStamp!, input with { GenericName = "changed" }, "settings-conflict", default))).Code);
        }
        var customer = await Verify(second.ChallengeId);
        Assert.NotNull(customer.RefreshToken);
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var service = Settings(scope.ServiceProvider);
            var current = await service.GetAsync(admin.Id, admin.SecurityStamp!, default);
            Assert.Equal("customer_login_continuity_conflict", (await Assert.ThrowsAsync<BusinessException>(() => service.SaveAsync(
                admin.Id, admin.SecurityStamp!, input with { RequestId = Id(), Version = current.Version, ApiKeyAction = "clear" },
                "clear-denied", default))).Code);
        }
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var services = scope.ServiceProvider;
            var db = services.GetRequiredService<IdentityDbContext>();
            Assert.True((await Settings(services).GetAsync(admin.Id, admin.SecurityStamp!, default)).KeyConfigured);
            Assert.Equal(1, await db.Sessions.CountAsync(x => x.UserId == UserId(customer)));
            Assert.Equal(1, await db.Audit.CountAsync(x => x.Action == "CUSTOMER_SMS_SETTINGS_SAVED"));
            Assert.Equal(1, await db.CustomerSmsSettingsCommands.CountAsync());
            Assert.Equal("invalid_credentials", (await Assert.ThrowsAsync<BusinessException>(() => Settings(services).GetAsync(admin.Id, "stale", default))).Code);
        }
    }

    private CustomerSmsSettingsService Settings(IServiceProvider services) => new(
        services.GetRequiredService<UserManager<ShopUser>>(), services.GetRequiredService<IdentityDbContext>(),
        Protection(services), policy, services.GetRequiredService<ICustomerLoginContinuity>(), clock, development: true);

    [Theory]
    [InlineData("disabled")]
    [InlineData("missing")]
    [InlineData("sandbox")]
    public async Task OtpOnlyPublicationRequiresLiveCapabilityEvenWithoutEligibleCustomers(string availability)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<IdentityDbContext>();
        var settings = await db.CustomerSmsSettings.SingleAsync();
        if (availability == "missing") db.CustomerSmsSettings.Remove(settings);
        else if (availability == "disabled") settings.Enabled = false;
        else
        {
            settings.Mode = "sandbox"; settings.TemplateId = 123456;
            settings.CodeParameterName = "Code"; settings.NameParameterName = null;
        }
        await db.SaveChangesAsync();
        Assert.Equal(0, await db.Users.CountAsync(x => x.IsActive && !db.UserRoles.Any(r => r.UserId == x.Id)));
        var cms = services.GetRequiredService<CmsDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await CustomerSmsRules.LockAsync(db, default);
        cms.Database.SetDbConnection(db.Database.GetDbConnection(), contextOwnsConnection: false);
        await cms.Database.UseTransactionAsync(transaction.GetDbTransaction());
        var document = await cms.Documents.SingleAsync(x => x.Key == "auth" && x.Locale == "fa");
        var published = document.PublishedJson;
        var revisions = await cms.Revisions.CountAsync();
        document.DraftJson = """{"mobileOtp":true,"emailPassword":false,"usernamePassword":false,"registration":true,"passwordReset":false}""";
        await cms.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<BusinessException>(() => services.GetRequiredService<ContentService>()
            .PublishAsync("auth", "fa", Convert.ToBase64String(document.Version), "synthetic-publisher", null, default));
        Assert.Equal("customer_login_continuity_conflict", error.Code);
        Assert.Equal(published, await cms.Documents.AsNoTracking().Where(x => x.Key == "auth" && x.Locale == "fa")
            .Select(x => x.PublishedJson).SingleAsync());
        Assert.Equal(revisions, await cms.Revisions.CountAsync());
        await transaction.RollbackAsync();
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Policy : ICustomerOtpPolicy
    {
        public CustomerOtpPolicy Value { get; set; } = new(true, true);
        public Task<CustomerOtpPolicy> ReadAsync(CancellationToken ct) => Task.FromResult(Value);
    }
    private sealed class Gateway : ICustomerOtpSmsGateway
    {
        public int Attempts { get; private set; }
        public string Code { get; private set; } = "";
        public Action? OnSend { get; set; }
        public CustomerOtpSmsDisposition Disposition { get; set; } = CustomerOtpSmsDisposition.Accepted;
        public Task<CustomerOtpSmsResult> SendAsync(CustomerOtpSmsRequest request, CancellationToken ct)
            => request.DispatchAsync((_, _, code, _, _, _, _, _) =>
            {
                Attempts++;
                Code = code;
                OnSend?.Invoke();
                return Task.FromResult(new CustomerOtpSmsResult(Disposition,
                    Disposition == CustomerOtpSmsDisposition.Accepted ? CustomerOtpSmsReason.None : CustomerOtpSmsReason.Uncertain,
                    Disposition == CustomerOtpSmsDisposition.Accepted ? "12" : null));
            }, ct);
    }
}
