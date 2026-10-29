using System.Globalization;
namespace Shop.SharedKernel;
public static class PurchaseLimits
{
    public static long? Parse(string? value)
    {
        if (value is null) return null;
        if (value.Length is < 1 or > 19 || value.Any(c => c is < '0' or > '9') || !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var result)) throw new BusinessException("invalid_money", "Amount must be a nonnegative integer rial string.");
        return result;
    }
    public static void Validate(long? min, long? max) { if (min < 0 || max < (min ?? 0)) throw new BusinessException("invalid_amount_range", "Amount limits are invalid."); }
}
