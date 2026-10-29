using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Market;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SqlTests;

namespace Shop.UiHarness;
internal static class UiHarnessProgram
{
    public static async Task Main()
    {
        if(Environment.GetEnvironmentVariable("SHOP_UI_VERIFY_PRIVATE_STORAGE")=="1"){await PrivateStorageVerifier.RunAsync();return;}
        var order2Qa = Environment.GetEnvironmentVariable("SHOP_UI_ORDER2_QA") == "1";
        if (order2Qa) Order2HarnessSeed.RequireFreshFlags();
        if (Environment.GetEnvironmentVariable("SHOP_UI_FINALIZE_CART34_RUN") is not null) { await Cart34PreservationRecovery.RunAsync(); return; }
        if (Environment.GetEnvironmentVariable("SHOP_UI_VERIFY_RESTORE") == "1") { await RestoreVerifier.RunAsync(); return; }
        if (Environment.GetEnvironmentVariable("SHOP_UI_VERIFY_CART34_RESTORE") == "1") { await Cart34RestoreVerifier.RunAsync(); return; }
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("This temporary harness uses Unix-only private file permissions.");
        var root = Environment.GetEnvironmentVariable("SHOP_UI_ROOT") ?? throw new InvalidOperationException("Use scripts/ui-cart-harness.py.");
        var supplied = Environment.GetEnvironmentVariable("SHOP_TEST_SQL_CONNECTION") ?? throw new InvalidOperationException("An isolated SQL test connection is required.");
        var resume = Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN");
        var offersQa = Environment.GetEnvironmentVariable("SHOP_UI_OFFERS_QA") == "1";
        if (offersQa && (Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA") != "1" || resume is not null)) throw new InvalidOperationException("Offer UI QA requires SHOP_UI_SOURCING_QA=1 and a fresh run; resume cannot seed offers or SKUs.");
        var supplyQa = Environment.GetEnvironmentVariable("SHOP_UI_SUPPLY_QA") == "1";
        if (supplyQa && (!offersQa || Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA") != "1" || resume is not null)) throw new InvalidOperationException("Supply UI QA requires SHOP_UI_OFFERS_QA=1, SHOP_UI_SOURCING_QA=1 and a fresh run; it cannot add identities to a resumed run.");
        var operationsQa = Environment.GetEnvironmentVariable("SHOP_UI_OPERATIONS_QA") == "1";
        var creditApplicationsQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_APPLICATIONS_QA")=="1";
        var creditRequirementsQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_REQUIREMENTS_QA")=="1";
        var creditOrderQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_ORDER_QA")=="1";
        var creditClearanceQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_CLEARANCE_QA")=="1";
        var creditReminderPolicyQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_REMINDER_POLICY_QA")=="1";
        if(creditReminderPolicyQa&&(!creditApplicationsQa||!creditRequirementsQa||!creditOrderQa||resume is not null))throw new InvalidOperationException("Automatic reminder UI QA requires fresh explicit credit order/application/requirements fixtures.");
        if(creditClearanceQa&&(!creditApplicationsQa||!creditRequirementsQa||!creditOrderQa||resume is not null))throw new InvalidOperationException("Credit clearance QA requires fresh explicit credit application/requirements/order fixtures only.");
        var creditQuoteQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_QUOTE_QA")=="1";
        var creditDocumentsQa=Environment.GetEnvironmentVariable("SHOP_UI_CREDIT_DOCUMENTS_QA")=="1";
        if(creditOrderQa&&(!creditQuoteQa||!creditApplicationsQa||!creditRequirementsQa||!operationsQa||creditDocumentsQa||resume is not null))throw new InvalidOperationException("Cheque order QA requires only fresh quote/applications/requirements/operations GUID prerequisites, without documents or resume.");
        if(creditQuoteQa&&(!creditApplicationsQa||!creditRequirementsQa||!operationsQa||creditDocumentsQa||resume is not null))throw new InvalidOperationException("Credit quote QA requires a fresh explicit applications/requirements/operations GUID without documents or resume.");
        if(creditDocumentsQa&&(!creditRequirementsQa||!creditApplicationsQa||!operationsQa||resume is not null))throw new InvalidOperationException("Credit documents QA requires a fresh requirements/applications/operations GUID and actual owned private storage.");
        if(creditRequirementsQa&&(!creditApplicationsQa||!operationsQa||resume is not null))throw new InvalidOperationException("Credit requirements QA requires a fresh credit applications/operations GUID and separate synthetic FinanceManager and CreditReviewer identities.");
        if(creditApplicationsQa&&(!operationsQa||resume is not null||Environment.GetEnvironmentVariables().Keys.Cast<string>().Any(k=>k.StartsWith("SHOP_UI_",StringComparison.Ordinal)&&k is not("SHOP_UI_ROOT"or"SHOP_UI_CREDIT_APPLICATIONS_QA"or"SHOP_UI_OPERATIONS_QA"or"SHOP_UI_CREDIT_REQUIREMENTS_QA"or"SHOP_UI_CREDIT_DOCUMENTS_QA"or"SHOP_UI_CREDIT_QUOTE_QA"or"SHOP_UI_CREDIT_ORDER_QA"or"SHOP_UI_CREDIT_CLEARANCE_QA"or"SHOP_UI_CREDIT_REMINDER_POLICY_QA")&&Environment.GetEnvironmentVariable(k)is{Length:>0})))throw new InvalidOperationException("Credit application QA requires only a fresh operations GUID with a generated CreditReviewer; no policies, other modes or resume.");
        var supportQa = Environment.GetEnvironmentVariable("SHOP_UI_SUPPORT_QA") == "1";
        var ticketFilesQa=Environment.GetEnvironmentVariable("SHOP_UI_TICKET_FILES_QA")=="1";
        PrivateStorageCredentials? privateStorage=creditDocumentsQa?PrivateStorageVerifier.ReadServices().Credentials:null;
        if(ticketFilesQa){
            if(!supportQa||!operationsQa||resume is not null||Environment.GetEnvironmentVariables().Keys.Cast<string>().Any(k=>k.StartsWith("SHOP_UI_",StringComparison.Ordinal)&&k is not("SHOP_UI_ROOT"or"SHOP_UI_TICKET_FILES_QA"or"SHOP_UI_SUPPORT_QA"or"SHOP_UI_OPERATIONS_QA")&&Environment.GetEnvironmentVariable(k)is{Length:>0}))throw new InvalidOperationException("Private ticket files QA requires only a fresh support/operations GUID and its actual owned S3/ClamAV services.");
            privateStorage=PrivateStorageVerifier.ReadServices().Credentials;
        }
        var supportContentQa=Environment.GetEnvironmentVariable("SHOP_UI_SUPPORT_CONTENT_QA")=="1";
        if(supportContentQa&&(!operationsQa||resume is not null||new[]{"SHOP_UI_SUPPORT_QA","SHOP_UI_PAYMENT_QA","SHOP_UI_FINANCE_QA","SHOP_UI_SHIPMENT_QA","SHOP_UI_SOURCING_QA","SHOP_UI_OFFERS_QA","SHOP_UI_SUPPLY_QA","SHOP_UI_ALLOCATION_QA","SHOP_UI_CART2_QA","SHOP_UI_ORDER2_QA","SHOP_UI_COMPARISON_QA","SHOP_UI_USED_QA","SHOP_UI_MARKET_ATTRIBUTES_QA","SHOP_UI_PRESERVE_CART34_ON_STOP","SHOP_UI_MFA_ENROLLMENT_QA"}.Any(f=>Environment.GetEnvironmentVariable(f)is not null)))throw new InvalidOperationException("Support content QA requires only a fresh operations GUID and generated ContentManager; no policies, other modes or resume.");
        if(supportQa&&(!operationsQa||resume is not null||new[]{"SHOP_UI_PAYMENT_QA","SHOP_UI_SHIPMENT_QA","SHOP_UI_SOURCING_QA","SHOP_UI_OFFERS_QA","SHOP_UI_SUPPLY_QA","SHOP_UI_ALLOCATION_QA","SHOP_UI_CART2_QA","SHOP_UI_ORDER2_QA","SHOP_UI_COMPARISON_QA","SHOP_UI_USED_QA","SHOP_UI_MARKET_ATTRIBUTES_QA","SHOP_UI_PRESERVE_CART34_ON_STOP","SHOP_UI_MFA_ENROLLMENT_QA"}.Any(f=>Environment.GetEnvironmentVariable(f)is not null)))throw new InvalidOperationException("Support UI QA requires only a fresh operations GUID with a generated SupportAgent; no resume, financial policies or other modes.");
        var shipmentQa=Environment.GetEnvironmentVariable("SHOP_UI_SHIPMENT_QA")=="1";
        var paymentQa=Environment.GetEnvironmentVariable("SHOP_UI_PAYMENT_QA")=="1";
        if(paymentQa&&(!operationsQa||resume is not null||new[]{"SHOP_UI_SHIPMENT_QA","SHOP_UI_SOURCING_QA","SHOP_UI_OFFERS_QA","SHOP_UI_SUPPLY_QA","SHOP_UI_ALLOCATION_QA","SHOP_UI_CART2_QA","SHOP_UI_ORDER2_QA","SHOP_UI_COMPARISON_QA","SHOP_UI_USED_QA","SHOP_UI_MARKET_ATTRIBUTES_QA","SHOP_UI_PRESERVE_CART34_ON_STOP","SHOP_UI_MFA_ENROLLMENT_QA"}.Any(f=>Environment.GetEnvironmentVariable(f)is not null)))throw new InvalidOperationException("Payment QA requires only a fresh operations GUID run without resume or other QA modes.");
        if(shipmentQa&&(!operationsQa||resume is not null||paymentQa||new[]{"SHOP_UI_SOURCING_QA","SHOP_UI_OFFERS_QA","SHOP_UI_SUPPLY_QA","SHOP_UI_ALLOCATION_QA","SHOP_UI_CART2_QA","SHOP_UI_ORDER2_QA","SHOP_UI_COMPARISON_QA","SHOP_UI_USED_QA","SHOP_UI_MARKET_ATTRIBUTES_QA","SHOP_UI_PRESERVE_CART34_ON_STOP","SHOP_UI_MFA_ENROLLMENT_QA"}.Any(f=>Environment.GetEnvironmentVariable(f) is not null)))throw new InvalidOperationException("Shipment QA requires only a fresh operations GUID run, no resume or other QA modes.");

        var allocationQa = Environment.GetEnvironmentVariable("SHOP_UI_ALLOCATION_QA") == "1";
        if (allocationQa && (!supplyQa || !offersQa || !operationsQa || Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA") != "1" || resume is not null)) throw new InvalidOperationException("Allocation UI QA requires fresh sourcing/offers/supply/operations flags and cannot seed a resumed run.");
        var cart2Qa = Environment.GetEnvironmentVariable("SHOP_UI_CART2_QA") == "1";
        if (cart2Qa && (!allocationQa || !supplyQa || !offersQa || !operationsQa || Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA") != "1" || resume is not null)) throw new InvalidOperationException("Cart2 UI QA requires fresh sourcing/offers/supply/operations/allocation flags and cannot seed a resumed run.");
        var preserveCart34 = Environment.GetEnvironmentVariable("SHOP_UI_PRESERVE_CART34_ON_STOP") == "1";
        if (preserveCart34 && (!cart2Qa || resume is not null)) throw new InvalidOperationException("Preservation is restricted to a fresh explicitly enabled Cart2 QA run.");
        var enrollmentQa = Environment.GetEnvironmentVariable("SHOP_UI_MFA_ENROLLMENT_QA") == "1";
        var comparisonQa = Environment.GetEnvironmentVariable("SHOP_UI_COMPARISON_QA") == "1";
        var usedQa=Environment.GetEnvironmentVariable("SHOP_UI_USED_QA")=="1";
        var marketAttributesQa=Environment.GetEnvironmentVariable("SHOP_UI_MARKET_ATTRIBUTES_QA")=="1";
        if(marketAttributesQa&&(!operationsQa||resume is not null||offersQa||supplyQa||allocationQa||cart2Qa||order2Qa||preserveCart34||enrollmentQa||comparisonQa||usedQa||Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA")!="1"))throw new InvalidOperationException("Typed market QA requires only fresh sourcing samples and operations identities.");
        if(usedQa&&(!operationsQa||resume is not null||offersQa||supplyQa||allocationQa||cart2Qa||order2Qa||preserveCart34||enrollmentQa||comparisonQa||Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA")=="1"))throw new InvalidOperationException("Used-device QA requires only fresh operations identities and its isolated samples.");
        if(comparisonQa&&(resume is not null||offersQa||supplyQa||allocationQa||cart2Qa||order2Qa||preserveCart34||enrollmentQa||Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA")=="1"))throw new InvalidOperationException("Comparison QA requires a fresh disposable run with no financial or sourcing prerequisites.");
        if (resume is not null && !Regex.IsMatch(resume, "^SaymanTest_Ui_[a-f0-9]{32}$")) throw new InvalidOperationException("Resume requires an exact disposable QA run name.");
        var settings = new SqlConnectionStringBuilder(supplied) { InitialCatalog = resume ?? "SaymanTest_Ui_" + Guid.NewGuid().ToString("N"), ConnectTimeout = 8 };
        if (settings.DataSource != "127.0.0.1,11433") throw new InvalidOperationException("UI QA requires loopback SQL.");
        var runDirectory = Path.Combine(root, "tmp", "ui-cart", settings.InitialCatalog);
        var enrollmentFile = Path.Combine(runDirectory, "enrollment.json");
        var inventoryFile = Path.Combine(runDirectory, "inventory.json");
        var allocationFile = Path.Combine(runDirectory, "allocation.json");
        var cart2File = Path.Combine(runDirectory, "cart2.json");
        var order2File = Path.Combine(runDirectory, "order2.json");
        QaCredentials? previous = null;
        if (resume is not null) {
            if (!Directory.Exists(runDirectory) || (File.GetAttributes(runDirectory) & FileAttributes.ReparsePoint) != 0 || (File.GetUnixFileMode(runDirectory) & (UnixFileMode)63) != 0) throw new InvalidOperationException("Resume requires its existing private QA directory.");
            previous = await ReadPrivateCredentials(Path.Combine(runDirectory, "customer.json"), "cartui");
            var keys = Path.Combine(runDirectory, "keys");
            if (!Directory.Exists(keys) || (File.GetAttributes(keys) & FileAttributes.ReparsePoint) != 0 || !Directory.EnumerateFiles(keys, "*.xml").Any() || Directory.EnumerateFileSystemEntries(keys).Any(p => (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0)) throw new InvalidOperationException("Resume requires the original QA key ring.");
        } else {
            if ((preserveCart34 || order2Qa) && (Directory.Exists(runDirectory) || File.Exists(runDirectory))) throw new InvalidOperationException("Preserved or Order2 QA requires a new owned GUID directory.");
            Directory.CreateDirectory(runDirectory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        var password = previous?.Password ?? "CartUi!" + Guid.NewGuid().ToString("N");
        // Program reads these settings during builder creation, before the factory's late app-configuration callback.
        Environment.SetEnvironmentVariable("Cors__Origins__0", "http://sayman-ui.localhost:3105");
        Environment.SetEnvironmentVariable("Cors__Origins__1", "http://sayman-admin-ui.localhost:3175");
        Environment.SetEnvironmentVariable("Cors__Origins__2", "http://sayman-orders-ui.localhost:3105");
        Environment.SetEnvironmentVariable("Cors__Origins__3", "http://sayman-orders-admin-ui.localhost:3175");
        Environment.SetEnvironmentVariable("Cors__AdminOrigins__0", "http://sayman-admin-ui.localhost:3175");
        Environment.SetEnvironmentVariable("Cors__AdminOrigins__1", "http://sayman-orders-admin-ui.localhost:3175");
        Environment.SetEnvironmentVariable("DataProtection__KeyDirectory", Path.Combine(runDirectory, "keys"));
        var factory = new SqlFactory(settings.ConnectionString, password, Path.Combine(runDirectory, "keys")).WithWebHostBuilder(builder => builder.UseContentRoot(Path.Combine(root, "backend/src/Shop.Api")).ConfigureAppConfiguration((_, configuration) => {
            configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Cors:Origins:0"] = "http://sayman-ui.localhost:3105", ["Credit:AutomaticRemindersEnabled"] = creditReminderPolicyQa?"true":"false" });
            if(privateStorage is not null)configuration.AddInMemoryCollection(PrivateStorageVerifier.Configuration(privateStorage));
        }));
        factory.UseKestrel(server => server.Listen(IPAddress.Loopback, 5181));
        using var credentialStop = new CancellationTokenSource(); Task? credentialTask = null; Task? inventoryCredentialTask = null; Task? requirementsCredentialTask = null; Task? ordersCredentialTask = null; var ready = false;
        try {
            await using (var scope = factory.Services.CreateAsyncScope()) {
                var services = scope.ServiceProvider;
                var contexts = new[] { typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext), typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext), typeof(MarketDbContext), typeof(Shop.Modules.Reviews.ReviewsDbContext), typeof(Shop.Modules.Support.SupportDbContext),typeof(Shop.Modules.Notifications.NotificationsDbContext),typeof(Shop.Modules.Files.FilesDbContext) };
                var file = Path.Combine(runDirectory, "customer.json");
                var users = services.GetRequiredService<UserManager<ShopUser>>();
                if (resume is not null) {
                    foreach (var type in contexts) {
                        var db = (DbContext)services.GetRequiredService(type);
                        if (!await db.Database.CanConnectAsync() || (await db.Database.GetPendingMigrationsAsync()).Any()) throw new InvalidOperationException("Resume will not create or migrate a QA database.");
                    }
                    var user = await users.FindByNameAsync(previous!.Username);
                    if (user is null || user.RequireMfa || user.TwoFactorEnabled || !user.IsActive || !await users.CheckPasswordAsync(user, previous.Password)) throw new InvalidOperationException("Existing generated customer could not be verified.");
                    var financeFile = Path.Combine(runDirectory, "finance.json");
                    if (File.Exists(financeFile)) {
                        var staffCredentials = await ReadPrivateCredentials(financeFile, "financeui");
                        var staff = await users.FindByNameAsync(staffCredentials.Username);
                        if (staff is null || !staff.IsActive || !staff.RequireMfa || !staff.TwoFactorEnabled || !await users.CheckPasswordAsync(staff, staffCredentials.Password)) throw new InvalidOperationException("Existing generated QA staff/MFA could not be verified.");
                        var secret = await users.GetAuthenticatorKeyAsync(staff) ?? throw new InvalidOperationException("Existing QA authenticator could not be read.");
                        await WriteFinanceCredentials(financeFile, staff.UserName!, staffCredentials.Password, secret);
                        credentialTask = UpdateFinanceCredentials(financeFile, staff.UserName!, staffCredentials.Password, secret, credentialStop.Token);
                    }
                    if (File.Exists(inventoryFile)) {
                        var inventoryCredentials = await ReadPrivateCredentials(inventoryFile, "inventoryui");
                        var inventory = await users.FindByNameAsync(inventoryCredentials.Username);
                        if (inventory is null || !inventory.IsActive || !inventory.RequireMfa || !inventory.TwoFactorEnabled || !await users.CheckPasswordAsync(inventory, inventoryCredentials.Password) || !(await users.GetRolesAsync(inventory)).SequenceEqual(["InventoryManager"]) || ShopPermissions.Roles["InventoryManager"].Contains("sales.read", StringComparer.Ordinal)) throw new InvalidOperationException("Existing generated inventory-only QA identity could not be verified.");
                        var secret = await users.GetAuthenticatorKeyAsync(inventory) ?? throw new InvalidOperationException("Existing generated inventory QA authenticator could not be read.");
                        await WriteFinanceCredentials(inventoryFile, inventory.UserName!, inventoryCredentials.Password, secret);
                        inventoryCredentialTask = UpdateFinanceCredentials(inventoryFile, inventory.UserName!, inventoryCredentials.Password, secret, credentialStop.Token);
                    }
                    if (enrollmentQa && !File.Exists(enrollmentFile)) throw new InvalidOperationException("Resume cannot add an enrollment identity to an existing QA run.");
                    if (File.Exists(enrollmentFile)) {
                        var enrollmentCredentials = await ReadPrivateCredentials(enrollmentFile, "enrollui");
                        var enrollment = await users.FindByNameAsync(enrollmentCredentials.Username);
                        if (enrollment is null || !enrollment.IsActive || !enrollment.RequireMfa || !await users.CheckPasswordAsync(enrollment, enrollmentCredentials.Password) || !(await users.GetRolesAsync(enrollment)).SequenceEqual(["CatalogManager"])) throw new InvalidOperationException("Existing generated enrollment QA identity could not be verified.");
                        // Enrollment may have completed through the browser. Never reset it,
                        // read its authenticator key or create a replacement on resume.
                    }
                    Console.WriteLine("Resumed only the existing generated QA identities; roles, MFA enrollment, policies and CMS publication were not changed.");
                } else {
                foreach (var type in contexts) await ((DbContext)services.GetRequiredService(type)).Database.MigrateAsync();
                if(ticketFilesQa||creditDocumentsQa){
                    if(services.GetRequiredService<Shop.Modules.Files.IPrivateFileStore>()is not Shop.Modules.Files.S3PrivateFileStore||services.GetRequiredService<Shop.Modules.Files.IPrivateFileScanner>()is not Shop.Modules.Files.ClamAvPrivateFileScanner)throw new InvalidOperationException("Private browser QA must use actual storage and scanner adapters.");
                    var documents=new List<object>();
                    foreach(var actor in creditDocumentsQa?new[]{"customer","replacement"}:new[]{"customer","staff"}){
                        var bytes=PrivateStorageVerifier.Document("Synthetic "+actor+" private attachment. No personal data.");
                        var path=Path.Combine(runDirectory,actor+"-synthetic.pdf");
                        await File.WriteAllBytesAsync(path,bytes);File.SetUnixFileMode(path,UnixFileMode.UserRead|UnixFileMode.UserWrite);
                        documents.Add(new{actor,path,bytes=bytes.Length,sha256=Shop.Modules.Files.PrivateFileRules.Hash(bytes),contentType="application/pdf"});
                    }
                    var metadata=Path.Combine(runDirectory,"private-files.json");await File.WriteAllTextAsync(metadata,JsonSerializer.Serialize(new{syntheticQaOnly=true,actualS3AndClamAv=true,documents}));File.SetUnixFileMode(metadata,UnixFileMode.UserRead|UnixFileMode.UserWrite);
                }
                await DevelopmentSeed.RunAsync(services, services.GetRequiredService<IConfiguration>(), Path.Combine(root, "backend/src/Shop.Api"));
                if (Environment.GetEnvironmentVariable("SHOP_UI_SOURCING_QA") == "1") {
                    // This branch can only run for this harness's fresh GUID-only database.
                    // Samples remain explicitly marked and unavailable outside Development.
                    var sampleResult = await DevelopmentMarketSeed.RunAsync(services, services.GetRequiredService<IWebHostEnvironment>(), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { SourcingQaSamples = sampleResult }));
                    if (offersQa) Console.WriteLine(JsonSerializer.Serialize(new { OfferQaSamples = await OfferHarnessSeed.RunAsync(services, services.GetRequiredService<IWebHostEnvironment>(), settings.InitialCatalog, CancellationToken.None) }));
                }
                var name = "cartui" + Guid.NewGuid().ToString("N");
                var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, DisplayName = "Cart UI QA" };
                var result = await users.CreateAsync(user, password); if (!result.Succeeded) throw new InvalidOperationException("The isolated UI customer could not be created.");
                await WritePrivateCredentials(file, name, password);
                if(Environment.GetEnvironmentVariable("SHOP_UI_WISHLIST_QA")=="1"){
                    if(resume is not null||!Regex.IsMatch(settings.InitialCatalog,"^SaymanTest_Ui_[a-f0-9]{32}$")||await services.GetRequiredService<SalesDbContext>().WishlistHeads.AnyAsync())throw new InvalidOperationException("Wishlist QA requires a fresh empty disposable run.");
                    var otherName="cartui"+Guid.NewGuid().ToString("N");var otherPassword="WishlistQa!"+Guid.NewGuid().ToString("N");var other=new ShopUser{UserName=otherName,Email=otherName+"@example.test",EmailConfirmed=true,DisplayName="Wishlist UI QA other"};if(!(await users.CreateAsync(other,otherPassword)).Succeeded)throw new InvalidOperationException("Temporary wishlist customer could not be created.");await WritePrivateCredentials(Path.Combine(runDirectory,"wishlist-other.json"),otherName,otherPassword);
                }
                AllocationHarnessSeed.QaIdentity? generatedStaff = null;
                AllocationHarnessSeed.QaIdentity? generatedInventory = null;
                if (operationsQa || Environment.GetEnvironmentVariable("SHOP_UI_FINANCE_QA") == "1") {
                    var finance = new ShopUser { UserName = "financeui" + Guid.NewGuid().ToString("N"), EmailConfirmed = true, Email = "finance-" + Guid.NewGuid().ToString("N") + "@example.test", DisplayName = creditApplicationsQa ? "بررسی‌کنندهٔ آزمایشی پروندهٔ چک" : supportContentQa ? "ویراستار آزمایشی موقت" : supportQa ? "پشتیبان آزمایشی موقت" : operationsQa ? "عملیات آزمایشی موقت" : "مالی آزمایشی موقت", RequireMfa = true };
                    if (!(await users.CreateAsync(finance, password)).Succeeded || !(await users.AddToRoleAsync(finance, creditApplicationsQa ? "CreditReviewer" : supportContentQa ? "ContentManager" : supportQa ? "SupportAgent" : operationsQa ? "Administrator" : "FinanceManager")).Succeeded || !(await users.ResetAuthenticatorKeyAsync(finance)).Succeeded || !(await users.SetTwoFactorEnabledAsync(finance, true)).Succeeded) throw new InvalidOperationException("Temporary finance identity setup failed.");
                    var secret = await users.GetAuthenticatorKeyAsync(finance) ?? throw new InvalidOperationException("Temporary authenticator is missing.");
                    var financeFile = Path.Combine(runDirectory, "finance.json"); await WriteFinanceCredentials(financeFile, finance.UserName!, password, secret);
                    credentialTask = UpdateFinanceCredentials(financeFile, finance.UserName!, password, secret, credentialStop.Token);
                    if(creditRequirementsQa){
                        var policyName="requirementsui"+Guid.NewGuid().ToString("N");var policyPassword="RequirementsUi!"+Guid.NewGuid().ToString("N");
                        var policyUser=new ShopUser{UserName=policyName,Email=policyName+"@example.test",EmailConfirmed=true,DisplayName="مدیر شرایط ساختگی آزمون",RequireMfa=true};
                        if(!(await users.CreateAsync(policyUser,policyPassword)).Succeeded||!(await users.AddToRoleAsync(policyUser,"FinanceManager")).Succeeded||!(await users.GetRolesAsync(policyUser)).SequenceEqual(["FinanceManager"])||!(await users.ResetAuthenticatorKeyAsync(policyUser)).Succeeded||!(await users.SetTwoFactorEnabledAsync(policyUser,true)).Succeeded)throw new InvalidOperationException("Isolated requirements-only financial manager setup failed.");
                        var policySecret=await users.GetAuthenticatorKeyAsync(policyUser)??throw new InvalidOperationException("No generated requirements MFA key.");var policyFile=Path.Combine(runDirectory,"requirements.json");await WriteFinanceCredentials(policyFile,policyName,policyPassword,policySecret);requirementsCredentialTask=UpdateFinanceCredentials(policyFile,policyName,policyPassword,policySecret,credentialStop.Token);
                    }

                    if(creditOrderQa){
                        var orderName="ordersui"+Guid.NewGuid().ToString("N");var orderPassword="OrdersUi!"+Guid.NewGuid().ToString("N");
                        var orderUser=new ShopUser{UserName=orderName,Email=orderName+"@example.test",EmailConfirmed=true,DisplayName="مدیر فروش ساختگی آزمون",RequireMfa=true};
                        if(!(await users.CreateAsync(orderUser,orderPassword)).Succeeded||!(await users.AddToRoleAsync(orderUser,"SalesManager")).Succeeded||!(await users.GetRolesAsync(orderUser)).SequenceEqual(["SalesManager"])||!(await users.ResetAuthenticatorKeyAsync(orderUser)).Succeeded||!(await users.SetTwoFactorEnabledAsync(orderUser,true)).Succeeded)throw new InvalidOperationException("Isolated sales-only manager setup failed.");
                        if(creditClearanceQa){if(!(await users.AddToRoleAsync(orderUser,"InventoryManager")).Succeeded||!(await users.GetRolesAsync(orderUser)).OrderBy(x=>x,StringComparer.Ordinal).SequenceEqual(new[]{"InventoryManager","SalesManager"}))throw new InvalidOperationException("Fresh synthetic warehouse must have only the existing SalesManager and InventoryManager roles.");}
                        var orderSecret=await users.GetAuthenticatorKeyAsync(orderUser)??throw new InvalidOperationException("No generated orders MFA key.");var orderFile=Path.Combine(runDirectory,"orders.json");await WriteFinanceCredentials(orderFile,orderName,orderPassword,orderSecret);ordersCredentialTask=UpdateFinanceCredentials(orderFile,orderName,orderPassword,orderSecret,credentialStop.Token);
                    }

                    generatedStaff = new(finance.Id, finance.UserName!, password);
                    Console.WriteLine("Temporary staff QA uses its generated private finance.json; the owner's identity is never used.");
                }
                if (supplyQa) {
                    if (services.GetRequiredService<IWebHostEnvironment>().EnvironmentName != "Development" || !Regex.IsMatch(settings.InitialCatalog, "^SaymanTest_Ui_[a-f0-9]{32}$") || ShopPermissions.Roles["InventoryManager"].Contains("sales.read", StringComparer.Ordinal)) throw new InvalidOperationException("Supply QA requires an isolated Development database and the inventory-only role.");
                    var inventoryName = "inventoryui" + Guid.NewGuid().ToString("N");
                    var inventoryPassword = "SupplyUi!" + Guid.NewGuid().ToString("N");
                    var inventory = new ShopUser { UserName = inventoryName, EmailConfirmed = true, Email = inventoryName + "@example.test", DisplayName = "انبار آزمایشی موقت", RequireMfa = true };
                    if (!(await users.CreateAsync(inventory, inventoryPassword)).Succeeded || !(await users.AddToRoleAsync(inventory, "InventoryManager")).Succeeded || !(await users.GetRolesAsync(inventory)).SequenceEqual(["InventoryManager"]) || !(await users.ResetAuthenticatorKeyAsync(inventory)).Succeeded || !(await users.SetTwoFactorEnabledAsync(inventory, true)).Succeeded) throw new InvalidOperationException("Temporary inventory-only QA identity setup failed.");
                    var secret = await users.GetAuthenticatorKeyAsync(inventory) ?? throw new InvalidOperationException("Temporary inventory QA authenticator is missing.");
                    await WriteFinanceCredentials(inventoryFile, inventoryName, inventoryPassword, secret);
                    inventoryCredentialTask = UpdateFinanceCredentials(inventoryFile, inventoryName, inventoryPassword, secret, credentialStop.Token);
                    generatedInventory = new(inventory.Id, inventoryName, inventoryPassword);
                    // Only the generated identity is added. The browser must
                    // create consent, mappings and receipts unless the separate
                    // allocation-prerequisite flag explicitly prepares HTTP QA.
                    Console.WriteLine(allocationQa ? "Supply flag added its generated InventoryManager in private inventory.json; explicit allocation QA will prepare labeled actual-HTTP prerequisites, not browser proof." : "Supply flag added only its generated InventoryManager identity in private inventory.json; consent, unit mappings and actual receiving must be exercised through the browser.");
                }
                if (allocationQa) {
                    var prerequisites = await AllocationHarnessSeed.RunAsync(() => factory.CreateClient(new() { HandleCookies = false, BaseAddress = new Uri("http://127.0.0.1:5181") }), services, services.GetRequiredService<IWebHostEnvironment>(), settings.InitialCatalog, runDirectory, new(user.Id, name, password), generatedStaff ?? throw new InvalidOperationException("The generated operations QA identity is required."), generatedInventory ?? throw new InvalidOperationException("The generated inventory QA identity is required."), CancellationToken.None);
                    Console.WriteLine(JsonSerializer.Serialize(new { AllocationQaPrerequisite = prerequisites }));
                    if (cart2Qa) {
                        var cart2Prerequisites = await Cart2HarnessSeed.RunAsync(() => factory.CreateClient(new() { HandleCookies = false, BaseAddress = new Uri("http://127.0.0.1:5181") }), services, services.GetRequiredService<IWebHostEnvironment>(), settings.InitialCatalog, runDirectory, prerequisites, new(user.Id, name, password), generatedInventory ?? throw new InvalidOperationException("The generated inventory QA identity is required."), CancellationToken.None);
                        Console.WriteLine(JsonSerializer.Serialize(new { Cart2QaPrerequisite = cart2Prerequisites }));
                        if (order2Qa) {
                            await Order2HarnessSeed.RunAsync(services, services.GetRequiredService<IWebHostEnvironment>(), settings.InitialCatalog, runDirectory, cart2Prerequisites, CancellationToken.None);
                            Console.WriteLine("Order2 QA added only its D21 policies and private synthetic form metadata after Cart2's empty-purchase assertion; the browser must create Quote5 and Order2.");
                        }
                    }
                }
                if (enrollmentQa) {
                    var enrollmentName = "enrollui" + Guid.NewGuid().ToString("N");
                    var enrollmentPassword = "EnrollUi!" + Guid.NewGuid().ToString("N");
                    var enrollment = new ShopUser { UserName = enrollmentName, EmailConfirmed = true, Email = enrollmentName + "@example.test", DisplayName = "آزمون ثبت Authenticator", RequireMfa = true };
                    if (!(await users.CreateAsync(enrollment, enrollmentPassword)).Succeeded || !(await users.AddToRoleAsync(enrollment, "CatalogManager")).Succeeded || enrollment.TwoFactorEnabled) throw new InvalidOperationException("Temporary unenrolled staff identity setup failed.");
                    await WritePrivateCredentials(enrollmentFile, enrollmentName, enrollmentPassword);
                    Console.WriteLine("Optional browser enrollment QA uses its generated private enrollment.json; no authenticator key has been created or read for it.");
                }
                if(shipmentQa)await ShipmentHarnessSeed.RunAsync(()=>factory.CreateClient(new(){HandleCookies=false,BaseAddress=new Uri("http://127.0.0.1:5181")}),services,settings.InitialCatalog,runDirectory,new(user.Id,name,password),generatedStaff??throw new InvalidOperationException("Generated staff required."));
                if(paymentQa)await PaymentHarnessSeed.RunAsync(()=>factory.CreateClient(new(){HandleCookies=false,BaseAddress=new Uri("http://127.0.0.1:5181")}),services,settings.InitialCatalog,runDirectory,new(user.Id,name,password));
                }
                if(comparisonQa)await ComparisonHarnessSeed.RunAsync(services,settings.InitialCatalog,runDirectory);
                if(usedQa)await UsedItemHarnessSeed.RunAsync(services,settings.InitialCatalog,runDirectory);
                if(marketAttributesQa)await MarketAttributeHarnessSeed.RunAsync(services,settings.InitialCatalog,runDirectory);
                if (preserveCart34) await Cart2Preservation.WriteAsync(root, runDirectory, settings.InitialCatalog, "running");
                if(creditQuoteQa)await CreditQuoteHarnessSeed.RunAsync(services,settings.InitialCatalog,runDirectory);
                if(creditOrderQa)await CreditOrderHarnessSeed.RunAsync(services,settings.InitialCatalog,runDirectory);
                ready = true;
                if (order2Qa) Console.WriteLine(JsonSerializer.Serialize(new { Ready = true, Api = "http://127.0.0.1:5181", CustomerFile = file, EnrollmentFile = File.Exists(enrollmentFile) ? enrollmentFile : null, InventoryFile = File.Exists(inventoryFile) ? inventoryFile : null, AllocationFile = File.Exists(allocationFile) ? allocationFile : null, Cart2File = File.Exists(cart2File) ? cart2File : null, Order2File = File.Exists(order2File) ? order2File : null, Order2Qa = true, Database = settings.InitialCatalog }));
                else if (cart2Qa) Console.WriteLine(JsonSerializer.Serialize(new { Ready = true, Api = "http://127.0.0.1:5181", CustomerFile = file, EnrollmentFile = File.Exists(enrollmentFile) ? enrollmentFile : null, InventoryFile = File.Exists(inventoryFile) ? inventoryFile : null, AllocationFile = File.Exists(allocationFile) ? allocationFile : null, Cart2File = File.Exists(cart2File) ? cart2File : null, Database = settings.InitialCatalog }));
                else Console.WriteLine(JsonSerializer.Serialize(new { Ready = true, Api = "http://127.0.0.1:5181", CustomerFile = file, EnrollmentFile = File.Exists(enrollmentFile) ? enrollmentFile : null, InventoryFile = File.Exists(inventoryFile) ? inventoryFile : null, AllocationFile = File.Exists(allocationFile) ? allocationFile : null, Database = settings.InitialCatalog }));
            }
            var stopping = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stopping.TrySetResult(); };
            using var term = System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGTERM, context => { context.Cancel = true; stopping.TrySetResult(); });
            await stopping.Task;
        }
        finally {
            await credentialStop.CancelAsync(); foreach (var writer in new[] { credentialTask, inventoryCredentialTask, requirementsCredentialTask, ordersCredentialTask }.OfType<Task>()) { try { await writer; } catch (OperationCanceledException) { } catch (Exception e) when (e is not OutOfMemoryException) { Console.WriteLine("Temporary credential writer stopped after " + e.GetType().Name); } }
            await factory.DisposeAsync();
            if (!settings.InitialCatalog.StartsWith("SaymanTest_Ui_", StringComparison.Ordinal)) throw new InvalidOperationException("Refusing cleanup outside the isolated UI database.");
            if (preserveCart34 && ready) {
                await Cart2Preservation.WriteAsync(root, runDirectory, settings.InitialCatalog, "stopped-preserved");
                Console.WriteLine("Owned Cart2 QA API stopped; its database, generated credentials and key ring were deliberately preserved for schema34 restore rehearsal. Explicit owned-source cleanup is still required.");
            } else if (resume is null || ready) {
                await using var cleanup = new SalesDbContext(new DbContextOptionsBuilder<SalesDbContext>().UseSqlServer(settings.ConnectionString).Options); await cleanup.Database.EnsureDeletedAsync();
                Directory.Delete(runDirectory, true); Console.WriteLine("Isolated UI database and generated credentials removed.");
            } else Console.WriteLine("Resume failed before readiness; its existing QA database and private files were preserved.");
        }
    }
    private sealed record QaCredentials(string Username, string Password);
    private static Task WritePrivateCredentials(string file, string name, string password) => WritePrivate(file, new QaCredentials(name, password));
    internal static async Task WritePrivate<T>(string file, T value, CancellationToken ct = default)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Temporary QA files require Unix file permissions.");
        await using var stream = new FileStream(file, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite });
        await JsonSerializer.SerializeAsync(stream, value, cancellationToken: ct);
    }
    private static async Task<QaCredentials> ReadPrivateCredentials(string path, string prefix)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!File.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0 || (File.GetUnixFileMode(path) & (UnixFileMode)63) != 0) throw new InvalidOperationException("Resume requires its existing private generated credential file.");
        var value = JsonSerializer.Deserialize<QaCredentials>(await File.ReadAllTextAsync(path));
        if (value is null || value.Username is null || value.Password is not { Length: >= 32 } || !Regex.IsMatch(value.Username, "^" + prefix + "[a-f0-9]{32}$")) throw new InvalidOperationException("Resume accepts only generated QA identities.");
        return value;
    }
    private static async Task WriteFinanceCredentials(string file, string name, string password, string secret)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Temporary credentials require Unix file permissions.");
        var bytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Username = name, Password = password, Code = Totp.Code(secret, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }));
        var next = file + ".new"; await using (var stream = new FileStream(next, new FileStreamOptions { Mode = FileMode.Create, Access = FileAccess.Write, Share = FileShare.None, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite })) await stream.WriteAsync(bytes);
        File.Move(next, file, overwrite: true);
    }
    private static async Task UpdateFinanceCredentials(string file, string name, string password, string secret, CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5)); while (await timer.WaitForNextTickAsync(ct)) await WriteFinanceCredentials(file, name, password, secret);
    }
}
