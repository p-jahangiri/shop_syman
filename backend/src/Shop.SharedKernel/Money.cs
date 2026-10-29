using System.Globalization;
using System.Text;

namespace Shop.SharedKernel;

public readonly record struct Rial
{
    public long Value { get; }
    public Rial(long value) => Value = value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value));
    public static Rial operator +(Rial a, Rial b) => new(checked(a.Value + b.Value));
    public Rial Multiply(int quantity) => quantity >= 0 ? new(checked(Value * quantity)) : throw new ArgumentOutOfRangeException(nameof(quantity));
    public override string ToString() => Value.ToString(CultureInfo.InvariantCulture);
}

public static class PersianText
{
    public static string Normalize(string text)
    {
        var output = new StringBuilder();
        var space = false;
        foreach (var source in text.Normalize(NormalizationForm.FormKC))
        {
            var c = source switch { 'ي' or 'ى' => 'ی', 'ك' => 'ک', >= '۰' and <= '۹' => (char)('0' + source - '۰'), >= '٠' and <= '٩' => (char)('0' + source - '٠'), _ => source };
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsWhiteSpace(c) || c == '\u200c') { if (output.Length > 0) space = true; continue; }
            if (space) output.Append(' ');
            output.Append(char.ToLowerInvariant(c));
            space = false;
        }
        return output.ToString();
    }
}
