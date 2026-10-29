using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Market;
using Shop.Modules.Reviews;
using Shop.Modules.Support;
using Shop.Modules.Notifications;
using Shop.Modules.Files;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.Modules.Payments;
using Shop.SharedKernel;
using System.Security.Cryptography.X509Certificates;
using IdentityDbContext = Shop.Modules.Identity.IdentityDbContext;

if (args.Contains("--health-probe")) {
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    try { Environment.ExitCode = (await client.GetAsync(Environment.GetEnvironmentVariable("HealthProbeUrl") ?? "http://127.0.0.1:8080/health/ready")).IsSuccessStatusCode ? 0 : 1; }
    catch (HttpRequestException) { Environment.ExitCode = 1; }
    catch (TaskCanceledException) { Environment.ExitCode = 1; }
    return;
}
var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog((context, config) => config.ReadFrom.Configuration(context.Configuration).WriteTo.Console());
AuthConfiguration AuthConfigurationValue()
{
    var key = builder.Configuration["Auth:SigningKey"] ?? throw new InvalidOperationException("Auth__SigningKey is required.");
    if (Encoding.UTF8.GetByteCount(key) < 64) throw new InvalidOperationException("Use a random signing key of at least 64 bytes.");
    return new(key, builder.Configuration["Auth:Issuer"] ?? "sayman-api", builder.Configuration["Auth:Audience"] ?? "sayman-clients");
}
builder.Services.AddSingleton(_ => AuthConfigurationValue());
void SqlOptions(DbContextOptionsBuilder options, string schema) => options.UseSqlServer(builder.Configuration.GetConnectionString("Shop") ?? throw new InvalidOperationException("ConnectionStrings__Shop is required."), sql => sql.MigrationsAssembly(typeof(Program).Assembly.FullName).MigrationsHistoryTable("__EFMigrationsHistory", schema));
builder.Services.AddDbContext<CatalogDbContext>(o => SqlOptions(o, "catalog"));
builder.Services.AddDbContext<InventoryDbContext>(o => SqlOptions(o, "inventory"));
builder.Services.AddDbContext<SalesDbContext>(o => SqlOptions(o, "sales"));
builder.Services.AddDbContext<PaymentsDbContext>(o => SqlOptions(o, "payments"));
builder.Services.AddDbContext<CreditDbContext>(o => SqlOptions(o, "credit"));
builder.Services.AddDbContext<CmsDbContext>(o => SqlOptions(o, "cms"));
builder.Services.AddDbContext<IdentityDbContext>(o => SqlOptions(o, "identity"));
builder.Services.AddDbContext<MarketDbContext>(o => SqlOptions(o, "market"));
builder.Services.AddDbContext<ReviewsDbContext>(o => SqlOptions(o, "reviews"));
builder.Services.AddSignalR(options=>{options.EnableDetailedErrors=false;options.MaximumReceiveMessageSize=4096;options.MaximumParallelInvocationsPerClient=1;options.SupportedProtocols=["json"];options.DisableImplicitFromServicesParameters=true;});
builder.Services.AddSingleton<PrivateRealtimeCodec>();builder.Services.AddScoped<PrivateRealtimeQueue>();builder.Services.AddScoped<IPrivateRealtimeEvents>(s=>s.GetRequiredService<PrivateRealtimeQueue>());builder.Services.AddSingleton<IPrivateRealtimeDispatcher,SignalRPrivateRealtimeDispatcher>();
builder.Services.AddDbContext<SupportDbContext>(o => SqlOptions(o, "support"));
builder.Services.AddDbContext<NotificationsDbContext>(o=>SqlOptions(o,"notifications"));
builder.Services.AddDbContext<FilesDbContext>(o=>SqlOptions(o,"files"));
builder.AddPrivateFiles();
builder.Services.AddScoped<TicketAttachmentCoordinator>();builder.Services.AddSingleton<PrivateFileReadSlots>();builder.Services.AddSingleton<PrivateFileDownloadSlots>();
builder.Services.AddScoped<IPrivateNotificationWriter,PrivateNotificationWriter>();
builder.Services.AddScoped<PrivateInboxService>();
builder.Services.AddScoped<ITicketProtection, DataProtectionTicketProtection>();
builder.Services.AddSingleton(new TicketOptions(builder.Configuration.GetValue<int?>("Support:MaxOpenPerOwner") ?? 20));
builder.Services.AddScoped<TicketService>();
builder.Services.AddScoped<IReviewProductReader,ReviewProductReader>();
builder.Services.AddScoped<IReviewPurchaseReader,ReviewPurchaseReader>();
builder.Services.AddScoped<ReviewService>();
builder.Services.AddScoped<UsedItemConditions>();
builder.Services.AddScoped<IUsedItemStockPolicy,UsedItemStockPolicy>();
builder.Services.AddIdentityCore<ShopUser>(o => {
    o.Password.RequiredLength = 12; o.Password.RequireDigit = true; o.Password.RequireUppercase = true; o.Password.RequireLowercase = true; o.Password.RequireNonAlphanumeric = true;
    // Username-only staff accounts need no fabricated email. The validator and
    // existing filtered SQL unique index retain uniqueness when email is present.
    o.User.RequireUniqueEmail = false; o.Lockout.MaxFailedAccessAttempts = 5; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    o.Tokens.AuthenticatorTokenProvider = TokenOptions.DefaultAuthenticatorProvider;
}).AddRoles<IdentityRole>().AddEntityFrameworkStores<IdentityDbContext>().AddDefaultTokenProviders().AddUserValidator<OptionalIdentityEmailValidator>();
builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = AuthService.PasswordHashIterations);
builder.Services.AddScoped<IUserStore<ShopUser>, ProtectedUserStore>();
var keyDirectory = builder.Configuration["DataProtection:KeyDirectory"] ?? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "../../../tmp/identity-keys"));
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("Sayman.Identity").PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
var certificatePath = builder.Configuration["DataProtection:CertificatePath"];
if (certificatePath is not null) dataProtection.ProtectKeysWithCertificate(X509CertificateLoader.LoadPkcs12FromFile(certificatePath, builder.Configuration["DataProtection:CertificatePassword"]));
if (builder.Environment.IsProduction() && (certificatePath is null || builder.Configuration["DataProtection:KeyDirectory"] is null)) throw new InvalidOperationException("Production identity requires a persistent key directory and a key encryption certificate.");
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<IMfaRecovery, MfaRecoveryService>();
builder.Services.AddScoped<IStaffAdministration, StaffAdministration>();
builder.Services.AddScoped<IStaffProvisioning, StaffProvisioningService>();
builder.Services.AddScoped<ICustomerDirectory, CustomerDirectory>();
builder.Services.AddScoped<ICustomerOrderOverview>(sp => new CustomerOrderOverviewReader(sp.GetRequiredService<SalesDbContext>(), sp.GetRequiredService<TimeProvider>(), builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ICustomerSupportOverview, CustomerSupportOverviewReader>();
builder.Services.AddScoped<IStaffProvisioningProtection, StaffProvisioningProtection>();
builder.Services.AddScoped<IAddressProtection, DataProtectionAddressProtection>(); builder.Services.AddScoped<IAddressBook, AddressBookService>();
builder.Services.AddScoped<IAdminPurchaseMethods, AdminPurchaseMethods>();
builder.Services.AddScoped<IAdminCreditPlans, AdminCreditPlans>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<InventoryService>(); builder.Services.AddScoped<IInventoryReader>(s => s.GetRequiredService<InventoryService>());
builder.Services.AddScoped<IStockMovementHistory, StockMovementHistory>();
builder.Services.AddScoped<IAdminStockReader, AdminStockReader>();
builder.Services.AddScoped<IAdminStockCatalog, Shop.Modules.Catalog.Infrastructure.AdminStockCatalog>();
builder.Services.AddScoped<AdminStockService>();
builder.Services.AddScoped<IAdminProducts, Shop.Modules.Catalog.Infrastructure.AdminProducts>();
builder.Services.AddScoped(s=>new StockReservationService(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment())); builder.Services.AddScoped<IStockReservations>(s => s.GetRequiredService<StockReservationService>());
builder.Services.AddScoped<IStockBoundedReservations>(sp=>sp.GetRequiredService<StockReservationService>());
builder.Services.AddScoped<IStockOrderReservationsV2>(s=>s.GetRequiredService<StockReservationService>());
builder.Services.AddScoped<IOrderFulfillmentInventory>(s=>s.GetRequiredService<StockReservationService>());
builder.Services.AddScoped<IPartialOrderFulfillmentInventory>(s=>s.GetRequiredService<StockReservationService>());
builder.Services.AddSingleton<CashGatewayRegistry>();
builder.Services.AddSingleton(new CashPaymentBindings(builder.Configuration.GetSection("Payments:CashGatewayBindings").Get<CashGatewayBinding[]>()??[]));
builder.Services.AddScoped<CashPaymentTransactionCoordinator>();
builder.Services.AddScoped(s=>new CashPaymentReadService(s.GetRequiredService<PaymentsDbContext>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new CashPaymentSettlementService(s.GetRequiredService<PaymentsDbContext>(),s.GetRequiredService<ICashPaymentOrders>(),s.GetRequiredService<CashGatewayRegistry>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new CashPaymentPreparationService(s.GetRequiredService<PaymentsDbContext>(),s.GetRequiredService<ICashPaymentOrders>(),s.GetRequiredService<CashPaymentBindings>(),s.GetRequiredService<CashGatewayRegistry>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<IPaymentAuthorityProtection,DataProtectionPaymentAuthorityProtection>();
builder.Services.AddScoped(s=>new CashOrderPaymentService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<IStockReservations>(),s.GetRequiredService<IStockOrderReservationsV2>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ICashPaymentOrders>(s=>s.GetRequiredService<CashOrderPaymentService>());

builder.Services.AddScoped(s=>new OrderShipmentService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<IOrderFulfillmentInventory>(),s.GetRequiredService<IStockReservations>(),s.GetRequiredService<IStockOrderReservationsV2>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment(),s.GetRequiredService<ICreditFulfillmentAuthorization>()));
builder.Services.AddScoped<OrderShipmentCoordinator>();
builder.Services.AddScoped<IOrderParcelProtection,DataProtectionOrderParcelProtection>();
builder.Services.AddScoped<IDigitalDeliveryProtection,DataProtectionDigitalDeliveryProtection>();
builder.Services.AddScoped(s=>new OrderParcelService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<IPartialOrderFulfillmentInventory>(),s.GetRequiredService<IOrderParcelProtection>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment(),s.GetRequiredService<ICreditFulfillmentAuthorization>(),s.GetRequiredService<OrderShipmentService>(),s.GetRequiredService<IDigitalDeliveryProtection>()));
builder.Services.AddScoped<OrderParcelCoordinator>();
builder.Services.AddScoped<SerialInventoryService>();builder.Services.AddScoped<IInventorySerialGuard>(s=>s.GetRequiredService<SerialInventoryService>());builder.Services.AddScoped<IStockSerialAssignments>(s=>s.GetRequiredService<SerialInventoryService>());
builder.Services.AddScoped<IStockSerialAssignmentsV2>(s=>s.GetRequiredService<SerialInventoryService>());
builder.Services.AddScoped<IAdminSerialReader>(s=>s.GetRequiredService<SerialInventoryService>());
builder.Services.AddScoped<IAdminSerialV2Reader,SerialInventoryV2Reader>();
builder.Services.AddScoped<ReceivingUnitMappingService>();builder.Services.AddScoped<IReceivingUnitMappings>(s=>s.GetRequiredService<ReceivingUnitMappingService>());
builder.Services.AddScoped<IInventorySourcingReceiving>(s=>new SourcingReceivingService(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<StockReservationService>(),s.GetRequiredService<SerialInventoryService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<IInventorySourcingAllocations>(s=>new SourcingAllocationService(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<StockReservationService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<IInventorySourcingConversionGuard>(s=>new SourcingConversionGuard(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<StockReservationService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<IInventoryCheckoutOffers>(s=>new CheckoutOffersGuard(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<StockReservationService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new SourcingPriceAgreementService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ISourcingPurchaseLifecycle,SourcingPurchaseLifecycle>();
builder.Services.AddScoped(s=>new SourcingAllocationPlanService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<ICatalogOfferReader>(),s.GetRequiredService<IPurchaseConfiguration>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<SupplyAllocationCoordinator>();
builder.Services.AddScoped<SourcingAllocationCandidate>();
builder.Services.AddScoped(s=>new SourcingConversionPlanService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<ICatalogOfferReader>(),s.GetRequiredService<IPurchaseConfiguration>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new SourcingConversionService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<CartService>(),s.GetRequiredService<SourcingPriceAgreementService>(),s.GetRequiredService<ICartCatalogReader>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<SourcingConversionCoordinator>();
builder.Services.AddScoped<SourcingSupplyProjection>();
builder.Services.AddHostedService<SourcingAllocationExpiryWorker>();
builder.Services.AddHostedService<StockReservationExpiryWorker>();
builder.Services.AddScoped<PurchaseMethodService>(); builder.Services.AddScoped<CreditPlanService>(); builder.Services.AddScoped<IPurchaseConfiguration, PurchaseConfiguration>();
builder.Services.AddScoped<ICreditApplicationProtection,DataProtectionCreditApplicationProtection>();builder.Services.AddScoped<CreditApplicationService>();builder.Services.AddScoped<CreditApplicationCoordinator>();builder.Services.AddScoped<CreditRequirementsService>();builder.Services.AddScoped<CreditRequirementsCoordinator>();builder.Services.AddScoped<CreditDocumentService>();builder.Services.AddScoped<CreditDocumentCoordinator>();builder.Services.AddScoped<CreditSubmissionService>().AddScoped<CreditReviewService>().AddScoped<CreditReviewCoordinator>();builder.Services.AddScoped<CreditSubmissionCoordinator>();
builder.Services.AddScoped<ICreditOrderScheduleSource,SalesCreditOrderScheduleSource>();builder.Services.AddScoped<ICreditScheduleProtection,DataProtectionCreditScheduleProtection>();builder.Services.AddScoped<CreditScheduleService>();builder.Services.AddScoped<CreditScheduleCoordinator>();
builder.Services.AddScoped<ICreditOrderFinanceSummaries,CreditOrderFinanceSummaryReader>();builder.Services.AddScoped<IChequeReportCursorProtection,DataProtectionChequeReportCursorProtection>();builder.Services.AddScoped<ChequeReportService>();
builder.Services.AddScoped<ICreditReminderProtection,DataProtectionCreditReminderProtection>();builder.Services.AddScoped<ICreditInboxProtection,DataProtectionCreditInboxProtection>();builder.Services.AddScoped<ICreditReminderNotificationWriter,CreditInboxWriter>();builder.Services.AddScoped<CreditInboxService>();builder.Services.AddScoped<CreditReminderService>();builder.Services.AddScoped<CreditReminderCoordinator>();builder.Services.AddSingleton(sp=>new CreditReminderDeliveryOptions(sp.GetRequiredService<IConfiguration>().GetValue("Credit:AutomaticRemindersEnabled",true)));builder.Services.AddScoped<ICreditReminderPolicyProtection,DataProtectionCreditReminderPolicyProtection>();builder.Services.AddScoped<CreditReminderPolicyService>();builder.Services.AddScoped<CreditReminderPolicyCoordinator>();builder.Services.AddScoped<CreditAutomaticReminderService>();builder.Services.AddSingleton<CreditAutomaticReminderRunner>();builder.Services.AddHostedService<CreditAutomaticReminderWorker>();
builder.Services.AddScoped<ICreditOrderCommitments,CreditOrderCommitmentService>();builder.Services.AddScoped<ICreditClearanceProtection,DataProtectionCreditClearanceProtection>();builder.Services.AddScoped<CreditClearanceService>();builder.Services.AddScoped<ICreditFulfillmentAuthorization>(s=>s.GetRequiredService<CreditClearanceService>());builder.Services.AddScoped<CreditClearanceCoordinator>();
builder.Services.AddScoped<IChequeApprovalProtection,DataProtectionChequeApprovalProtection>();builder.Services.AddScoped<ChequeApprovalService>();builder.Services.AddScoped<ChequeApprovalCoordinator>();
builder.Services.AddScoped<ICreditUpfrontProtection,DataProtectionCreditUpfrontProtection>();builder.Services.AddScoped<ICreditUpfrontOrderStages,SalesCreditUpfrontOrderStages>();builder.Services.AddScoped<CreditUpfrontService>();builder.Services.AddScoped<CreditUpfrontCoordinator>();
builder.Services.AddScoped<IChequeLedgerProtection,DataProtectionChequeLedgerProtection>();builder.Services.AddScoped<ChequeLedgerService>();builder.Services.AddScoped<ChequeLedgerCoordinator>();
builder.Services.AddScoped<ICreditOrderProtection,DataProtectionCreditOrderProtection>();builder.Services.AddScoped<CreditOrderService>(sp=>new(sp.GetRequiredService<SalesDbContext>(),sp.GetRequiredService<CartService>(),sp.GetRequiredService<CreditCheckoutQuoteService>(),sp.GetRequiredService<CheckoutOrderSettingsService>(),sp.GetRequiredService<SourcingPriceAgreementService>(),sp.GetRequiredService<IStockBoundedReservations>(),sp.GetRequiredService<IStockOrderReservationsV2>(),sp.GetRequiredService<ICreditPurchaseScopeClaims>(),sp.GetRequiredService<ICreditOrderProtection>(),sp.GetRequiredService<OrderV2Service>(),sp.GetRequiredService<TimeProvider>(),sp.GetRequiredService<ChequeReviewHoldService>(),builder.Environment.IsDevelopment()));builder.Services.AddScoped<CreditOrderCoordinator>();
builder.Services.AddScoped<ICreditCheckoutQuoteProtection,DataProtectionCreditCheckoutQuoteProtection>();builder.Services.AddScoped<CreditCheckoutQuoteService>();builder.Services.AddScoped<CreditCheckoutQuoteCoordinator>();
builder.Services.AddScoped<CreditPurchaseScopeService>();builder.Services.AddScoped<ICreditPurchaseScopeReader>(sp=>sp.GetRequiredService<CreditPurchaseScopeService>());builder.Services.AddScoped<ICreditPurchaseScopeClaims>(sp=>sp.GetRequiredService<CreditPurchaseScopeService>());builder.Services.AddScoped<CreditPurchaseScopeCoordinator>();
builder.Services.AddScoped(s => new CmsPageService(s.GetRequiredService<CmsDbContext>(), builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ICmsBlogCursorProtection,DataProtectionCmsBlogCursorProtection>();builder.Services.AddScoped(s=>new CmsBlogPostService(s.GetRequiredService<CmsDbContext>(),builder.Environment.IsDevelopment(),s.GetRequiredService<TimeProvider>(),s.GetRequiredService<ICmsBlogCursorProtection>()));builder.Services.AddScoped<CmsBlogPostCoordinator>();builder.Services.AddScoped<CmsBlogSitemapService>();
builder.Services.AddScoped<CmsPageCoordinator>();
builder.Services.AddScoped(s => new CmsRedirectService(s.GetRequiredService<CmsDbContext>(), builder.Environment.IsDevelopment()));
builder.Services.AddScoped<CmsRedirectCoordinator>();
builder.Services.AddScoped<CmsPageSitemapService>();
builder.Services.AddScoped(s => new SupportContentReader(s.GetRequiredService<CmsDbContext>(), builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ContentService>(); builder.Services.AddScoped<ISiteContentReader>(s => s.GetRequiredService<ContentService>());
builder.Services.AddScoped<ICatalogService, CatalogService>();
builder.Services.AddScoped<IAccountingCatalogLinks>(s=>(IAccountingCatalogLinks)s.GetRequiredService<ICatalogService>());
builder.Services.AddScoped<IAccountingImports>(s=>new AccountingImportService(s.GetRequiredService<CatalogDbContext>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<IAccountingInventory,AccountingInventoryService>();
builder.Services.AddScoped<AccountingReconciliationCoordinator>();
builder.Services.AddScoped<IAccountingStockCatalogReader,AccountingStockCatalogReader>();
builder.Services.AddScoped<IAccountingStockApplications>(s=>new AccountingStockApplicationService(s.GetRequiredService<InventoryDbContext>(),s.GetRequiredService<StockReservationService>(),s.GetRequiredService<IAccountingInventory>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<AccountingStockCoordinator>();
builder.Services.AddScoped<IMarketModelCatalog>(s=>(IMarketModelCatalog)s.GetRequiredService<ICatalogService>());
builder.Services.AddScoped(s=>new MarketService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<IMarketModelCatalog>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new MarketImportService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<IMarketModelCatalog>(),s.GetRequiredService<MarketService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new MarketSourceCsvService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<IMarketModelCatalog>(),s.GetRequiredService<MarketService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ICartCatalogReader>(s => (ICartCatalogReader)s.GetRequiredService<ICatalogService>());
builder.Services.AddScoped<IWishlistCatalogReader>(s=>(IWishlistCatalogReader)s.GetRequiredService<ICatalogService>());builder.Services.AddScoped<WishlistService>();builder.Services.AddScoped<WishlistCoordinator>();
builder.Services.AddScoped<ICheckoutCatalogReader>(s => (ICheckoutCatalogReader)s.GetRequiredService<ICatalogService>());
builder.Services.AddScoped<CartService>();
builder.Services.AddScoped(s=>new CartV2Service(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<CartService>(),s.GetRequiredService<CartSourcingService>(),s.GetRequiredService<IInventorySourcingAllocations>(),s.GetRequiredService<ICatalogOfferReader>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new CartOfferService(s.GetRequiredService<SalesDbContext>(),s.GetRequiredService<CartService>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped<ICatalogSourcingReader,CatalogSourcingReader>();
builder.Services.AddScoped<ICatalogOfferReader,CatalogOfferReader>();
builder.Services.AddScoped<ISourcingReceiptCatalogReader,SourcingReceiptCatalogReader>();
builder.Services.AddScoped<ISourcingSupplyNoteProtection,SourcingSupplyNoteProtection>();
builder.Services.AddScoped(s=>new SourcingSupplyService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<ICatalogOfferReader>(),s.GetRequiredService<ISourcingSupplyNoteProtection>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment(),s.GetRequiredService<ISourcingPurchaseLifecycle>()));
builder.Services.AddScoped<SupplyReceivingCoordinator>();
builder.Services.AddScoped(s=>new SourcingOfferService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<ICatalogOfferReader>(),s.GetRequiredService<IPurchaseConfiguration>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment(),s.GetRequiredService<IPhoneDiscoveryNotificationWriter>()));
builder.Services.AddScoped<CartSourcingService>();builder.Services.AddScoped<ISourcingCart>(s=>s.GetRequiredService<CartSourcingService>());
builder.Services.AddScoped<ISourcingNoteProtection,SourcingNoteProtection>();builder.Services.AddScoped<SourcingTransactionCoordinator>();builder.Services.AddScoped<SourcingTransactionFilter>();
builder.Services.AddSingleton(new SourcingRequestOptions(builder.Configuration.GetValue<int?>("Sourcing:MaxOpenRequestsPerOwner")??20));
builder.Services.AddScoped<IMarketSourcingReader>(s=>new MarketSourcingReader(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<ICatalogSourcingReader>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>new SourcingRequestService(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<IMarketSourcingReader>(),s.GetRequiredService<ISourcingCart>(),s.GetRequiredService<ISourcingNoteProtection>(),s.GetRequiredService<TimeProvider>(),s.GetRequiredService<SourcingRequestOptions>(),builder.Environment.IsDevelopment(),s.GetRequiredService<ISourcingPurchaseLifecycle>()));
builder.Services.AddScoped<CheckoutQuoteService>();
builder.Services.AddScoped(s=>ActivatorUtilities.CreateInstance<CheckoutQuoteV4Service>(s,builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>ActivatorUtilities.CreateInstance<CheckoutQuoteV5Service>(s,builder.Environment.IsDevelopment()));
builder.Services.AddScoped(s=>ActivatorUtilities.CreateInstance<OrderV2Service>(s,builder.Environment.IsDevelopment()));
builder.Services.AddScoped<OrderOutboxService>();
builder.Services.AddScoped<IMarketOrderProjection>(s=>new SourcingOrderProjection(s.GetRequiredService<MarketDbContext>(),s.GetRequiredService<TimeProvider>(),builder.Environment.IsDevelopment()));
builder.Services.AddSingleton<OrderProjectionRunner>();builder.Services.AddHostedService<OrderProjectionWorker>();
builder.Services.AddScoped<CheckoutChargePolicyService>();
builder.Services.AddScoped<ChequeReviewHoldService>();builder.Services.AddScoped<ChequeReviewHoldCoordinator>();builder.Services.AddScoped<CheckoutOrderSettingsService>(); builder.Services.AddScoped<OrderService>(); builder.Services.AddScoped<SalesTransactionCoordinator>();
builder.Services.AddSingleton<OrderExpiryRunner>(); builder.Services.AddHostedService<OrderExpiryWorker>();
builder.AddPublicMedia();
builder.Services.ConfigureHttpJsonOptions(o => { o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()); o.SerializerOptions.Converters.Add(new Int64StringConverter()); o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull; o.SerializerOptions.MaxDepth = 32; });
builder.Services.AddProblemDetails(); builder.Services.AddOpenApi();
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? (builder.Environment.IsDevelopment() ? ["http://127.0.0.1:3173", "http://127.0.0.1:3000"] : []);
var adminOrigins = builder.Configuration.GetSection("Cors:AdminOrigins").Get<string[]>() ?? (builder.Environment.IsDevelopment() ? ["http://127.0.0.1:3173"] : []);
if (builder.Environment.IsProduction()) AuthHttpSecurity.ValidateProductionOrigins(origins, adminOrigins);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().WithMethods("GET", "POST", "PUT", "DELETE").AllowCredentials()));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o => {
    var authConfig = AuthConfigurationValue();
    o.MapInboundClaims = false; o.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
    o.TokenValidationParameters = new() { ValidateIssuer = true, ValidIssuer = authConfig.Issuer, ValidateAudience = true, ValidAudience = authConfig.Audience, ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(authConfig.SigningKey)), ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(15), NameClaimType = "name", RoleClaimType = "role", ValidAlgorithms = [SecurityAlgorithms.HmacSha256] };
    o.Events = new() { OnTokenValidated = async context => {
        if (!await context.HttpContext.RequestServices.GetRequiredService<AuthService>().ValidatePrincipalAsync(context.Principal!, context.HttpContext.RequestAborted))
            context.Fail("Session is no longer valid.");
    } };
});
builder.Services.AddAuthorization(o => {
    o.DefaultPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().RequireClaim("token_kind", "access").Build();
    o.AddPolicy("customer", p => p.RequireAuthenticatedUser().RequireClaim("token_kind", "access"));
    o.AddPolicy("mfa_pending", p => p.RequireAuthenticatedUser().RequireClaim("token_kind", "mfa_pending"));
    o.AddPolicy("staff_password_change", p => p.RequireAuthenticatedUser().RequireClaim("token_kind", "staff_password_change"));
    o.AddPolicy("staff_mfa", p => p.RequireAuthenticatedUser().RequireClaim("token_kind", "access").RequireRole(ShopPermissions.Roles.Keys.ToArray()));
    o.AddPolicy("public_media.write", p => p.RequireAuthenticatedUser().RequireClaim("token_kind", "access").RequireClaim("permission", "catalog.write", "cms.write"));
    foreach (var permission in ShopPermissions.All) o.AddPolicy(permission, p => { p.RequireAuthenticatedUser().RequireClaim("token_kind", "access").RequireClaim("permission", permission); if (permission.StartsWith("staff.", StringComparison.Ordinal)) p.RequireRole("Administrator"); });
});
builder.Services.AddRateLimiter(o => {
    o.RejectionStatusCode = 429;
    o.AddPolicy("cms_blog",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??context.Connection.RemoteIpAddress?.ToString()??"unknown",_=>new(){PermitLimit=120,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("credit_applications",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??context.Connection.RemoteIpAddress?.ToString()??"unknown",_=>new(){PermitLimit=60,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("private_realtime", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub") ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("private_file_read",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??"unknown",_=>new(){PermitLimit=60,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("private_file_download",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??"unknown",_=>new(){PermitLimit=30,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("private_file_upload",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??"unknown",_=>new(){PermitLimit=10,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("support", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub") ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("reviews",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??context.Connection.RemoteIpAddress?.ToString()??"unknown",_=>new(){PermitLimit=60,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("orders", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub") ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("cart", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub") ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("media-upload",context=>RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub")??context.Connection.RemoteIpAddress?.ToString()??"unknown",_=>new(){PermitLimit=10,Window=TimeSpan.FromMinutes(1),QueueLimit=0}));
    o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 15, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("addresses", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue("sub") ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 512000);
builder.Services.AddPhoneInbox();
builder.Services.AddPhoneDiscovery(builder.Configuration,builder.Environment.IsDevelopment());
var app = builder.Build();
_ = app.Services.GetRequiredService<AuthConfiguration>();
app.ValidatePublicMedia();
_ = app.Services.GetRequiredService<IPrivateFileStore>();
if (args.Contains("--bootstrap-admin")) {
    var created = await FirstAdministratorCommand.RunAsync(app.Services, app.Configuration, args, CancellationToken.None);
    Console.WriteLine(created ? "First administrator created. Change the initial password and enroll MFA through the admin application." : "An administrator already exists. No accounts or credentials were changed.");
    return;
}
if (args.Contains("--market-navigation-dev")) {
    await using var scope = app.Services.CreateAsyncScope();
    var result = await DevelopmentNavigationSeed.RunAsync(scope.ServiceProvider, app.Environment, args.Contains("--apply"), CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
    return;
}
if (args.Contains("--seed-market-dev")) {
    await using var scope = app.Services.CreateAsyncScope();
    var result = await DevelopmentMarketSeed.RunAsync(scope.ServiceProvider, app.Environment, CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
    return;
}
if (args.Contains("--seed-phone-discovery-dev")) {
    await using var scope = app.Services.CreateAsyncScope();
    var result = await DevelopmentPhoneDiscoverySeed.RunAsync(scope.ServiceProvider, app.Environment, app.Environment.ContentRootPath, CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
    return;
}
if (args.Contains("--seed-moments-dev")) {
    await using var scope = app.Services.CreateAsyncScope();
    var result = await DevelopmentSeed.AddMomentsAsync(scope.ServiceProvider, app.Environment, app.Environment.ContentRootPath, CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
    return;
}
if (args.Contains("--migrate") || args.Contains("--seed-dev")) {
    if (args.Contains("--seed-dev") && !app.Environment.IsDevelopment()) throw new InvalidOperationException("Development seed is unavailable outside Development.");
    await using var scope = app.Services.CreateAsyncScope();
    foreach (var contextType in new[] { typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext), typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext), typeof(MarketDbContext), typeof(Shop.Modules.Reviews.ReviewsDbContext), typeof(SupportDbContext),typeof(NotificationsDbContext),typeof(FilesDbContext) }) await ((DbContext)scope.ServiceProvider.GetRequiredService(contextType)).Database.MigrateAsync();
    await scope.ServiceProvider.GetRequiredService<ICatalogService>().RepairSearchFieldsAsync(CancellationToken.None);
    if (args.Contains("--seed-dev")) {
        if (!app.Environment.IsDevelopment()) throw new InvalidOperationException("Development seed is unavailable outside Development.");
        await DevelopmentSeed.RunAsync(scope.ServiceProvider, app.Configuration, app.Environment.ContentRootPath);
    }
    return;
}
if (args.Contains("--repair-search-fields")) { await using var scope = app.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<ICatalogService>().RepairSearchFieldsAsync(CancellationToken.None); return; }
if(args.Contains("--reconcile-public-images")){
    try{await using var scope=app.Services.CreateAsyncScope();var result=await scope.ServiceProvider.GetRequiredService<Shop.Modules.Catalog.Media.PublicImageReconciler>().RunAsync(25,CancellationToken.None);Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));Environment.ExitCode=result.Failed>0?1:0;}
    catch(BusinessException e){Console.Error.WriteLine(e.Message);Environment.ExitCode=2;}
    return;
}
if (args.Contains("--expire-orders")) { var result = await app.Services.GetRequiredService<OrderExpiryRunner>().RunAsync(CancellationToken.None); Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result)); Environment.ExitCode = result.Failed > 0 ? 1 : 0; return; }
if(args.Contains("--project-sourcing-orders")){var result=await app.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(CancellationToken.None);Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));Environment.ExitCode=result.Failed>0?1:0;return;}
if (args.Contains("--expire-stock-reservations")) {
    await using var scope = app.Services.CreateAsyncScope();
    var expired = await scope.ServiceProvider.GetRequiredService<StockReservationService>().ExpireBatchAsync(100, CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { Expired = expired, BatchSize = 100 }));
    return;
}
app.UseSerilogRequestLogging();
app.UseExceptionHandler();
app.Use(async (context, next) => {
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
    context.Response.Headers.CacheControl = "no-store";
    if (context.Request.Path.StartsWithSegments("/api/orders") || context.Request.Path.StartsWithSegments("/api/admin/orders") || context.Request.Path.StartsWithSegments("/api/admin/customers") || context.Request.Path.StartsWithSegments("/api/admin/staff") || context.Request.Path.StartsWithSegments("/api/admin/staff-candidate") || context.Request.Path.StartsWithSegments("/api/admin/staff-role-catalog") || context.Request.Path.StartsWithSegments("/api/admin/redirects") || context.Request.Path.StartsWithSegments("/api/admin/pages") || context.Request.Path.StartsWithSegments("/api/admin/blog-posts") || CreditOrderEndpoints.IsScope(context.Request.Path.Value??"") || CreditCheckoutQuoteEndpoints.IsScope(context.Request.Path.Value??"") || CreditApplicationEndpoints.IsScope(context.Request.Path) || PrivateRealtimeTransport.IsScope(context.Request.Path.Value??"") || context.Request.Path.StartsWithSegments("/api/phones/interests") || context.Request.Path.StartsWithSegments("/api/admin/market") || context.Request.Path.StartsWithSegments("/api/wishlist") || context.Request.Path.StartsWithSegments("/api/notifications") || context.Request.Path.StartsWithSegments("/api/support") || context.Request.Path.StartsWithSegments("/api/admin/support")) { context.Response.Headers.CacheControl = "private, no-store"; context.Response.Headers.Vary = "Cookie, Authorization"; context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow"; }
    try { await SourcingEndpoints.LimitBodyAsync(context,next); }
    catch (BadHttpRequestException e) { await Problem(context, "invalid_input", "The request body or content type is invalid.", e.StatusCode is 413 or 415 ? e.StatusCode : 400); }
    catch (BusinessException e) { await Problem(context, e.Code, e.Message, e.Code is "staff_creation_unavailable" or "phone_discovery_unavailable" or "parcel_unavailable" or "partial_fulfillment_unavailable" or "partial_fulfillment_capacity_unavailable" or "wishlist_unavailable" or "wishlist_busy" or "credit_reminder_policy_unavailable" or "credit_reminder_policy_busy" or "credit_reminder_unavailable" or "credit_reminder_busy" or "cheque_report_unavailable" or "credit_clearance_unavailable" or "credit_clearance_busy" or "cheque_review_hold_unavailable" or "cheque_review_hold_busy" or "cheque_approval_unavailable" or "cheque_approval_busy" or "credit_upfront_unavailable" or "credit_upfront_busy" or "cms_redirect_unavailable" or "cms_redirect_busy" or "cms_redirect_capacity_unavailable" or "cms_blog_unavailable" or "cms_blog_busy" or "cms_page_unavailable" or "cms_page_busy" or "cheque_ledger_unavailable" or "cheque_ledger_busy" or "credit_schedule_unavailable" or "credit_schedule_busy" or "credit_order_unavailable" or "credit_quote_unavailable" or "credit_application_unavailable" or "credit_application_busy" or "private_file_unavailable" or "private_file_busy" or "notification_unavailable" or "support_content_unavailable" or "ticket_unavailable" or "ticket_busy" or "order_condition_unavailable" or "reviews_unavailable" or "cart_offer_capacity_unavailable" or "cart_v2_capacity_unavailable" or "sourcing_conversion_capacity_unavailable" or "sourcing_allocation_capacity_unavailable" or "sourcing_agreement_capacity_unavailable" or "receiving_capacity_unavailable" or "sourcing_supply_capacity_unavailable" or "sourcing_supply_note_unavailable" or "sourcing_offer_capacity_unavailable" or "sourcing_unavailable" or "sourcing_capacity_unavailable" or "sourcing_note_unavailable" or "market_unavailable" or "accounting_import_unavailable" or "shipment_unavailable" or "payment_order_unavailable" or "payment_attempt_unavailable" or "payment_verification_unavailable" or "payment_authority_unavailable" or "gateway_response_unavailable" or "gateway_unconfigured" or "catalog_unavailable" or "catalog_reindex_required" or "media_unavailable" or "sitemap_capacity_unavailable" or "address_unavailable" or "purchase_detail_capacity_unavailable" ? 503 : e.Code is "image_too_large" or "private_file_too_large" ? 413 : e.Code is "invalid_credentials" ? 401 : e.Code == "not_found" ? 404 : e.Code is "shipment_contract_upgrade_required" or "cart_contract_upgrade_required" or "order_contract_upgrade_required" or "reservation_contract_upgrade_required" or "serial_contract_upgrade_required" or "inventory_contract_upgrade_required" or "sourcing_supply_contract_upgrade_required" || e.Code.Contains("conflict", StringComparison.Ordinal) ? 409 : 400); }
    catch (DbUpdateConcurrencyException) { await Problem(context, "version_conflict", "The record changed. Reload and try again.", 409); }
    catch (DbUpdateException e) when (e.InnerException is SqlException { Number: 1205 }) { await Problem(context, "transaction_conflict", "A concurrent operation occurred. Reload and retry with the same request id.", 409); }
    catch (DbUpdateException e) when (e.InnerException is SqlException { Number: 2601 or 2627 or 547 }) { await Problem(context, "data_constraint", "A unique value is already used or a referenced record is still in use.", 409); }
    catch (DbUpdateException e) when (e.InnerException is SqlException { Number: 2628 or 8152 or 8115 }) { await Problem(context, "invalid_input", "A field exceeds its supported length or numeric range.", 400); }
    catch (SqlException e) when (e.Number == 1205) { await Problem(context, "transaction_conflict", "A concurrent operation occurred. Reload and retry with the same request id.", 409); }
    catch (InvalidOperationException e) when (e.InnerException is SqlException { Number: 1205 } or DbUpdateException { InnerException: SqlException { Number: 1205 } }) { await Problem(context, "transaction_conflict", "A concurrent operation occurred. Reload and retry with the same request id.", 409); }
});
app.UseCors(); app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
app.Use(PrivateRealtimeDispatch.Invoke);
app.Use((HttpContext http,RequestDelegate next)=>PrivateRealtimeTransport.Guard(http,next,origins,adminOrigins));
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapPublicMedia(adminOrigins);
app.MapCart(origins);
app.MapSourcing(origins);
app.MapSourcingOffers(origins);
app.MapSourcingSupply(origins);
app.MapSourcingAgreements(origins);
app.MapSourcingConversions(origins);
app.MapMarket();
app.MapPhoneDiscovery(origins);
app.MapPhoneInbox(origins);
app.MapOrders(origins);
app.MapOrderParcels(origins,adminOrigins);
app.MapAddressBook(origins);
app.MapWishlist(origins);
app.MapReviews(origins);
app.MapPublicSupportContent();
app.MapCmsPages(adminOrigins);
app.MapCmsBlogPosts(adminOrigins);
app.MapCmsBlogSitemap();
app.MapCmsRedirects(adminOrigins);
app.MapCmsPageSitemap();
app.MapGet("/health/live", (HttpContext context) => {
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    return Results.Ok(new { Status = "alive" });
}).AllowAnonymous();
app.MapGet("/health/ready", async (HttpContext context, IServiceProvider services, CancellationToken ct) => {
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    try {
        var db = services.GetRequiredService<CatalogDbContext>();
        if (!await db.Database.CanConnectAsync(ct)) return Results.StatusCode(503);
        foreach (var type in new[] { typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext), typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext), typeof(MarketDbContext), typeof(Shop.Modules.Reviews.ReviewsDbContext), typeof(SupportDbContext),typeof(NotificationsDbContext),typeof(FilesDbContext) }) {
            var database = ((DbContext)services.GetRequiredService(type)).Database;
            // Pending-only checks accept a database newer than this executable.
            // Require the exact per-module history before advertising readiness.
            if (!database.GetMigrations().SequenceEqual(await database.GetAppliedMigrationsAsync(ct), StringComparer.Ordinal)) return Results.StatusCode(503);
        }
        if (!await services.GetRequiredService<ICatalogService>().SearchFieldsReadyAsync(ct)) return Results.StatusCode(503);
        return Results.Ok(new { Status = "ready" });
    } catch (System.Data.Common.DbException) {
        return Results.StatusCode(503);
    }
}).AllowAnonymous();
app.MapGet("/api/storefront/{locale}", async (string locale, bool? metadataOnly, ICatalogService catalog, IPurchaseConfiguration purchasing, ContentService cms, CancellationToken ct) => {
    CheckLocale(locale); var data = metadataOnly == true ? await catalog.ReadMetadataAsync(locale, ct) : await catalog.ReadAsync(locale, ct); var site = await cms.ReadAsync("site", locale, ct);
    if (site.Count == 0) throw new BusinessException("content_unpublished", "Storefront content has not been published.");
    var auth = await cms.ReadAsync("auth", "fa", ct); EffectiveAuth(auth);
    var methods = await purchasing.MethodsAsync(locale, ct); var plans = await purchasing.PlansAsync(locale, ct);
    return Results.Ok(new { Version = 1, IsPreview = true, DataSource = "api", Locale = locale, Site = site, data.Products, data.Categories, data.AttributeDefinitions, data.AttributeLabels,
        PurchaseMethods = methods.Select(m => new { m.Id, m.Kind, m.Name, m.Description, m.Enabled, m.RequiresApproval, m.CategoryIds, MinAmountRial = m.MinAmountRial?.ToString(CultureInfo.InvariantCulture), MaxAmountRial = m.MaxAmountRial?.ToString(CultureInfo.InvariantCulture) }),
        ChequePlans = plans.Select(p => new { p.Id, p.Name, p.Months, MarkupPercent = p.MarkupBasisPoints / 100m, DownPaymentPercent = p.DownPaymentBasisPoints / 100m, RoundingUnitRial = p.RoundingUnitRial.ToString(CultureInfo.InvariantCulture), p.IntervalMonths, p.Enabled, p.CategoryIds, MinAmountRial = p.MinAmountRial?.ToString(CultureInfo.InvariantCulture), MaxAmountRial = p.MaxAmountRial?.ToString(CultureInfo.InvariantCulture) }), AuthSettings = auth });
}).AllowAnonymous();
var publicCatalog = app.MapGroup("/api/catalog/{locale}").AllowAnonymous();
publicCatalog.AddEndpointFilter(async (context, next) => { context.HttpContext.Response.Headers.CacheControl = "no-store"; return await InputValidation.Filter(context, next); });
publicCatalog.MapOfflineCatalog();
publicCatalog.MapCatalogSitemap();
publicCatalog.MapPost("/search", async (string locale, CatalogSearchInput input, ICatalogService catalog, CancellationToken ct) => { CheckLocale(locale); return Results.Ok(await catalog.SearchAsync(locale, input, ct)); });
publicCatalog.MapPost("/lookup", async (string locale, ProductLookupInput input, ICatalogService catalog, CancellationToken ct) => { CheckLocale(locale); return Results.Ok(new { Version = 1, Locale = locale, Products = await catalog.LookupAsync(locale, input, ct) }); });
publicCatalog.MapPost("/facet-values", async (string locale, FacetValuesInput input, ICatalogService catalog, CancellationToken ct) => { CheckLocale(locale); FacetValuesQuery.Create(input); return Results.Ok(await catalog.FacetValuesAsync(locale,input,ct)); });
publicCatalog.MapGet("/filters", async (string locale, string? categoryId, ICatalogService catalog, CancellationToken ct) => { CheckLocale(locale); var query = CatalogSearchQuery.Create(new(CategoryId: categoryId)); return Results.Ok(await catalog.FiltersAsync(locale, query.CategoryId, ct)); });
var authRoutes = app.MapGroup("/api/auth").RequireRateLimiting("auth");
authRoutes.AddEndpointFilter(InputValidation.Filter);
authRoutes.AddEndpointFilter(async (context, next) => {
    var http = context.HttpContext;
    http.Response.Headers.CacheControl = "private, no-store";
    http.Response.Headers.Pragma = "no-cache";
    http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    http.Response.Headers.Vary = "Origin, Cookie, Authorization";
    if (!HttpMethods.IsGet(http.Request.Method)) AuthHttpSecurity.CheckBrowserOrigin(http, IsAdminClient(http) || http.Request.Headers["X-Sayman-Admin"] == "1" ? adminOrigins : origins);
    return await next(context);
});
authRoutes.MapPost("/password", async (PasswordLogin input, AuthService service, ContentService cms, HttpContext context, CancellationToken ct) => {
    var settings = await cms.ReadAsync("auth", "fa", ct);
    // Administrative entry remains available independently of customer method settings.
    var adminEntry = context.Request.Headers["X-Sayman-Admin"] == "1";
    if (adminEntry || IsAdminClient(context)) CheckOrigin(context, adminOrigins);
    var result = await service.PasswordAsync(input, adminEntry || settings["emailPassword"]?.GetValue<bool>() == true, adminEntry || settings["usernamePassword"]?.GetValue<bool>() == true, adminEntry, ct);
    return AuthResponse(result, context, app.Environment.IsDevelopment());
}).AllowAnonymous();
authRoutes.MapPost("/staff/password", async (ChangeInitialStaffPasswordInput input, ClaimsPrincipal user, AuthService service, HttpContext context, CancellationToken ct) => {
    CheckOrigin(context, adminOrigins);
    return AuthResponse(await service.ChangeInitialStaffPasswordAsync(UserId(user), user.FindFirstValue("sst") ?? "", input, context.TraceIdentifier, ct), context, app.Environment.IsDevelopment());
}).RequireAuthorization("staff_password_change");
authRoutes.MapPost("/mfa/setup", async (ClaimsPrincipal user, AuthService service, HttpContext context, CancellationToken ct) => { CheckOrigin(context, adminOrigins); return Results.Ok(await service.SetupMfaAsync(UserId(user), user.FindFirstValue("sst") ?? "", user.HasClaim("mfa_recovery", "verified"), RecoveryDeadline(user), ct)); }).RequireAuthorization("mfa_pending");
authRoutes.MapPost("/mfa/verify", async (MfaVerification input, ClaimsPrincipal user, AuthService service, HttpContext context, CancellationToken ct) => { if (IsAdminClient(context)) CheckOrigin(context, adminOrigins); return AuthResponse(await service.VerifyMfaAsync(UserId(user), user.FindFirstValue("sst") ?? "", user.HasClaim("mfa_recovery", "verified"), input.Code, context.TraceIdentifier, ct), context, app.Environment.IsDevelopment()); }).RequireAuthorization("mfa_pending");
authRoutes.MapMfaRecovery(adminOrigins, app.Environment.IsDevelopment());
authRoutes.MapPost("/refresh", async (AuthService service, HttpContext context, CancellationToken ct) => { CheckOrigin(context, IsAdminClient(context) ? adminOrigins : origins); return AuthResponse(await service.RefreshAsync(AuthHttpSecurity.ReadCookie(context, app.Environment.IsDevelopment()) ?? "", ct, IsAdminClient(context)), context, app.Environment.IsDevelopment()); }).AllowAnonymous();
authRoutes.MapPost("/logout", async (AuthService service, HttpContext context, CancellationToken ct) => { CheckOrigin(context, IsAdminClient(context) ? adminOrigins : origins); await service.LogoutAsync(AuthHttpSecurity.ReadCookie(context, app.Environment.IsDevelopment()), ct); AuthHttpSecurity.Clear(context, app.Environment.IsDevelopment()); return Results.NoContent(); }).AllowAnonymous();
authRoutes.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(new { Id = UserId(user), Name = user.FindFirstValue("name"), DisplayName = user.FindFirstValue("display_name"), Permissions = user.FindAll("permission").Select(c => c.Value).ToArray(), Roles = user.FindAll("role").Select(c => c.Value).ToArray() })).RequireAuthorization("customer");
authRoutes.MapPost("/otp", () => Results.Problem(statusCode: 503, title: "otp_unconfigured", detail: "SMS provider is not configured.")).AllowAnonymous();
authRoutes.MapPost("/register", () => Results.Problem(statusCode: 503, title: "verification_unconfigured", detail: "Account verification provider is not configured.")).AllowAnonymous();
authRoutes.MapPost("/password-reset", () => Results.Problem(statusCode: 503, title: "verification_unconfigured", detail: "Verified recovery provider is not configured.")).AllowAnonymous();
var admin = app.MapGroup("/api/admin");
admin.AddEndpointFilter(InputValidation.Filter);
admin.AddEndpointFilter(StaffEndpoints.ValidateInputs);
admin.MapStaff();
admin.MapCustomerDirectory(adminOrigins);
admin.MapAdminStock();
admin.MapAdminSerials();
admin.MapAdminProducts();
admin.MapAdminMarket();
admin.MapAdminSourcing();
admin.MapAdminSourcingOffers();
admin.MapAdminSourcingSupply();
admin.MapAdminSourcingAllocations();
admin.MapAdminAccounting();
admin.MapAdminReviews();
admin.MapAdminSupportContent();
admin.MapAdminUsedItems();
admin.MapGet("/catalog", async (bool? metadataOnly, ICatalogService service, CancellationToken ct) => Results.Ok(metadataOnly == true ? await service.AdminMetadataAsync(ct) : await service.AdminReadAsync(ct))).RequireAuthorization("catalog.read");
admin.MapPost("/categories", async (CategoryInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveCategoryAsync(null, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPut("/categories/{id}", async (string id, CategoryInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveCategoryAsync(id, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPost("/brands", async (BrandInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveBrandAsync(null, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPut("/brands/{id}", async (string id, BrandInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveBrandAsync(id, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPost("/attributes", async (AttributeInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveAttributeAsync(null, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPut("/attributes/{id}", async (string id, AttributeInput input, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveAttributeAsync(id, input, ct) })).RequireAuthorization("catalog.write");
admin.MapPost("/products", async (ProductInput input, ClaimsPrincipal user, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveProductAsync(null, input, UserId(user), ct) })).RequireAuthorization("catalog.write");
admin.MapPut("/products/{id}", async (string id, ProductInput input, ClaimsPrincipal user, ICatalogService service, CancellationToken ct) => Results.Ok(new { Id = await service.SaveProductAsync(id, input, UserId(user), ct) })).RequireAuthorization("catalog.write");
admin.MapGet("/inventory", async (bool? includeMovements, InventoryService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(ct, includeMovements ?? true))).RequireAuthorization("inventory.read");
admin.MapGet("/inventory/movements", async (string? variantId, string? direction, DateTimeOffset? fromAt, DateTimeOffset? toAt, string? cursor, IStockMovementHistory service, CancellationToken ct) => {
    var filter = StockMovementFilter.Create(variantId, direction, fromAt, toAt);
    // Reject malformed or mismatched cursors even when a reader is replaced in an isolated test.
    StockMovementPaging.Decode(cursor, filter);
    return Results.Ok(await service.ReadAsync(filter, cursor, ct));
}).RequireAuthorization("inventory.read");
admin.MapPost("/inventory/{variantId}/adjust", async (string variantId, StockAdjustment input, ClaimsPrincipal user, InventoryService service, ICatalogService catalog, CancellationToken ct) => {
    if (!await catalog.VariantExistsAsync(variantId, ct)) throw new BusinessException("not_found", "Variant was not found."); return Results.Ok(await service.AdjustAsync(variantId, input, UserId(user), ct));
}).RequireAuthorization("inventory.write");
admin.MapAdminFinance();
admin.MapGet("/purchase-methods", async (PurchaseMethodService service, CancellationToken ct) => Results.Ok(await service.AdminAsync(ct))).RequireAuthorization("finance.read");
admin.MapPost("/purchase-methods", async (PurchaseMethodInput input, PurchaseMethodService service, ICatalogService catalog, CancellationToken ct) => { await CheckCategories(catalog, input.CategoryIds, ct); return Results.Ok(new { Id = await service.SaveAsync(null, input, ct) }); }).RequireAuthorization("finance.write");
admin.MapPut("/purchase-methods/{id}", async (string id, PurchaseMethodInput input, PurchaseMethodService service, ICatalogService catalog, CancellationToken ct) => { await CheckCategories(catalog, input.CategoryIds, ct); return Results.Ok(new { Id = await service.SaveAsync(id, input, ct) }); }).RequireAuthorization("finance.write");
admin.MapGet("/cheque-plans", async (CreditPlanService service, CancellationToken ct) => Results.Ok(await service.AdminAsync(ct))).RequireAuthorization("finance.read");
admin.MapGet("/checkout-charges", async (CheckoutChargePolicyService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(ct))).RequireAuthorization("finance.read");
admin.MapPut("/checkout-charges", async (CheckoutChargePolicyInput input, CheckoutChargePolicyService service, CancellationToken ct) => Results.Ok(await service.SaveAsync(input, ct))).RequireAuthorization("finance.write");
admin.MapPost("/cheque-plans", async (ChequePlanInput input, CreditPlanService service, ICatalogService catalog, CancellationToken ct) => { await CheckCategories(catalog, input.CategoryIds, ct); return Results.Ok(new { Id = await service.SaveAsync(null, input, ct) }); }).RequireAuthorization("finance.write");
admin.MapPut("/cheque-plans/{id}", async (string id, ChequePlanInput input, CreditPlanService service, ICatalogService catalog, CancellationToken ct) => { await CheckCategories(catalog, input.CategoryIds, ct); return Results.Ok(new { Id = await service.SaveAsync(id, input, ct) }); }).RequireAuthorization("finance.write");
admin.MapGet("/order-settings", async (CheckoutOrderSettingsService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(ct))).RequireAuthorization("sales.read");
admin.MapPut("/order-settings", async (CheckoutOrderSettingsInput input, CheckoutOrderSettingsService service, CancellationToken ct) => Results.Ok(await service.SaveAsync(input, ct))).RequireAuthorization("sales.write");
admin.MapGet("/orders", async (string? cursor, OrderService service, CancellationToken ct) => Results.Ok(await service.ListAsync(null, cursor, ct))).RequireAuthorization("sales.read");
admin.MapAdminOrdersV2();
admin.MapAdminOrderShipments();
app.MapCashPaymentReads(admin,origins);
app.MapSupportTickets(admin,origins,adminOrigins);
app.MapTicketAttachments(origins,adminOrigins);
app.MapCreditApplications(origins,adminOrigins);
app.MapCreditRequirements(origins,adminOrigins);
app.MapCreditDocuments(origins,adminOrigins);
app.MapCreditSubmissions(origins,adminOrigins);
app.MapCreditReviews(origins,adminOrigins);
app.MapCreditPurchaseScopes(origins,adminOrigins);
app.MapCreditCheckoutQuotes(origins);
app.MapCreditOrders(origins,adminOrigins);
app.MapCreditSchedules(origins,adminOrigins);
app.MapChequeLedger(origins,adminOrigins);
app.MapCreditUpfront(origins,adminOrigins);
app.MapChequeApproval(origins,adminOrigins);
app.MapCreditClearance(origins,adminOrigins);
app.MapChequeReport(adminOrigins);
app.MapCreditReminders(adminOrigins);
app.MapCreditReminderPolicy(adminOrigins);
app.MapChequeReviewHold(adminOrigins);
app.MapPrivateNotifications(origins);
void ConfigurePrivateHub(HttpConnectionDispatcherOptions options){options.Transports=HttpTransportType.LongPolling;options.MinimumProtocolVersion=1;options.LongPolling.PollTimeout=TimeSpan.FromSeconds(8);options.ApplicationMaxBufferSize=16384;options.TransportMaxBufferSize=16384;options.CloseOnAuthenticationExpiration=true;options.AllowStatefulReconnects=false;}
app.MapHub<PrivateRealtimeHub>("/api/realtime",ConfigurePrivateHub).RequireAuthorization("customer").RequireRateLimiting("private_realtime");
app.MapHub<PrivateRealtimeHub>("/api/admin/realtime",ConfigurePrivateHub).RequireAuthorization("staff_mfa","support.read").RequireRateLimiting("private_realtime");
admin.MapGet("/orders/{ownerId}/{id}", async (string ownerId, string id, OrderService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(ownerId, id, ct))).RequireAuthorization("sales.write");
admin.MapPost("/orders/{id}/cancel", async (string id, AdminCancelOrderInput input, ClaimsPrincipal user, OrderService service, CancellationToken ct) => Results.Ok(await service.CancelAsync(input.OwnerId, id, input.Version, UserId(user), ct))).RequireAuthorization("sales.write");
admin.MapGet("/content", async (ContentService service, CancellationToken ct) => Results.Ok(await service.AdminAsync(ct))).RequireAuthorization("cms.read");
admin.MapPut("/content/{key}/{locale}", async (string key, string locale, ContentInput input, ClaimsPrincipal user, ContentService service, CancellationToken ct) => { await service.SaveAsync(key, locale, input, UserId(user), ct); return Results.NoContent(); }).RequireAuthorization("cms.write");
admin.MapPost("/content/{key}/{locale}/publish", async (string key, string locale, PublishInput input, ClaimsPrincipal user, ContentService service, CancellationToken ct) => { await service.PublishAsync(key, locale, input.Version, UserId(user), input.RestoreRevisionId, ct); return Results.NoContent(); }).RequireAuthorization("cms.write");
admin.MapGet("/audit", async (IdentityDbContext db, CancellationToken ct) => Results.Ok(await db.Audit.AsNoTracking().OrderByDescending(x => x.Id).Take(200).ToListAsync(ct))).RequireAuthorization("audit.read");
admin.AddEndpointFilter<AdminAuditFilter>();
await app.RunAsync();

static void EffectiveAuth(JsonObject auth) { auth["mobileOtp"] = false; auth["registration"] = false; auth["passwordReset"] = false; }
static string UserId(ClaimsPrincipal user) => user.FindFirstValue("sub") ?? throw new BusinessException("invalid_credentials", "User identity is missing.");
static DateTimeOffset? RecoveryDeadline(ClaimsPrincipal user)
{
    if (!user.HasClaim("mfa_recovery", "verified")) return null;
    if (!long.TryParse(user.FindFirstValue("exp"), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)) throw new BusinessException("invalid_credentials", "The enrollment grant is invalid.");
    try { return DateTimeOffset.FromUnixTimeSeconds(seconds); }
    catch (ArgumentOutOfRangeException) { throw new BusinessException("invalid_credentials", "The enrollment grant is invalid."); }
}
static void CheckLocale(string locale) { if (locale is not ("fa" or "en")) throw new BusinessException("invalid_locale", "Use fa or en."); }
static async Task CheckCategories(ICatalogService catalog, string[] ids, CancellationToken ct) { if (!await catalog.CategoriesExistAsync(ids, ct)) throw new BusinessException("unknown_category", "Category rules reference an unknown category."); }
static bool IsAdminClient(HttpContext context) => context.Request.Headers["X-Sayman-Client"] == "admin";
static IResult AuthResponse(AuthResult result, HttpContext context, bool development) {
    if (result.RefreshToken is not null) {
        AuthHttpSecurity.ClearLegacy(context, development);
        context.Response.Cookies.Append(AuthHttpSecurity.CookieName(IsAdminClient(context), development), result.RefreshToken, AuthHttpSecurity.Cookie(development, result.RefreshExpiresAt));
    }
    var body = new Dictionary<string, object?> { ["accessToken"] = result.AccessToken, ["expiresIn"] = result.ExpiresIn,
        ["requiresMfa"] = result.RequiresMfa, ["requiresEnrollment"] = result.RequiresEnrollment,
        ["requiresRecovery"] = result.RequiresRecovery, ["user"] = result.User };
    if (result.RequiresPasswordChange) body["requiresPasswordChange"] = true;
    return Results.Ok(body);
}
static void CheckOrigin(HttpContext context, string[] origins) { var origin = context.Request.Headers.Origin.ToString(); if (!origins.Contains(origin, StringComparer.Ordinal)) throw new BusinessException("invalid_origin", "This browser origin is not allowed."); }
static async Task Problem(HttpContext context, string code, string detail, int status) => await Results.Problem(statusCode: status, title: code, detail: detail, extensions: new Dictionary<string, object?> { ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
public record PublishInput(string Version, long? RestoreRevisionId);
public sealed class PurchaseConfiguration(PurchaseMethodService methods, CreditPlanService plans) : IPurchaseConfiguration
{
    public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale, CancellationToken ct) => methods.PublicAsync(locale, ct);
    public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale, CancellationToken ct) => plans.PublicAsync(locale, ct);
}
public sealed class Int64StringConverter : JsonConverter<long>
{
    public override long Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.TokenType == JsonTokenType.String && long.TryParse(reader.GetString(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value) ? value : throw new JsonException("Int64 values must be decimal strings.");
    public override void Write(Utf8JsonWriter writer, long value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
}
public partial class Program;
