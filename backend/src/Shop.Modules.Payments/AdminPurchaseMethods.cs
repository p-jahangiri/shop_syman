using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Payments;
public sealed record AdminMethodRow(string Id,string NameFa,string NameEn,string Kind,bool Enabled,bool RequiresApproval,int CategoryCount);
public sealed record AdminMethodPage(int SchemaVersion,int PageSize,AdminMethodRow[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record AdminMethodData(string Id,string NameFa,string NameEn,string Kind,string DescriptionFa,string DescriptionEn,bool Enabled,bool RequiresApproval,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MinAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MaxAmountRial,string[] CategoryIds,string Version);
public sealed record AdminMethodDetail(int SchemaVersion,AdminMethodData Method);
public interface IAdminPurchaseMethods
{
    Task<AdminMethodPage> PageAsync(PurchaseAdminFilter filter,string? cursor,CancellationToken ct);
    Task<AdminMethodDetail> DetailAsync(string id,CancellationToken ct);
    Task<PurchaseCounts> CountsAsync(CancellationToken ct);
}
public sealed class AdminPurchaseMethods(PaymentsDbContext db):IAdminPurchaseMethods
{
    public static IQueryable<PurchaseMethod> Match(PaymentsDbContext db,PurchaseAdminFilter filter,string? after=null)
    {
        var rows=db.Methods.AsNoTracking();
        if(filter.Enabled!="all"){var enabled=filter.Enabled=="true";rows=rows.Where(m=>m.Enabled==enabled);}
        if(filter.Kind!="all")rows=rows.Where(m=>m.Kind==filter.Kind);
        // An unrestricted method also applies to the selected category.
        if(filter.CategoryId is not null)rows=rows.Where(m=>!m.Categories.Any()||m.Categories.Any(c=>c.CategoryId==filter.CategoryId));
        foreach(var word in filter.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))rows=rows.Where(m=>EF.Functions.Collate(EF.Functions.Collate(m.NameFa+" "+m.NameEn+" "+m.Id,"Latin1_General_100_BIN2").Replace("\u064b", "").Replace("\u064c", "").Replace("\u064d", "").Replace("\u064e", "").Replace("\u064f", "").Replace("\u0650", "").Replace("\u0651", "").Replace("\u0652", "").Replace("\u0653", "").Replace("\u0654", "").Replace("\u0655", "").Replace("\u0656", "").Replace("\u0657", "").Replace("\u0658", "").Replace("\u0659", "").Replace("\u065a", "").Replace("\u065b", "").Replace("\u065c", "").Replace("\u065d", "").Replace("\u065e", "").Replace("\u065f", "").Replace("\u0670", "").Replace("\u200c"," ").Replace("ي","ی").Replace("ى","ی").Replace("ك","ک").Replace("۰","0").Replace("۱","1").Replace("۲","2").Replace("۳","3").Replace("۴","4").Replace("۵","5").Replace("۶","6").Replace("۷","7").Replace("۸","8").Replace("۹","9").Replace("٠","0").Replace("١","1").Replace("٢","2").Replace("٣","3").Replace("٤","4").Replace("٥","5").Replace("٦","6").Replace("٧","7").Replace("٨","8").Replace("٩","9"),"Latin1_General_100_CI_AI").Contains(word));
        if(after is not null)rows=rows.Where(m=>string.Compare(m.Id,after)>0);return rows;
    }
    public static IQueryable<AdminMethodRow> Project(IQueryable<PurchaseMethod> rows)=>rows.Select(m=>new AdminMethodRow(m.Id,m.NameFa,m.NameEn,m.Kind,m.Enabled,m.RequiresApproval,m.Categories.Count));
    public async Task<AdminMethodPage> PageAsync(PurchaseAdminFilter filter,string? cursor,CancellationToken ct){var after=PurchaseAdminPaging.Decode(cursor,filter,"method");var rows=await Project(Match(db,filter,after).OrderBy(m=>m.Id).Take(51)).ToArrayAsync(ct);return new(1,50,rows.Take(50).ToArray(),rows.Length>50?PurchaseAdminPaging.Encode(rows[49].Id,filter,"method"):null);}
    public async Task<AdminMethodDetail> DetailAsync(string id,CancellationToken ct)
    {
        PurchaseAdminFilter.Id(id);var m=await db.Methods.AsNoTracking().SingleOrDefaultAsync(m=>m.Id==id,ct)??throw new BusinessException("not_found","Purchase method was not found.");
        var ids=await db.Set<MethodCategory>().AsNoTracking().Where(c=>c.MethodId==id).OrderBy(c=>c.CategoryId).Select(c=>c.CategoryId).Take(501).ToArrayAsync(ct);if(ids.Length>500)throw new BusinessException("purchase_detail_capacity_unavailable","This record has too many category rules for safe editing.");
        var currentVersion=await db.Methods.Where(x=>x.Id==id).Select(x=>x.Version).SingleOrDefaultAsync(ct);
        if(currentVersion is null||!currentVersion.SequenceEqual(m.Version))throw new BusinessException("version_conflict","Purchase conditions changed while being read. Load the current details.");
        return new(1,new(m.Id,m.NameFa,m.NameEn,m.Kind,m.DescriptionFa,m.DescriptionEn,m.Enabled,m.RequiresApproval,m.MinAmountRial?.ToString(CultureInfo.InvariantCulture),m.MaxAmountRial?.ToString(CultureInfo.InvariantCulture),ids,Convert.ToBase64String(m.Version)));
    }
    public async Task<PurchaseCounts> CountsAsync(CancellationToken ct)=>new((await db.Methods.LongCountAsync(ct)).ToString(CultureInfo.InvariantCulture),(await db.Methods.LongCountAsync(m=>m.Enabled,ct)).ToString(CultureInfo.InvariantCulture));
}
