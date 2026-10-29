using System.Data;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;

namespace Shop.UiHarness;

// Fresh disposable prerequisites only. Cart2 prepares the physical devices,
// allocation and separate ordinary/inquiry lanes. Only the browser may perform
// the accepted-group conversion, Quote5 preparation and Order2 creation.
internal static class Order2HarnessSeed
{
    private static readonly string[] PrerequisiteFlags = ["SHOP_UI_SOURCING_QA", "SHOP_UI_OFFERS_QA", "SHOP_UI_SUPPLY_QA", "SHOP_UI_OPERATIONS_QA", "SHOP_UI_ALLOCATION_QA", "SHOP_UI_CART2_QA"];
    private static readonly string[] IncompatibleFlags = ["SHOP_UI_RESUME_RUN", "SHOP_UI_PRESERVE_CART34_ON_STOP", "SHOP_UI_FINALIZE_CART34_RUN", "SHOP_UI_VERIFY_RESTORE", "SHOP_UI_VERIFY_CART34_RESTORE"];

    internal static void RequireFreshFlags()
    {
        if (Environment.GetEnvironmentVariable("SHOP_UI_ORDER2_QA") != "1" || PrerequisiteFlags.Any(flag => Environment.GetEnvironmentVariable(flag) != "1") || IncompatibleFlags.Any(flag => Environment.GetEnvironmentVariable(flag) is not null))
            throw new InvalidOperationException("Order2 QA requires all six explicit prerequisite flags and a fresh run with default cleanup; resume, Cart34 preservation/finalization and restore modes are forbidden.");
    }

