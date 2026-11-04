using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Each case uses SqlFixture's fresh GUID SQL database and private key ring.
// Only the outbound gateway is replaced in the actual composition root. All
// keys, contacts, codes and accounts below are synthetic; no network SMS runs.
public sealed class CustomerOtpHttpSqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    private readonly Gateway gateway = new();
    private WebApplicationFactory<Program> app = null!;
    private const string SettingsPath = "/api/admin/sms/settings";
    private const string Phone = "+989550000001";
    private const string SyntheticKey = "synthetic-http-otp-key-not-an-owner-credential";
    private static string Id() => Guid.NewGuid().ToString("N");

    public async Task InitializeAsync()
    {
        await sql.InitializeAsync();
        try
        {
            app = sql.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICustomerOtpSmsGateway>();
                services.AddSingleton<ICustomerOtpSmsGateway>(gateway);
            }));
            await using var scope = app.Services.CreateAsyncScope();
            AssertFixture(scope.ServiceProvider.GetRequiredService<IdentityDbContext>());
            Assert.Same(gateway, scope.ServiceProvider.GetRequiredService<ICustomerOtpSmsGateway>());
        }
        catch
        {
            await DisposeAsync();
            throw;
        }
    }

    public async Task DisposeAsync()
    {
        try { if (app is not null) await app.DisposeAsync(); }
        finally { await sql.DisposeAsync(); }
    }

    [Fact]
    public async Task SettingsRequireAnActualAdministratorWithCompletedMfaAndCurrentSecurityStamp()
    {
        using var anonymous = Customer();
        await Status(await anonymous.GetAsync(SettingsPath), HttpStatusCode.Unauthorized);
        using var contentManager = await Staff(role: "ContentManager");
        await Status(await contentManager.GetAsync(SettingsPath), HttpStatusCode.Forbidden);
        await Status(await contentManager.PutAsJsonAsync(SettingsPath, Input(null)), HttpStatusCode.Forbidden);

        var admin = await Account(role: "Administrator");
        using var pending = await StaffPending(admin);
        await Status(await pending.GetAsync(SettingsPath), HttpStatusCode.Forbidden);
        await CompleteStaffMfa(pending);
        var current = await Json(await pending.GetAsync(SettingsPath), isPrivate: true);
        Assert.False(current["keyConfigured"]!.GetValue<bool>());
        Assert.Equal("unconfigured", S(current, "availability"));

        await using (var scope = app.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            Ensure(await users.UpdateSecurityStampAsync((await users.FindByIdAsync(admin.Id))!));
        }
        await Status(await pending.GetAsync(SettingsPath), HttpStatusCode.Unauthorized);
        await using var check = app.Services.CreateAsyncScope();
        var db = check.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Empty(await db.CustomerSmsSettings.ToArrayAsync());
        Assert.Empty(await db.CustomerSmsSettingsCommands.ToArrayAsync());
        Assert.Equal(0, gateway.Attempts);
    }

    [Fact]
    public async Task BrowserOriginsQueriesAndUnmappedInputAreRejectedBeforeAnySettingsOrSendMutation()
    {
        using var staff = await Staff();
        using var crossAdmin = Customer("http://untrusted.example");
        crossAdmin.DefaultRequestHeaders.Authorization = staff.DefaultRequestHeaders.Authorization;
        await Status(await crossAdmin.PutAsJsonAsync(SettingsPath, Input(null)), HttpStatusCode.Forbidden);
        await Status(await crossAdmin.GetAsync(SettingsPath), HttpStatusCode.Forbidden);
        await Status(await staff.GetAsync(SettingsPath + "?includeKey=true"), HttpStatusCode.BadRequest);
        await Status(await staff.PutAsJsonAsync(SettingsPath + "?owner=other", Input(null)), HttpStatusCode.BadRequest);
        var extraSettings = JsonSerializer.SerializeToNode(Input(null), JsonSerializerOptions.Web)!.AsObject();
        extraSettings["ownerId"] = "other";
        await Status(await staff.PutAsJsonAsync(SettingsPath, extraSettings), HttpStatusCode.BadRequest);

        using var customer = Customer();
        using var crossCustomer = Customer("http://untrusted.example");
        await Error(await crossCustomer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id() }),
            HttpStatusCode.BadRequest, "invalid_origin");
        await Status(await customer.PostAsJsonAsync("/api/auth/otp?code=123456", new { mobile = Phone, requestId = Id() }), HttpStatusCode.BadRequest);
        await Status(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id(), userId = "other" }), HttpStatusCode.BadRequest);
        await Status(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = Id(), code = "123456", userId = "other" }), HttpStatusCode.BadRequest);
        await Status(await customer.PostAsJsonAsync("/api/auth/otp/verify?owner=other", new { challengeId = Id(), code = "123456" }), HttpStatusCode.BadRequest);
        await Status(await staff.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id() }), HttpStatusCode.BadRequest);
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Empty(await db.CustomerSmsSettings.ToArrayAsync());
        Assert.Empty(await db.CustomerSmsSettingsCommands.ToArrayAsync());
        Assert.Empty(await db.CustomerOtpChallenges.ToArrayAsync());
        Assert.Equal(0, gateway.Attempts);
    }

    [Fact]
    public async Task AdministratorCasAndExactReplayReturnOnlyWriteOnlyKeyMetadataAndNeverPublishTheKey()
    {
        using var staff = await Staff();
        var before = await Json(await staff.GetAsync(SettingsPath), isPrivate: true);
        Assert.Null(before["version"]);
        var input = Input(null);
        var saved = await Json(await staff.PutAsJsonAsync(SettingsPath, input), isPrivate: true);
        AssertSettingsShape(saved);
        Assert.True(saved["keyConfigured"]!.GetValue<bool>());
        Assert.Equal("configured", S(saved, "availability"));
        Assert.Equal(8, Convert.FromBase64String(S(saved, "version")).Length);
        var state = await State();
        var replay = await Json(await staff.PutAsJsonAsync(SettingsPath, input), isPrivate: true);
        Assert.Equal(saved.ToJsonString(), replay.ToJsonString());
        Assert.Equal(state, await State());
        await Error(await staff.PutAsJsonAsync(SettingsPath, input with { RequestId = Id() }),
            HttpStatusCode.Conflict, "sms_settings_conflict");
        await Error(await staff.PutAsJsonAsync(SettingsPath, input with { GenericName = "changed" }),
            HttpStatusCode.Conflict, "sms_settings_conflict");
        Assert.Equal(state, await State());

        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var row = await db.CustomerSmsSettings.AsNoTracking().SingleAsync();
            Assert.NotNull(row.ProtectedApiKey);
            Assert.DoesNotContain(SyntheticKey, Encoding.UTF8.GetString(row.ProtectedApiKey!));
            Assert.Equal(SyntheticKey, scope.ServiceProvider.GetRequiredService<ICustomerOtpProtection>()
                .Unprotect("key", row.KeyRevision, row.ProtectedApiKey!));
            Assert.Equal(1, await db.CustomerSmsSettingsCommands.CountAsync());
            Assert.Equal(1, await db.Audit.CountAsync(x => x.Action == "CUSTOMER_SMS_SETTINGS_SAVED"));
            var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            Assert.DoesNotContain(SyntheticKey, JsonSerializer.Serialize(await cms.Documents.AsNoTracking().ToArrayAsync()));
            Assert.DoesNotContain(SyntheticKey, JsonSerializer.Serialize(await cms.Revisions.AsNoTracking().ToArrayAsync()));
        }
        using var customer = Customer();
        foreach (var locale in new[] { "fa", "en" })
        {
            var published = await Json(await customer.GetAsync("/api/storefront/" + locale + "?metadataOnly=true"));
            Assert.DoesNotContain(SyntheticKey, published.ToJsonString());
            Assert.DoesNotContain("protectedApiKey", published.ToJsonString(), StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(0, gateway.Attempts);
    }

    [Fact]
    public async Task PublishedLivePolicyProjectsBothLocalesAndOneUseOtpCreatesOneCustomerAndOnePrivateSession()
    {
        using var staff = await Staff();
        // The development seed has OTP intent enabled. Establish an explicit
        // published-off policy so a configured gateway alone cannot satisfy
        // this publication test or accidentally turn a draft into live policy.
        await PublishAuth(staff, mobile: false, registration: false);
        await Configure(staff);
        using var customer = Customer();
        await AssertPublicFlags(customer, mobile: false, registration: false);
        await SaveAuth(staff);
        await AssertPublicFlags(customer, mobile: false, registration: false);
        var head = await AuthHead(staff);
        await Status(await staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { version = S(head, "version") }), HttpStatusCode.NoContent);
        await AssertPublicFlags(customer, mobile: true, registration: true);
        var requestId = Id();
        var started = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId }), isPrivate: true, noCookie: true);
        AssertChallengeShape(started);
        var replay = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId }), isPrivate: true, noCookie: true);
        Assert.Equal(started.ToJsonString(), replay.ToJsonString());
        Assert.Equal(1, gateway.Attempts);
        Assert.Equal(Phone, gateway.Mobile);
        Assert.Matches("^[0-9]{6}$", gateway.Code);
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var row = await db.CustomerOtpChallenges.AsNoTracking().SingleAsync();
            Assert.Equal(requestId, row.RequestId);
            Assert.Equal(300, (row.ExpiresAt - row.CreatedAt).TotalSeconds);
            Assert.Equal(60, (row.ResendAt - row.CreatedAt).TotalSeconds);
            Assert.Equal(S(started, "expiresAt"), row.ExpiresAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture));
            Assert.Equal(0, await db.Users.CountAsync(x => x.CanonicalPhone == Phone));
        }
        var signed = await Signed(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(started, "challengeId"), code = gateway.Code }));
        var userId = S(signed["user"]!, "id");
        customer.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken"));
        var profile = await Json(await customer.GetAsync("/api/account/profile"), isPrivate: true);
        Assert.Equal(userId, S(profile, "id"));
        Assert.True(profile["phoneNumberConfirmed"]!.GetValue<bool>());
        await Error(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(started, "challengeId"), code = gateway.Code }),
            HttpStatusCode.Unauthorized, "otp_invalid", Phone, gateway.Code);
        await AssertOneCustomerSession(userId, S(started, "challengeId"));
    }

    [Fact]
    public async Task KnownProviderRejectionIsSafeAndIdempotentWhileUnknownDeliveryCanStillBeVerified()
    {
        using var staff = await Staff();
        await Configure(staff);
        await PublishAuth(staff);
        using var customer = Customer();
        gateway.Disposition = CustomerOtpSmsDisposition.Rejected;
        var requestId = Id();
        await Error(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId }),
            HttpStatusCode.ServiceUnavailable, "otp_delivery_rejected", Phone, gateway.Code);
        await Error(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId }),
            HttpStatusCode.ServiceUnavailable, "otp_delivery_rejected", Phone, gateway.Code);
        Assert.Equal(1, gateway.Attempts);
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            Assert.Equal("Rejected", (await db.CustomerOtpChallenges.AsNoTracking().SingleAsync()).State);
            Assert.Equal(0, await db.Users.CountAsync(x => x.CanonicalPhone == Phone));
        }
        gateway.Disposition = CustomerOtpSmsDisposition.Unknown;
        var second = "+989550000002";
        var started = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = second, requestId = Id() }), isPrivate: true, noCookie: true);
        Assert.Equal("unknown", S(started, "delivery"));
        var signed = await Signed(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(started, "challengeId"), code = gateway.Code }));
        Assert.Equal(2, gateway.Attempts);
        await AssertOneCustomerSession(S(signed["user"]!, "id"), S(started, "challengeId"));
    }

    [Fact]
    public async Task DevelopmentSandboxCanBeConfiguredButNeverAdvertisesOrProvesPublicCustomerIdentity()
    {
        using var staff = await Staff();
        var settings = await Configure(staff, sandbox: true);
        Assert.Equal("sandbox", S(settings, "availability"));
        Assert.True(settings["keyConfigured"]!.GetValue<bool>());
        await PublishAuth(staff);
        using var customer = Customer();
        await AssertPublicFlags(customer, mobile: false, registration: false);
        await Error(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id() }),
            HttpStatusCode.ServiceUnavailable, "otp_unavailable", Phone);
        await Error(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = Id(), code = "123456" }),
            HttpStatusCode.ServiceUnavailable, "otp_unavailable");
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Empty(await db.CustomerOtpChallenges.ToArrayAsync());
        Assert.Equal(0, await db.Users.CountAsync(x => x.CanonicalPhone == Phone));
        Assert.Equal(0, gateway.Attempts);
    }

    [Fact]
    public async Task ClearingTheKeyOrDisablingSmsCannotStrandAnOtpOnlyCustomerAndEachConflictIsAtomic()
    {
        using var staff = await Staff();
        await Configure(staff);
        await PublishAuth(staff);
        using var customer = Customer();
        var started = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id() }), isPrivate: true, noCookie: true);
        var signed = await Signed(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(started, "challengeId"), code = gateway.Code }));
        var current = await Json(await staff.GetAsync(SettingsPath), isPrivate: true);
        var before = await State();
        foreach (var input in new[]
        {
            Input(S(current, "version")) with { ApiKeyAction = "clear", ApiKey = null },
            Input(S(current, "version")) with { Enabled = false, ApiKeyAction = "keep", ApiKey = null }
        })
        {
            await Error(await staff.PutAsJsonAsync(SettingsPath, input), HttpStatusCode.Conflict,
                "customer_login_continuity_conflict", Phone, S(signed["user"]!, "id"));
            Assert.Equal(before, await State());
            var after = await Json(await staff.GetAsync(SettingsPath), isPrivate: true);
            Assert.Equal(current.ToJsonString(), after.ToJsonString());
            await AssertPublicFlags(customer, mobile: true, registration: true);
        }
        customer.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken"));
        Assert.Equal(S(signed["user"]!, "id"), S(await Json(await customer.GetAsync("/api/account/profile"), isPrivate: true), "id"));
    }

    [Fact]
    public async Task ExistingCustomerAuthenticatorRemainsRequiredAndStaffCannotAcquireACustomerSessionFromSms()
    {
        using var staff = await Staff();
        await Configure(staff);
        await PublishAuth(staff);
        var account = await Account(phone: Phone, customerMfa: true);
        string secret;
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            var user = (await users.FindByIdAsync(account.Id))!;
            Ensure(await users.ResetAuthenticatorKeyAsync(user));
            secret = (await users.GetAuthenticatorKeyAsync(user))!;
        }
        using var customer = Customer();
        var started = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = Phone, requestId = Id() }), isPrivate: true, noCookie: true);
        var pending = await Json(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(started, "challengeId"), code = gateway.Code }), isPrivate: true, noCookie: true);
        Assert.True(pending["requiresMfa"]!.GetValue<bool>());
        Assert.False(pending["requiresEnrollment"]!.GetValue<bool>());
        Assert.Equal("mfa_pending", new JwtSecurityTokenHandler().ReadJwtToken(S(pending, "accessToken")).Claims.Single(x => x.Type == "token_kind").Value);
        await using (var scope = app.Services.CreateAsyncScope())
            Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Sessions.CountAsync(x => x.UserId == account.Id));
        customer.DefaultRequestHeaders.Authorization = new("Bearer", S(pending, "accessToken"));
        await Status(await customer.GetAsync("/api/account/profile"), HttpStatusCode.Forbidden);
        var completed = await Signed(await customer.PostAsJsonAsync("/api/auth/mfa/verify", new { code = Totp.Code(secret, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }));
        Assert.Equal(account.Id, S(completed["user"]!, "id"));

        var staffPhone = "+989550000003";
        var employee = await Account(role: "ContentManager", phone: staffPhone);
        // Starting a request does not disclose whether the phone is a staff or
        // customer contact. Actual proof must still reject staff as a customer.
        customer.DefaultRequestHeaders.Authorization = null;
        var staffChallenge = await Json(await customer.PostAsJsonAsync("/api/auth/otp", new { mobile = staffPhone, requestId = Id() }), isPrivate: true, noCookie: true);
        await Error(await customer.PostAsJsonAsync("/api/auth/otp/verify", new { challengeId = S(staffChallenge, "challengeId"), code = gateway.Code }),
            HttpStatusCode.Unauthorized, "otp_invalid", staffPhone, employee.Id, gateway.Code);
        await using var check = app.Services.CreateAsyncScope();
        var db = check.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == employee.Id));
        Assert.True((await db.Sessions.SingleAsync(x => x.UserId == account.Id)).MfaVerified);
        Assert.Equal(2, gateway.Attempts);
    }

    private CustomerSmsSettingsInput Input(string? version, bool sandbox = false) => new(version, Id(), "smsIr", true,
        sandbox ? "sandbox" : "live", sandbox ? 123456 : 170274, sandbox ? "Code" : "CODE",
        sandbox ? null : "NAME", sandbox ? "" : "کاربر سایمان", "replace", SyntheticKey);

    private async Task<JsonNode> Configure(HttpClient staff, bool sandbox = false)
    {
        var current = await Json(await staff.GetAsync(SettingsPath), isPrivate: true);
        return await Json(await staff.PutAsJsonAsync(SettingsPath, Input(current["version"]?.GetValue<string>(), sandbox)), isPrivate: true);
    }

    private async Task PublishAuth(HttpClient staff, bool mobile = true, bool registration = true)
    {
        await SaveAuth(staff, mobile, registration);
        var head = await AuthHead(staff);
        await Status(await staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { version = S(head, "version") }), HttpStatusCode.NoContent);
    }

    private static async Task SaveAuth(HttpClient staff, bool mobile = true, bool registration = true)
    {
        var head = await AuthHead(staff);
        var value = new JsonObject
        {
            ["mobileOtp"] = mobile, ["registration"] = registration, ["emailPassword"] = true,
            ["usernamePassword"] = true, ["passwordReset"] = false
        };
        await Status(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(value, S(head, "version"))), HttpStatusCode.NoContent);
    }

    private static async Task<JsonNode> AuthHead(HttpClient staff) => (await Json(await staff.GetAsync("/api/admin/content"), isPrivate: true))["documents"]!
        .AsArray().Single(node => S(node!, "key") == "auth" && S(node!, "locale") == "fa")!;

    private static async Task AssertPublicFlags(HttpClient customer, bool mobile, bool registration)
    {
        foreach (var locale in new[] { "fa", "en" })
        {
            var snapshot = await Json(await customer.GetAsync("/api/storefront/" + locale + "?metadataOnly=true"));
            var auth = snapshot["authSettings"]!;
            Assert.Equal(mobile, auth["mobileOtp"]!.GetValue<bool>());
            Assert.Equal(registration, auth["registration"]!.GetValue<bool>());
            Assert.True(auth["emailPassword"]!.GetValue<bool>());
            Assert.True(auth["usernamePassword"]!.GetValue<bool>());
            Assert.False(auth["passwordReset"]!.GetValue<bool>());
            Assert.DoesNotContain(SyntheticKey, snapshot.ToJsonString());
        }
    }

    private async Task AssertOneCustomerSession(string userId, string challengeId)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == userId);
        Assert.Null(user.PasswordHash);
        Assert.True(user.PhoneNumberConfirmed);
        Assert.False(user.RequireMfa);
        Assert.False(user.TwoFactorEnabled);
        Assert.Empty(await db.UserRoles.Where(x => x.UserId == userId).ToArrayAsync());
        Assert.Equal(1, await db.Sessions.CountAsync(x => x.UserId == userId));
        Assert.NotNull((await db.CustomerOtpChallenges.AsNoTracking().SingleAsync(x => x.Id == challengeId)).ConsumedAt);
        Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == userId && x.Action == "CUSTOMER_OTP_VERIFIED"));
    }

    private sealed record AccountIdentity(string Id, string Name);
    private async Task<AccountIdentity> Account(string? role = null, string? phone = null, bool customerMfa = false)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        AssertFixture(db);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var user = new ShopUser
        {
            UserName = "otp_http_" + Id(), DisplayName = "Synthetic HTTP OTP account",
            Email = Id() + "@example.invalid", EmailConfirmed = true,
            PhoneNumber = phone, CanonicalPhone = phone, PhoneNumberConfirmed = phone is not null,
            RequireMfa = role is not null || customerMfa, TwoFactorEnabled = customerMfa, IsActive = true
        };
        Ensure(role is null ? await users.CreateAsync(user) : await users.CreateAsync(user, sql.Password));
        if (role is not null) Ensure(await users.AddToRoleAsync(user, role));
        return new(user.Id, user.UserName!);
    }

    private HttpClient Customer(string origin = "http://127.0.0.1:3000")
    {
        var client = app.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", origin);
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "storefront");
        return client;
    }

    private async Task<HttpClient> Staff(string role = "Administrator")
    {
        var client = await StaffPending(await Account(role));
        try { await CompleteStaffMfa(client); return client; }
        catch { client.Dispose(); throw; }
    }

    private async Task<HttpClient> StaffPending(AccountIdentity account)
    {
        var client = Customer("http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Remove("X-Sayman-Client");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        try
        {
            var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { identifier = account.Name, password = sql.Password }), isPrivate: true, noCookie: true);
            Assert.True(pending["requiresMfa"]!.GetValue<bool>());
            client.DefaultRequestHeaders.Authorization = new("Bearer", S(pending, "accessToken"));
            return client;
        }
        catch { client.Dispose(); throw; }
    }

    private static async Task CompleteStaffMfa(HttpClient client)
    {
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }), isPrivate: true, noCookie: true);
        client.DefaultRequestHeaders.Authorization = new("Bearer", S(setup, "accessToken"));
        var signed = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { code = Totp.Code(S(setup, "secret"), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }), isPrivate: true);
        Assert.False(signed["requiresMfa"]!.GetValue<bool>());
        client.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken"));
    }

    private sealed record DatabaseState(string Settings, string Commands, string SmsAudit, string Challenges, string Customers, string Sessions, string Cms);
    private async Task<DatabaseState> State()
    {
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        AssertFixture(db);
        var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        return new(
            JsonSerializer.Serialize(await db.CustomerSmsSettings.AsNoTracking().ToArrayAsync()),
            JsonSerializer.Serialize(await db.CustomerSmsSettingsCommands.AsNoTracking().OrderBy(x => x.ActorId).ThenBy(x => x.RequestId).ToArrayAsync()),
            JsonSerializer.Serialize(await db.Audit.AsNoTracking().Where(x => x.Action.StartsWith("CUSTOMER_SMS_")).OrderBy(x => x.Id).ToArrayAsync()),
            JsonSerializer.Serialize(await db.CustomerOtpChallenges.AsNoTracking().OrderBy(x => x.Id).ToArrayAsync()),
            JsonSerializer.Serialize(await db.Users.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.CanonicalPhone, x.PhoneNumberConfirmed, HasPassword = x.PasswordHash != null, x.SecurityStamp }).ToArrayAsync()),
            JsonSerializer.Serialize(await db.Sessions.AsNoTracking().OrderBy(x => x.Id).ToArrayAsync()),
            JsonSerializer.Serialize(await cms.Documents.AsNoTracking().OrderBy(x => x.Key).ThenBy(x => x.Locale).ToArrayAsync()));
    }

    private static void AssertSettingsShape(JsonNode value)
    {
        Assert.Equal(new[] { "availability", "codeParameterName", "enabled", "genericName", "keyConfigured", "maxAttempts", "mode", "nameParameterName", "otpLifetimeSeconds", "provider", "resendAfterSeconds", "schemaVersion", "templateId", "version" },
            value.AsObject().Select(x => x.Key).Order(StringComparer.Ordinal).ToArray());
        Assert.DoesNotContain(SyntheticKey, value.ToJsonString());
        Assert.Equal(300, value["otpLifetimeSeconds"]!.GetValue<int>());
        Assert.Equal(60, value["resendAfterSeconds"]!.GetValue<int>());
        Assert.Equal(5, value["maxAttempts"]!.GetValue<int>());
    }

    private static void AssertChallengeShape(JsonNode value)
    {
        Assert.Equal(new[] { "challengeId", "delivery", "expiresAt", "resendAt", "schemaVersion" }, value.AsObject().Select(x => x.Key).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(1, value["schemaVersion"]!.GetValue<int>());
        Assert.Matches("^[a-f0-9]{32}$", S(value, "challengeId"));
        Assert.Matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{7}Z$", S(value, "expiresAt"));
        Assert.Matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{7}Z$", S(value, "resendAt"));
        Assert.Equal("accepted", S(value, "delivery"));
    }

    private static async Task<JsonNode> Signed(HttpResponseMessage response)
    {
        using (response)
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Private(response);
            var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
            Assert.Matches("^sayman_refresh=[a-f0-9]{64};", cookie);
            Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("max-age=", cookie, StringComparison.OrdinalIgnoreCase);
            // Local Development deliberately serves HTTP. Production adds Secure
            // and the __Host- name through the unchanged AuthHttpSecurity policy.
            Assert.DoesNotContain("secure", cookie, StringComparison.OrdinalIgnoreCase);
            var raw = await response.Content.ReadAsStringAsync();
            var value = JsonNode.Parse(raw)!;
            Assert.Null(value["refreshToken"]);
            Assert.False(value["requiresMfa"]!.GetValue<bool>());
            Assert.False(value["requiresEnrollment"]!.GetValue<bool>());
            Assert.Empty(value["user"]!["roles"]!.AsArray());
            Assert.Empty(value["user"]!["permissions"]!.AsArray());
            var token = new JwtSecurityTokenHandler().ReadJwtToken(S(value, "accessToken"));
            Assert.Equal("access", token.Claims.Single(x => x.Type == "token_kind").Value);
            Assert.Equal(S(value["user"]!, "id"), token.Subject);
            Assert.DoesNotContain(token.Claims, x => x.Type is "role" or "permission");
            return value;
        }
    }

    private static async Task<JsonNode> Json(HttpResponseMessage response, bool isPrivate = false, bool noCookie = false)
    {
        using (response)
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            if (isPrivate) Private(response);
            if (noCookie) Assert.False(response.Headers.Contains("Set-Cookie"));
            var raw = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain(SyntheticKey, raw);
            return JsonNode.Parse(raw)!;
        }
    }

    private static async Task Error(HttpResponseMessage response, HttpStatusCode expected, string code, params string[] privateValues)
    {
        using (response)
        {
            Assert.Equal(expected, response.StatusCode);
            Private(response);
            Assert.False(response.Headers.Contains("Set-Cookie"));
            var raw = await response.Content.ReadAsStringAsync();
            Assert.Equal(code, S(JsonNode.Parse(raw)!, "title"));
            Assert.DoesNotContain(SyntheticKey, raw);
            Assert.DoesNotContain("provider-message", raw);
            foreach (var value in privateValues.Where(x => !string.IsNullOrEmpty(x))) Assert.DoesNotContain(value, raw, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static async Task Status(HttpResponseMessage response, HttpStatusCode expected)
    {
        using (response)
        {
            Assert.Equal(expected, response.StatusCode);
            Private(response);
            if (expected != HttpStatusCode.NoContent) Assert.False(response.Headers.Contains("Set-Cookie"));
            if (expected == HttpStatusCode.NoContent) Assert.Equal("", await response.Content.ReadAsStringAsync());
        }
    }

    private static void Private(HttpResponseMessage response)
    {
        Assert.Contains("private", response.Headers.CacheControl!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.True(response.Headers.CacheControl.NoStore);
        Assert.Contains("Cookie", response.Headers.Vary);
        Assert.Contains("Authorization", response.Headers.Vary);
        Assert.Equal("noindex, nofollow", Assert.Single(response.Headers.GetValues("X-Robots-Tag")));
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    }

    private static string S(JsonNode value, string key) => value[key]!.GetValue<string>();
    private static void Ensure(IdentityResult result) => Assert.True(result.Succeeded, string.Join(";", result.Errors.Select(x => x.Code)));
    private static void AssertFixture(IdentityDbContext db) => Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);

    private sealed class Gateway : ICustomerOtpSmsGateway
    {
        public int Attempts { get; private set; }
        public string Code { get; private set; } = "";
        public string Mobile { get; private set; } = "";
        public CustomerOtpSmsDisposition Disposition { get; set; } = CustomerOtpSmsDisposition.Accepted;
        public Task<CustomerOtpSmsResult> SendAsync(CustomerOtpSmsRequest request, CancellationToken ct) =>
            request.DispatchAsync((_, mobile, code, _, _, _, _, _) =>
            {
                Attempts++;
                Code = code;
                Mobile = mobile;
                return Task.FromResult(new CustomerOtpSmsResult(Disposition,
                    Disposition == CustomerOtpSmsDisposition.Accepted ? CustomerOtpSmsReason.None : CustomerOtpSmsReason.ProviderRejected,
                    Disposition == CustomerOtpSmsDisposition.Accepted ? "12345" : null));
            }, ct);
    }
}
