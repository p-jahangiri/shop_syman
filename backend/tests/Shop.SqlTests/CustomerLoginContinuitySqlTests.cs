using System.Data;
using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// This class deliberately owns a fresh GUID database per case. Identity rows and
// the real authentication limiter must not leak between continuity scenarios.
// All accounts, passwords and the legacy corruption below are synthetic.
public sealed class CustomerLoginContinuitySqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    private int nextPhone;
    private const string Conflict = "customer_login_continuity_conflict";
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();

    [Fact]
    public async Task PhoneVerifiedCustomerCanKeepLoggingInWhileEmailOnlyDraftPublishAndLegacyRestoreFailAtomically()
    {
        var customer = await Account(email: false, phoneVerified: true);
        await AssertCustomerLogin(customer.Name, customer.Id);
        using var staff = await Staff();
        using var anonymous = CustomerClient();
        var original = await Head(staff);
        var publicFa = await PublicAuth(anonymous, "fa");
        var publicEn = await PublicAuth(anonymous, "en");
        var beforeSave = await State();

        // Drafting a proposed policy is allowed. It cannot affect customer login.
        await NoContent(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(Auth(true, false), S(original, "version"))));
        var proposed = await Head(staff);
        Assert.NotEqual(S(original, "version"), S(proposed, "version"));
        Assert.NotEqual(beforeSave.Documents, (await State()).Documents);
        Assert.Equal(publicFa, await PublicAuth(anonymous, "fa"));
        Assert.Equal(publicEn, await PublicAuth(anonymous, "en"));
        await AssertCustomerLogin(customer.Name, customer.Id);

        // An old revision can bypass today's draft validation in the database;
        // publication must therefore recheck the selected historical content.
        var legacyId = await LegacyRevision(Auth(true, false));
        var beforePublication = await State();
        await Reject(await Publish(staff, S(proposed, "version")), Conflict, customer);
        Assert.Equal(beforePublication, await State());
        await Reject(await Publish(staff, S(proposed, "version"), legacyId), Conflict, customer);
        Assert.Equal(beforePublication, await State());
        Assert.Equal(publicFa, await PublicAuth(anonymous, "fa"));
        Assert.Equal(publicEn, await PublicAuth(anonymous, "en"));
        await AssertCustomerLogin(customer.Name, customer.Id);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ARealEmailAliasAndOrdinaryUsernameCanEachBeTheOnlyEnabledMethod(bool emailVerified)
    {
        var customer = await Account(phoneVerified: true);
        if (!emailVerified) {
            await using var scope = sql.Factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Users.Where(user => user.Id == customer.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(user => user.EmailConfirmed, false));
        }
        using var staff = await Staff();
        using var anonymous = CustomerClient();
        await Switch(staff, email: true, username: false);
        await AssertCustomerLogin(" " + customer.Email!.ToUpperInvariant() + " ", customer.Id);
        await Reject(await Password(customer.Name), "invalid_credentials", customer, HttpStatusCode.Unauthorized);
        foreach (var locale in new[] { "fa", "en" }) {
            var auth = JsonNode.Parse(await PublicAuth(anonymous, locale))!;
            Assert.True(auth["emailPassword"]!.GetValue<bool>());
            Assert.False(auth["usernamePassword"]!.GetValue<bool>());
        }

        await Switch(staff, email: false, username: true);
        await AssertCustomerLogin(" " + customer.Name.ToUpperInvariant() + " ", customer.Id);
        await Reject(await Password(customer.Email!), "invalid_credentials", customer, HttpStatusCode.Unauthorized);
        foreach (var locale in new[] { "fa", "en" }) {
            var auth = JsonNode.Parse(await PublicAuth(anonymous, locale))!;
            Assert.False(auth["emailPassword"]!.GetValue<bool>());
            Assert.True(auth["usernamePassword"]!.GetValue<bool>());
            Assert.False(auth["mobileOtp"]!.GetValue<bool>());
        }
    }

    [Theory]
    [InlineData("email-without-at")]
    [InlineData("stale-normalized-email")]
    [InlineData("stale-normalized-username")]
    public async Task LegacyIdentityAliasesMustMatchActualRoutingAndNormalizedLookupBeforeASingleMethodCanBePublished(string legacy)
    {
        var customer = await Account(phoneVerified: true);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var normalizer = scope.ServiceProvider.GetRequiredService<ILookupNormalizer>();
            AssertFixture(db);
            if (legacy == "email-without-at") {
                customer = customer with { Email = customer.Name };
                await db.Users.Where(user => user.Id == customer.Id).ExecuteUpdateAsync(set => set
                    .SetProperty(user => user.Email, customer.Email)
                    .SetProperty(user => user.NormalizedEmail, normalizer.NormalizeEmail(customer.Email)));
            }
            else if (legacy == "stale-normalized-email") {
                customer = customer with { Email = "changed" + Id() + "@example.invalid" };
                await db.Users.Where(user => user.Id == customer.Id).ExecuteUpdateAsync(set => set.SetProperty(user => user.Email, customer.Email));
            }
            else {
                customer = customer with { Name = "changed" + Id() };
                await db.Users.Where(user => user.Id == customer.Id).ExecuteUpdateAsync(set => set.SetProperty(user => user.UserName, customer.Name));
            }
        }
        if (legacy == "email-without-at") {
            // The malformed Email value can happen to be an ordinary username;
            // that does not make it usable with email-only settings.
            await AssertCustomerLogin(customer.Email!, customer.Id);
        }
        else await Reject(await Password(legacy == "stale-normalized-email" ? customer.Email! : customer.Name),
            "invalid_credentials", customer, HttpStatusCode.Unauthorized);
        using var staff = await Staff();
        var emailOnly = legacy != "stale-normalized-username";
        await Save(staff, email: emailOnly, username: !emailOnly);
        var head = await Head(staff);
        var before = await State();
        await Reject(await Publish(staff, S(head, "version")), Conflict, customer);
        Assert.Equal(before, await State());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AtSignUsernamesFollowEmailRoutingInsteadOfBeingMistakenForAUsernameAlias(bool hasEmail)
    {
        var customer = await Account(email: hasEmail, phoneVerified: true, name: "legacy" + Id() + "@username.invalid");
        // PasswordAsync always routes an @ identifier through FindByEmailAsync.
        // An existing UserName value is not proof that username-only will work.
        await Reject(await Password(customer.Name), "invalid_credentials", customer, HttpStatusCode.Unauthorized);
        if (hasEmail) await AssertCustomerLogin(customer.Email!, customer.Id);
        using var staff = await Staff();
        await Save(staff, email: false, username: true);
        var head = await Head(staff);
        var before = await State();
        await Reject(await Publish(staff, S(head, "version")), Conflict, customer);
        Assert.Equal(before, await State());
        if (hasEmail) {
            await Switch(staff, email: true, username: false);
            await AssertCustomerLogin(customer.Email!, customer.Id);
        }
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("inactive")]
    public async Task AmbiguousEmailAgainstAnyIdentityRowRejectsPublicationWithoutLeakingCustomerData(string shadowKind)
    {
        var customer = await Account();
        var shadow = await Account(role: shadowKind == "staff" ? "ContentManager" : null, active: shadowKind != "inactive");
        using var staff = await Staff();
        await Save(staff, email: true, username: false);

        // The production index prevents this state today. A legacy/corrupt
        // database must still fail closed. Drop only this GUID fixture's index,
        // introduce one duplicate, and restore both row and index in finally.
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            AssertFixture(db);
            await db.Database.ExecuteSqlRawAsync("DROP INDEX [EmailIndex] ON [identity].[AspNetUsers]");
        }
        try {
            await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
                var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
                var normalizer = scope.ServiceProvider.GetRequiredService<ILookupNormalizer>();
                var normalized = normalizer.NormalizeEmail(customer.Email);
                Assert.Equal(1, await db.Users.Where(user => user.Id == shadow.Id).ExecuteUpdateAsync(set => set
                    .SetProperty(user => user.Email, customer.Email)
                    .SetProperty(user => user.NormalizedEmail, normalized)));
                Assert.Equal(2, await db.Users.CountAsync(user => user.NormalizedEmail == normalized));
            }

            // Verify the actual Identity lookup is ambiguous, rather than
            // merely asserting a hypothetical duplicate in an unrelated column.
            await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
                await Assert.ThrowsAsync<InvalidOperationException>(() => scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>()
                    .FindByEmailAsync(customer.Email!));
            }
            var head = await Head(staff);
            var before = await State();
            await Reject(await Publish(staff, S(head, "version")), Conflict, customer, shadow);
            Assert.Equal(before, await State());
        }
        finally {
            await using var scope = sql.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            AssertFixture(db);
            var normalizer = scope.ServiceProvider.GetRequiredService<ILookupNormalizer>();
            await db.Users.Where(user => user.Id == shadow.Id).ExecuteUpdateAsync(set => set
                .SetProperty(user => user.Email, shadow.Email)
                .SetProperty(user => user.NormalizedEmail, normalizer.NormalizeEmail(shadow.Email)));
            await db.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX [EmailIndex] ON [identity].[AspNetUsers] ([NormalizedEmail]) WHERE [NormalizedEmail] IS NOT NULL");
        }

        await Switch(staff, email: true, username: false);
        await AssertCustomerLogin(customer.Email!, customer.Id);
    }

    [Fact]
    public async Task StaffInactiveAndUnverifiedPasswordlessAccountsDoNotBlockAnOtherwiseSafeSwitch()
    {
        var customer = await Account();
        var staffOnly = await Account(email: false, phoneVerified: true, role: "ContentManager");
        var inactive = await Account(email: false, phoneVerified: true, active: false);
        // A verified passwordless phone is now a real OTP-only customer and
        // must be protected. This legacy account has never proved a contact.
        var passwordless = await Account(email: false, phoneVerified: false, hasPassword: false);
        var unverified = await Account(email: false, phoneVerified: false);
        using var staff = await Staff();
        await Switch(staff, email: true, username: false);
        await AssertCustomerLogin(customer.Email!, customer.Id);
        // Administrative entry is independent of the customer-facing switches.
        using var independentStaff = await Staff(staffOnly);
        var content = await Json(await independentStaff.GetAsync("/api/admin/content"));
        Assert.NotEmpty(content["documents"]!.AsArray());
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.False((await db.Users.SingleAsync(user => user.Id == inactive.Id)).IsActive);
        Assert.Null((await db.Users.SingleAsync(user => user.Id == passwordless.Id)).PasswordHash);
        var untouched = await db.Users.SingleAsync(user => user.Id == unverified.Id);
        Assert.False(untouched.EmailConfirmed);
        Assert.False(untouched.PhoneNumberConfirmed);
    }

    [Theory]
    [InlineData("temporary-lockout")]
    [InlineData("unknown-role")]
    public async Task TemporaryIdentityLockoutAndUnknownCustomerRoleDoNotExcludeAnEligibleCustomer(string state)
    {
        var customer = await Account(email: false, phoneVerified: true,
            role: state == "unknown-role" ? "ContinuitySyntheticCustomerRole" : null);
        if (state == "temporary-lockout") {
            await using var scope = sql.Factory.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            var user = (await users.FindByIdAsync(customer.Id))!;
            Ensure(await users.SetLockoutEnabledAsync(user, true));
            Ensure(await users.SetLockoutEndDateAsync(user, DateTimeOffset.UtcNow.AddMinutes(10)));
            Assert.True(await users.IsLockedOutAsync(user));
        }
        else await AssertCustomerLogin(customer.Name, customer.Id);

        using var staff = await Staff();
        await Save(staff, email: true, username: false);
        var head = await Head(staff);
        var before = await State();
        await Reject(await Publish(staff, S(head, "version")), Conflict, customer);
        Assert.Equal(before, await State());
        if (state == "temporary-lockout") {
            await using var scope = sql.Factory.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            Ensure(await users.SetLockoutEndDateAsync((await users.FindByIdAsync(customer.Id))!, null));
        }
        await AssertCustomerLogin(customer.Name, customer.Id);
    }

    [Fact]
    public async Task StaleDraftAndPublicationVersionsFailWithoutMutations()
    {
        var customer = await Account(email: false, phoneVerified: true);
        using var staff = await Staff();
        var original = await Head(staff);
        await Save(staff, email: true, username: false);
        var before = await State();
        await Reject(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(Auth(true, true), S(original, "version"))), "version_conflict", customer);
        Assert.Equal(before, await State());
        // CAS takes precedence; the unreachable draft must not obscure a stale
        // writer or mutate history while checking the current proposal.
        await Reject(await Publish(staff, S(original, "version")), "version_conflict", customer);
        Assert.Equal(before, await State());
        await AssertCustomerLogin(customer.Name, customer.Id);
    }

    [Fact]
    public async Task InitialAuthSeedChecksContinuityBeforeWritingAnyPublishedDocumentOrHistory()
    {
        var customer = await Account(email: false, phoneVerified: true);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Revisions.Where(row => row.Key == "auth" && row.Locale == "fa").ExecuteDeleteAsync();
            await db.Documents.Where(row => row.Key == "auth" && row.Locale == "fa").ExecuteDeleteAsync();
        }
        var before = await State();
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            await using var transaction = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            cms.Database.SetDbConnection(identity.Database.GetDbConnection(), contextOwnsConnection: false);
            await cms.Database.UseTransactionAsync(transaction.GetDbTransaction());
            try {
                var failure = await Assert.ThrowsAsync<BusinessException>(() => scope.ServiceProvider.GetRequiredService<ContentService>()
                    .SeedAsync("auth", "fa", Auth(true, false), default));
                Assert.Equal(Conflict, failure.Code);
                AssertNoIdentity(failure.Message, customer);
                Assert.DoesNotContain(cms.ChangeTracker.Entries<ContentDocument>(), entry => entry.State == EntityState.Added);
                Assert.DoesNotContain(cms.ChangeTracker.Entries<ContentRevision>(), entry => entry.State == EntityState.Added);
                await transaction.RollbackAsync();
            }
            finally { await cms.Database.UseTransactionAsync(null); }
        }
        Assert.Equal(before, await State());

        // The ordinary first development seed still works without an ambient
        // Identity transaction when both existing password methods are enabled.
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<ContentService>().SeedAsync("auth", "fa", Auth(true, true), default);
        await AssertCustomerLogin(customer.Name, customer.Id);
    }

    [Fact]
    public async Task SingleMethodReadHoldsCustomerIdentityUntilTheRootSerializableTransactionEnds()
    {
        var customer = await Account(phoneVerified: true);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        AssertFixture(identity);
        var continuity = scope.ServiceProvider.GetRequiredService<ICustomerLoginContinuity>();
        await using var transaction = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await continuity.RequireAsync(emailEnabled: true, usernameEnabled: false, default);
        Assert.Same(transaction, identity.Database.CurrentTransaction);

        // A separate physical SQL connection is the contending Identity writer.
        // The server's finite lock timeout proves blocking without a sleep or a
        // scheduler-dependent Task.IsCompleted assertion.
        await using var writer = new SqlConnection(sql.Connection);
        await writer.OpenAsync();
        using var timeout = writer.CreateCommand();
        timeout.CommandText = "SET LOCK_TIMEOUT 1000";
        await timeout.ExecuteNonQueryAsync();
        using var write = writer.CreateCommand();
        write.CommandTimeout = 5;
        write.CommandText = "UPDATE [identity].[AspNetUsers] SET [Email]=NULL,[NormalizedEmail]=NULL WHERE [Id]=@id";
        write.Parameters.AddWithValue("@id", customer.Id);
        var failure = await Assert.ThrowsAsync<SqlException>(() => write.ExecuteNonQueryAsync());
        Assert.Equal(1222, failure.Number);
        Assert.Equal(customer.Email, await identity.Users.AsNoTracking().Where(user => user.Id == customer.Id).Select(user => user.Email).SingleAsync());
        await transaction.CommitAsync();
        Assert.Equal(1, await write.ExecuteNonQueryAsync());

        await using var nextScope = sql.Factory.Services.CreateAsyncScope();
        var next = nextScope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        await using var nextTransaction = await next.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var conflict = await Assert.ThrowsAsync<BusinessException>(() => nextScope.ServiceProvider.GetRequiredService<ICustomerLoginContinuity>()
            .RequireAsync(emailEnabled: true, usernameEnabled: false, default));
        Assert.Equal(Conflict, conflict.Code);
        AssertNoIdentity(conflict.Message, customer);
        await nextTransaction.RollbackAsync();
    }

    [Fact]
    public async Task OnlySingleMethodChecksRequireTheRootSerializableTransaction()
    {
        await Account(email: false, phoneVerified: true);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var continuity = scope.ServiceProvider.GetRequiredService<ICustomerLoginContinuity>();
        Assert.Null(identity.Database.CurrentTransaction);
        await continuity.RequireAsync(emailEnabled: true, usernameEnabled: true, default);
        await Assert.ThrowsAsync<InvalidOperationException>(() => continuity.RequireAsync(emailEnabled: true, usernameEnabled: false, default));
        await using var insufficient = await identity.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        await Assert.ThrowsAsync<InvalidOperationException>(() => continuity.RequireAsync(emailEnabled: false, usernameEnabled: true, default));
        await insufficient.RollbackAsync();
    }

    [Fact]
    public async Task ACustomerBeyondTheFirstFullPageCannotBeStrandedAndRemovingItsEligibilityAllowsTheSafePolicy()
    {
        var template = await Account();
        var prefix = "continuity-page-" + Id() + "-";
        var lastId = "zzzz-" + prefix + "last";
        var last = new AccountIdentity(lastId, prefix + "last", null, "09129999999");
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            AssertFixture(db);
            var normalizer = scope.ServiceProvider.GetRequiredService<ILookupNormalizer>();
            // Fixture setup alone reuses one synthetic valid password hash. The
            // production guard never materializes hashes, and no hash is logged.
            var fixtureHash = await db.Users.AsNoTracking().Where(user => user.Id == template.Id)
                .Select(user => user.PasswordHash).SingleAsync();
            Assert.NotNull(fixtureHash);
            for (var i = 0; i < 256; i++) {
                var name = prefix + i.ToString("D3", CultureInfo.InvariantCulture);
                var email = name + "@example.invalid";
                db.Users.Add(new ShopUser {
                    Id = name, UserName = name, NormalizedUserName = normalizer.NormalizeName(name),
                    Email = email, NormalizedEmail = normalizer.NormalizeEmail(email), EmailConfirmed = true,
                    DisplayName = "مشتری مصنوعی صفحه‌بندی", PasswordHash = fixtureHash,
                    SecurityStamp = Id(), ConcurrencyStamp = Id(), IsActive = true
                });
            }
            db.Users.Add(new ShopUser {
                Id = last.Id, UserName = last.Name, NormalizedUserName = normalizer.NormalizeName(last.Name),
                PhoneNumber = last.Phone, PhoneNumberConfirmed = true, DisplayName = "مشتری مصنوعی صفحهٔ دوم",
                PasswordHash = fixtureHash, SecurityStamp = Id(), ConcurrencyStamp = Id(), IsActive = true
            });
            await db.SaveChangesAsync();
            var own = db.Users.AsNoTracking().Where(user => user.Id.StartsWith(prefix) || user.Id == last.Id).OrderBy(user => user.Id);
            Assert.Equal(257, await own.CountAsync());
            Assert.DoesNotContain(last.Id, await own.Take(256).Select(user => user.Id).ToArrayAsync());
            Assert.Equal(last.Id, await own.Skip(256).Select(user => user.Id).SingleAsync());
        }
        await AssertCustomerLogin(last.Name, last.Id);
        using var staff = await Staff();
        await Save(staff, email: true, username: false);
        var head = await Head(staff);
        var before = await State();
        await Reject(await Publish(staff, S(head, "version")), Conflict, last);
        Assert.Equal(before, await State());
        await AssertCustomerLogin(last.Name, last.Id);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            Assert.Equal(1, await db.Users.Where(user => user.Id == last.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(user => user.IsActive, false)));
        }
        await NoContent(await Publish(staff, S(head, "version")));
        await AssertCustomerLogin(template.Email!, template.Id);
    }

    private sealed record AccountIdentity(string Id, string Name, string? Email, string? Phone);
    private async Task<AccountIdentity> Account(bool email = true, bool phoneVerified = false, string? name = null,
        bool active = true, bool hasPassword = true, string? role = null)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var staff = role is not null && ShopPermissions.Roles.ContainsKey(role);
        var user = new ShopUser {
            UserName = name ?? "continuity" + Id(), DisplayName = "مشتری مصنوعی حفاظت ورود",
            Email = email ? "contact" + Id() + "@example.invalid" : null, EmailConfirmed = email,
            PhoneNumber = !email || phoneVerified ? "0912" + (++nextPhone).ToString("D7", CultureInfo.InvariantCulture) : null,
            PhoneNumberConfirmed = phoneVerified, IsActive = active, RequireMfa = staff
        };
        Ensure(hasPassword ? await users.CreateAsync(user, sql.Password) : await users.CreateAsync(user));
        if (role is not null) {
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
            if (!await roles.RoleExistsAsync(role)) Ensure(await roles.CreateAsync(new(role)));
            Ensure(await users.AddToRoleAsync(user, role));
        }
        return new(user.Id, user.UserName!, user.Email, user.PhoneNumber);
    }

    private HttpClient CustomerClient()
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        return client;
    }

    private async Task<HttpClient> Staff(AccountIdentity? account = null)
    {
        account ??= await Account(role: "ContentManager");
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        try {
            var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Name, Password = sql.Password }));
            client.DefaultRequestHeaders.Authorization = new("Bearer", S(pending, "accessToken"));
            var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
            client.DefaultRequestHeaders.Authorization = new("Bearer", S(setup, "accessToken"));
            var signed = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new {
                Code = Totp.Code(S(setup, "secret"), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30)
            }));
            client.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken"));
            return client;
        }
        catch { client.Dispose(); throw; }
    }

    private async Task<HttpResponseMessage> Password(string identifier)
    {
        using var client = CustomerClient();
        return await client.PostAsJsonAsync("/api/auth/password", new { Identifier = identifier, Password = sql.Password });
    }

    private async Task AssertCustomerLogin(string identifier, string expectedUser)
    {
        var signed = await Json(await Password(identifier));
        Assert.False(signed["requiresMfa"]!.GetValue<bool>());
        var token = S(signed, "accessToken");
        Assert.Equal(expectedUser, new JwtSecurityTokenHandler().ReadJwtToken(token).Subject);
        using var client = CustomerClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var profile = await Json(await client.GetAsync("/api/account/profile"));
        Assert.Equal(expectedUser, S(profile, "id"));
    }

    private async Task Save(HttpClient staff, bool email, bool username)
    {
        var head = await Head(staff);
        await NoContent(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(Auth(email, username), S(head, "version"))));
    }

    private async Task Switch(HttpClient staff, bool email, bool username)
    {
        await Save(staff, email, username);
        var head = await Head(staff);
        await NoContent(await Publish(staff, S(head, "version")));
    }

    private static Task<HttpResponseMessage> Publish(HttpClient staff, string version, long? restore = null) =>
        staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { Version = version, RestoreRevisionId = restore?.ToString(CultureInfo.InvariantCulture) });

    private static async Task<JsonNode> Head(HttpClient staff) => (await Json(await staff.GetAsync("/api/admin/content")))["documents"]!
        .AsArray().Single(node => S(node!, "key") == "auth" && S(node!, "locale") == "fa")!;

    private static async Task<string> PublicAuth(HttpClient client, string locale) =>
        (await Json(await client.GetAsync("/api/storefront/" + locale + "?metadataOnly=true")))["authSettings"]!.ToJsonString();

    private async Task<long> LegacyRevision(JsonObject auth)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        var revision = new ContentRevision { Key = "auth", Locale = "fa", Revision = 1_000_000, Json = auth.ToJsonString(), PublishedBy = "synthetic-legacy-continuity" };
        db.Revisions.Add(revision); await db.SaveChangesAsync(); return revision.Id;
    }

    private sealed record DatabaseState(string Documents, string Revisions, string Audit);
    private async Task<DatabaseState> State()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        AssertFixture(identity);
        return new(
            JsonSerializer.Serialize(await cms.Documents.AsNoTracking().OrderBy(row => row.Key).ThenBy(row => row.Locale).ToArrayAsync()),
            JsonSerializer.Serialize(await cms.Revisions.AsNoTracking().OrderBy(row => row.Id).ToArrayAsync()),
            JsonSerializer.Serialize(await identity.Audit.AsNoTracking().OrderBy(row => row.Id).ToArrayAsync()));
    }

    private static JsonObject Auth(bool email, bool username) => new() {
        ["mobileOtp"] = false, ["emailPassword"] = email, ["usernamePassword"] = username,
        ["registration"] = false, ["passwordReset"] = false
    };

    private static async Task Reject(HttpResponseMessage response, string code, AccountIdentity account,
        HttpStatusCode status = HttpStatusCode.Conflict) => await Reject(response, code, [account], status);
    private static async Task Reject(HttpResponseMessage response, string code, AccountIdentity account, AccountIdentity shadow) =>
        await Reject(response, code, [account, shadow], HttpStatusCode.Conflict);
    private static async Task Reject(HttpResponseMessage response, string code, AccountIdentity[] accounts, HttpStatusCode status)
    {
        using (response) {
            var raw = await response.Content.ReadAsStringAsync();
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, S(JsonNode.Parse(raw)!, "title"));
            AssertNoIdentity(raw, accounts);
        }
    }
    private static void AssertNoIdentity(string value, params AccountIdentity[] accounts)
    {
        foreach (var account in accounts)
            foreach (var identifier in new[] { account.Id, account.Name, account.Email, account.Phone })
                if (identifier is not null) Assert.DoesNotContain(identifier, value, StringComparison.OrdinalIgnoreCase);
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response) {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        }
    }
    private static async Task NoContent(HttpResponseMessage response)
    {
        using (response) {
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Equal("", await response.Content.ReadAsStringAsync());
        }
    }
    private static void Ensure(IdentityResult result) => Assert.True(result.Succeeded, string.Join(";", result.Errors.Select(error => error.Code)));
    private static void AssertFixture(IdentityDbContext db) => Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
    private static string S(JsonNode value, string key) => value[key]!.GetValue<string>();
    private static string Id() => Guid.NewGuid().ToString("N");
}