    internal static async Task RunAsync(IServiceProvider services, IWebHostEnvironment environment, string expectedDatabase, string runDirectory, Cart2HarnessSeed.Result predecessor, CancellationToken ct)
    {
        RequireFreshFlags();
        if (OperatingSystem.IsWindows() || !environment.IsDevelopment() || !Regex.IsMatch(expectedDatabase, "^SaymanTest_Ui_[a-f0-9]{32}$")) throw new InvalidOperationException("Order2 QA policies are restricted to a fresh Development GUID database.");
        var directory = new DirectoryInfo(runDirectory);
        var keys = services.GetRequiredService<IOptions<KeyManagementOptions>>().Value.XmlRepository as FileSystemXmlRepository;
        var previousFile = Path.Combine(runDirectory, "cart2.json");
        var targetFile = Path.Combine(runDirectory, "order2.json");
        if (!directory.Exists || directory.Name != expectedDatabase || directory.Parent?.Name != "ui-cart" || directory.LinkTarget is not null || (File.GetUnixFileMode(runDirectory) & (UnixFileMode)63) != 0 || keys is null || keys.Directory.FullName != Path.GetFullPath(Path.Combine(runDirectory, "keys")) || keys.Directory.LinkTarget is not null || !File.Exists(previousFile) || (File.GetAttributes(previousFile) & FileAttributes.ReparsePoint) != 0 || (File.GetUnixFileMode(previousFile) & (UnixFileMode)63) != 0 || File.Exists(targetFile))
            throw new InvalidOperationException("Order2 QA requires this fresh run's private directory, original key ring and completed Cart2 metadata, with no prior Order2 metadata.");
        if (predecessor.SchemaVersion != 1 || predecessor.Database != expectedDatabase || !predecessor.QaOnly || predecessor.MainPromoted || predecessor.Units.Length != 3 || predecessor.Units.Count(unit => unit.Selected) != 2 || predecessor.Units.Select(unit => unit.Id).Distinct(StringComparer.Ordinal).Count() != 3)
            throw new InvalidOperationException("Order2 QA requires the completed own-run three-device Cart2 prerequisite and exact two-device allocation.");

        var sales = services.GetRequiredService<SalesDbContext>();
        var inventory = services.GetRequiredService<InventoryDbContext>();
        foreach (var context in new DbContext[] { sales, inventory })
            if (context.Database.GetDbConnection().Database != expectedDatabase || context.Database.GetDbConnection().DataSource != "127.0.0.1,11433") throw new InvalidOperationException("Order2 policies cannot cross the fresh GUID QA database boundary.");

        // This includes zero policy rows. It must run AFTER Cart2's final
        // assertion, before either D21 service can write its first QA row.
        await Cart2HarnessSeed.AssertNoPurchaseAsync(inventory, sales, ct);
        await using (var transaction = await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct)) {
            await services.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(true, 60, 2, null), ct);
            await services.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat", "ارسال مصنوعی QA", "Synthetic QA shipping", "فقط آزمون موقت Order2؛ سیاست فروشگاه نیست", "Disposable Order2 QA only; not a store policy", "12345", null, "exempt", null, "goods", "half_up", null), ct);
            await transaction.CommitAsync(ct);
        }
        var settings = await sales.OrderSettings.AsNoTracking().SingleAsync(ct);
        var charges = await sales.ChargePolicies.AsNoTracking().SingleAsync(ct);
        if (!settings.TemporaryOrdersEnabled || settings.ReservationMinutes != 60 || settings.MaxOpenOrdersPerCustomer != 2 || charges.ShippingMode != "flat" || charges.ShippingFeeRial != 12345 || charges.ShippingFreeFromRial is not null || charges.TaxMode != "exempt" || charges.TaxRateBasisPoints is not null || charges.TaxBase != "goods" || charges.TaxRounding != "half_up" || await sales.Orders.AnyAsync(ct) || await sales.Quotes.AnyAsync(ct) || await sales.SourcingConversions.AnyAsync(ct) || await sales.CartOfferLines.AnyAsync(ct) || await sales.CartOfferCommandReceipts.AnyAsync(ct) || await inventory.Reservations.AnyAsync(ct) || await inventory.SourcingReceipts.AnyAsync(ct) || await inventory.ReceivingUnitMappings.AnyAsync(ct))
            throw new InvalidOperationException("Order2 QA must add only the two exact D21 policies without a quote, order, conversion, reservation or sourcing receiving.");

        // Fixed synthetic fixtures, never real customer contact information.
        // IDs below refer only to the predecessor's generated QA database;
        // credentials, tokens, authenticator keys and device serials are absent.
        await UiHarnessProgram.WritePrivate(targetFile, new {
            SchemaVersion = 1, Database = expectedDatabase, QaOnly = true, Order2Qa = true, EnabledQaFlag = "SHOP_UI_ORDER2_QA",
            GeneratedSyntheticQa = true, ContainsCustomerPii = false, BrowserAccepted = false, MainPromoted = false,
            SetupKind = "D21-only policies after completed Cart2 prerequisites; browser must convert, prepare Quote5 and create Order2",
            Cart2MetadataFile = "cart2.json", predecessor.CustomerId, predecessor.WarehouseId, predecessor.CartId, predecessor.VariantId,
            predecessor.RequestId, predecessor.OfferId, predecessor.AcceptanceId, predecessor.TaskId, predecessor.AgreementId, predecessor.AllocationId,
            predecessor.PurchaseUntil, predecessor.AllocationExpiresAt,
            Policy = new { ShippingMode = "flat", ShippingFeeRial = "12345", TaxMode = "exempt", TemporaryOrdersEnabled = true, ReservationMinutes = 60, MaxOpenOrdersPerCustomer = 2 },
            SyntheticOrderInput = new {
                ContactName = "Synthetic Order2 browser customer", ContactPhone = "09121234567",
                Delivery = new { CountryCode = "IR", Province = "تهران", City = "تهران", Address = "نشانی مصنوعی برای آزمون مرورگر Order2", PostalCode = "1234567890" },
                Note = "Synthetic Order2 browser QA only", AcknowledgeTemporary = true
            },
            BrowserGatewayPlan = new { Route = "/api/orders/v2", DropFirstCreatedStatus = 201, DropFirstReplayStatus = 200, RequiredLostResponses = 2, Performed = false },
            QuoteCreatedBySeed = false, OrderCreatedBySeed = false, ConversionCreatedBySeed = false, Cleanup = "default-owned-database-and-private-files-delete; no-preservation-mode"
        }, ct);
    }
}
