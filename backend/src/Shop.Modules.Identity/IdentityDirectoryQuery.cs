using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Identity;

internal static class IdentityDirectoryQuery
{
    internal static IQueryable<ShopUser> Filter(IQueryable<ShopUser> query, string search, string active, string? after)
    {
        if (active != "all") query = query.Where(u => u.IsActive == (active == "true"));
        foreach (var term in search.Split(' ', StringSplitOptions.RemoveEmptyEntries)) {
            query = query.Where(u => (u.NormalizedUserName ?? "").ToLower().Contains(term) || EF.Functions.Collate(EF.Functions.Collate(u.DisplayName, "Latin1_General_100_BIN2").Replace("\u064b", "").Replace("\u064c", "").Replace("\u064d", "").Replace("\u064e", "").Replace("\u064f", "").Replace("\u0650", "").Replace("\u0651", "").Replace("\u0652", "").Replace("\u0653", "").Replace("\u0654", "").Replace("\u0655", "").Replace("\u0656", "").Replace("\u0657", "").Replace("\u0658", "").Replace("\u0659", "").Replace("\u065a", "").Replace("\u065b", "").Replace("\u065c", "").Replace("\u065d", "").Replace("\u065e", "").Replace("\u065f", "").Replace("\u0670", "").Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Replace("\u200c", " ")
                .Replace("۰", "0").Replace("۱", "1").Replace("۲", "2").Replace("۳", "3").Replace("۴", "4").Replace("۵", "5").Replace("۶", "6").Replace("۷", "7").Replace("۸", "8").Replace("۹", "9")
                .Replace("٠", "0").Replace("١", "1").Replace("٢", "2").Replace("٣", "3").Replace("٤", "4").Replace("٥", "5").Replace("٦", "6").Replace("٧", "7").Replace("٨", "8").Replace("٩", "9"), "Latin1_General_100_CI_AI").Contains(term));
        }
        if (after is not null) query = query.Where(u => string.Compare(u.Id, after) > 0);
        return query;
    }
}
