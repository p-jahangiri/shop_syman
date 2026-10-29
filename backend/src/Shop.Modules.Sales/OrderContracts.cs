using System.Text;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed record OrderAddressInput(string CountryCode, string Province, string City, string Address, string PostalCode);
public sealed record CreateOrderInput(string QuoteId, string RequestId, string ContactName, string ContactPhone, OrderAddressInput? Delivery, string? Note, bool AcknowledgeTemporary);
public sealed record CancelOrderInput(string Version);
public sealed record AdminCancelOrderInput(string OwnerId, string Version);
public sealed record OrderLineData(string VariantId, string ProductId, string SellerId, string Sku, string Name, string Label, string Warranty, bool IsDigital, int Quantity, string UnitPriceRial, string LineTotalRial,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]UsedItemConditionData? UsedCondition=null);
public sealed record OrderEventData(string State, DateTimeOffset At, string Reason);
public sealed record OrderSummaryData(string Id, string Reference, string Locale, string State, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string PayableTotalRial, int ItemCount, string Version, string? OwnerId = null);
public sealed record OrderDetailData(int SchemaVersion, OrderSummaryData Summary, string QuoteId, string ContactName, string ContactPhone, OrderAddressInput? Delivery, string Note, bool ShippingRequired, string MethodName, string ShippingName, string ItemsSubtotalRial, string GoodsTotalRial, string ShippingRial, string TaxRial, string PayableTotalRial, bool TaxIncluded, OrderLineData[] Lines, OrderEventData[] Events, bool CanCancel, bool CanPay, string PaymentAvailability);
public sealed record CreateOrderResult(OrderDetailData Order, bool Replayed);
public sealed record OrderPageData(OrderSummaryData[] Items, string? NextCursor);
public sealed record OrderExpiryCandidate(string Id, string OwnerId);
public static class OrderInputRules
{
    public static string Identifier(string? value) => value is { Length: > 0 and <= 64 } && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? value : throw Invalid();
    public static string Uuid(string? value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw Invalid();
    public static CreateOrderInput Normalize(CreateOrderInput input)
    {
        if (!input.AcknowledgeTemporary) throw new BusinessException("temporary_order_acknowledgement_required", "Acknowledge the temporary order and unpaid reservation deadline.");
        var contact = NormalizeContact(input.ContactName, input.ContactPhone, input.Delivery);
        return new(Uuid(input.QuoteId), Uuid(input.RequestId), contact.Name, contact.Phone, contact.Delivery, Text(input.Note ?? "", 0, 500, true), true);
    }
    public static (string Name, string Phone, OrderAddressInput? Delivery) NormalizeContact(string nameInput, string phoneInput, OrderAddressInput? delivery)
    {
        var name = Text(nameInput, 2, 100); var phone = Digits(phoneInput).Replace(" ", "").Replace("-", "");
        if (phone.StartsWith("0098", StringComparison.Ordinal)) phone = "0" + phone[4..]; else if (phone.StartsWith("+98", StringComparison.Ordinal)) phone = "0" + phone[3..];
        if (!Regex.IsMatch(phone, "^09[0-9]{9}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking)) throw Invalid();
        OrderAddressInput? address = null;
        if (delivery is not null) {
            var code = Digits(delivery.PostalCode).Replace(" ", "");
            if (delivery.CountryCode != "IR" || !Regex.IsMatch(code, "^[0-9]{10}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking)) throw Invalid();
            address = new("IR", Text(delivery.Province, 2, 100), Text(delivery.City, 2, 100), Text(delivery.Address, 10, 2000, true), code);
        }
        return (name, phone, address);
    }
    private static string Digits(string? value)
    {
        if (value is null || value.Length > 64) throw Invalid();
        return string.Concat(value.Trim().Normalize(NormalizationForm.FormKC).Select(c => c is >= '۰' and <= '۹' ? (char)('0' + c - '۰') : c is >= '٠' and <= '٩' ? (char)('0' + c - '٠') : c));
    }
    private static string Text(string? value, int min, int max, bool multiline = false)
    {
        var text = value?.Replace("\r\n", "\n").Replace('\r', '\n').Normalize(NormalizationForm.FormKC).Trim(); if (text is null || text.Length < min || text.Length > max || text.Any(c => char.IsControl(c) && !(multiline && c == '\n'))) throw Invalid(); return text;
    }
    private static BusinessException Invalid() => new("invalid_order", "Provide bounded contact details, valid identifiers and an Iranian delivery address when physical shipping is required.");
}
