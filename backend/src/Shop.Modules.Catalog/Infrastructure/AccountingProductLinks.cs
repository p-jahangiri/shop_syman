using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;
public sealed class AccountingProductLink
{
    public string Id {get;set;}="";
    public string Provider {get;set;}="holoo";
    public string CompanyKey {get;set;}="";
    public string ExternalItemId {get;set;}="";
    public string? ExternalCode {get;set;}
    public string VariantId {get;set;}="";
    public bool IsActive {get;set;}
    public string SearchText {get;set;}="";
    public string CreatedBy {get;set;}="";
    public string ChangedBy {get;set;}="";
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public byte[] Version {get;set;}=[];
}
internal static class AccountingLinkModel
{
    internal static void Configure(ModelBuilder b)=>b.Entity<AccountingProductLink>(e=>{
        e.ToTable("AccountingProductLinks",t=>t.HasCheckConstraint("CK_AccountingLink_Provider","[Provider]='holoo'"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);
        e.Property(x=>x.Provider).HasMaxLength(16);e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalItemId).HasMaxLength(120).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalCode).HasMaxLength(120);
        e.Property(x=>x.VariantId).HasMaxLength(64);e.Property(x=>x.SearchText).HasMaxLength(500);e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.ChangedBy).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();
        e.HasIndex(x=>new{x.Provider,x.CompanyKey,x.ExternalItemId}).IsUnique();e.HasIndex(x=>new{x.Provider,x.CompanyKey,x.VariantId}).IsUnique().HasFilter("[IsActive] = 1");e.HasIndex(x=>new{x.Provider,x.Id});e.HasOne<ProductVariant>().WithMany().HasForeignKey(x=>x.VariantId).OnDelete(DeleteBehavior.Restrict);
    });
}
public sealed partial class CatalogService:IAccountingCatalogLinks
{
    private sealed class AccountingRow
    {
        public required AccountingProductLink Link {get;init;}
        public required string Sku {get;init;}
        public required string ProductId {get;init;}
        public required string NameFa {get;init;}
        public required string NameEn {get;init;}
    }
    private IQueryable<AccountingRow> AccountingRows=>from link in db.AccountingLinks.AsNoTracking() join variant in db.Variants.AsNoTracking() on link.VariantId equals variant.Id join product in db.Products.AsNoTracking() on variant.ProductId equals product.Id where link.Provider=="holoo" select new AccountingRow{Link=link,Sku=variant.Sku,ProductId=product.Id,NameFa=product.Translations.Where(t=>t.Locale=="fa").Select(t=>t.Name).FirstOrDefault()??product.Slug,NameEn=product.Translations.Where(t=>t.Locale=="en").Select(t=>t.Name).FirstOrDefault()??product.Slug};
    private static AccountingProductLinkDto AccountingDto(AccountingRow row)=>new(row.Link.Id,row.Link.CompanyKey,row.Link.ExternalItemId,row.Link.ExternalCode,row.Link.VariantId,row.Sku,row.ProductId,row.NameFa,row.NameEn,row.Link.IsActive,Convert.ToBase64String(row.Link.Version));
    public async Task<AccountingLinkPage> PageAsync(string? companyKey,string? query,string? enabled,string? cursor,CancellationToken ct)
    {
        if(companyKey is not null)AccountingLinkRules.Key(companyKey,64);var filter=PurchaseAdminFilter.Create(query,enabled);var scope="accounting:holoo:"+companyKey;var after=PurchaseAdminPaging.Decode(cursor,filter,scope);
        var links=db.AccountingLinks.AsNoTracking().Where(l=>l.Provider=="holoo");if(companyKey is not null)links=links.Where(l=>l.CompanyKey==companyKey);if(filter.Enabled!="all")links=links.Where(l=>l.IsActive==(filter.Enabled=="true"));
        if(filter.Search.Length>0)links=links.Where(l=>l.SearchText.Contains(filter.Search)||db.Variants.Any(v=>v.Id==l.VariantId&&v.SearchSku.Contains(filter.Search)));
        if(after is not null)links=links.Where(l=>string.Compare(l.Id,after)>0);var rows=await AccountingRows.Where(row=>links.Any(link=>link.Id==row.Link.Id)).OrderBy(row=>row.Link.Id).Take(51).ToArrayAsync(ct);var page=rows.Take(50).Select(AccountingDto).ToArray();
        return new(1,50,page,rows.Length>50?PurchaseAdminPaging.Encode(page[^1].Id,filter,scope):null);
    }
    public async Task<AccountingProductLinkDto> DetailAsync(string id,CancellationToken ct){id=AccountingLinkRules.Id(id);var row=await AccountingRows.SingleOrDefaultAsync(l=>l.Link.Id==id,ct)??throw new BusinessException("not_found","The accounting product link was not found.");return AccountingDto(row);}
    public async Task<AccountingVariantChoice[]> VariantsAsync(string? query,CancellationToken ct)
    {
        var filter=PurchaseAdminFilter.Create(query);if(filter.Search.Length<2)return [];
        return await (from v in db.Variants.AsNoTracking() join p in db.Products.AsNoTracking() on v.ProductId equals p.Id where !p.IsDigital&&(v.SearchSku.Contains(filter.Search)||p.Translations.Any(t=>t.SearchName.Contains(filter.Search))) orderby v.Sku,v.Id select new AccountingVariantChoice(v.Id,v.Sku,p.Id,p.Translations.Where(t=>t.Locale=="fa").Select(t=>t.Name).FirstOrDefault()??p.Slug,p.Translations.Where(t=>t.Locale=="en").Select(t=>t.Name).FirstOrDefault()??p.Slug,v.IsActive)).Take(20).ToArrayAsync(ct);
    }
    public async Task<string> SaveAsync(string id,AccountingProductLinkInput input,string actorId,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Accounting links require the root Serializable transaction.");
        id=AccountingLinkRules.Id(id);AccountingLinkRules.Validate(input);if(string.IsNullOrEmpty(actorId)||actorId.Length>64)throw new BusinessException("invalid_credentials","The staff identity is missing.");
        var row=await db.AccountingLinks.SingleOrDefaultAsync(l=>l.Id==id,ct);
        if(row is not null){
            if(row.Provider!="holoo"||row.CompanyKey!=input.CompanyKey||row.ExternalItemId!=input.ExternalItemId)throw new BusinessException("accounting_identity_conflict","A link's company and stable external item cannot be moved. Deactivate it and create another link.");
            if(input.Version is null){if(row.ExternalCode==input.ExternalCode&&row.VariantId==input.VariantId&&row.IsActive==input.IsActive)return row.Id;throw new BusinessException("version_conflict","A link with this id already exists. Read its current version.");}
            CatalogRules.Version(row.Version,input.Version);
        }else if(input.Version is not null)throw new BusinessException("version_conflict","The accounting link no longer exists.");
        var target=await db.Variants.Where(v=>v.Id==input.VariantId).Select(v=>new{v.IsActive,Digital=db.Products.Where(p=>p.Id==v.ProductId).Select(p=>p.IsDigital).Single()}).SingleOrDefaultAsync(ct);
        // An existing link must remain safely removable after a SKU is disabled or
        // legacy data makes its product digital. This exception never permits a
        // new or retargeted digital mapping, or reactivation of an invalid target.
        var safeDeactivation=row is not null&&row.VariantId==input.VariantId&&!input.IsActive;
        if(target is null||!safeDeactivation&&(target.Digital||input.IsActive&&!target.IsActive))throw new BusinessException("invalid_accounting_link","Choose an existing physical SKU; active mappings require an active SKU.");
        var now=time.GetUtcNow();if(row is null){row=new(){Id=id,CompanyKey=input.CompanyKey,ExternalItemId=input.ExternalItemId,CreatedBy=actorId,CreatedAt=now};db.AccountingLinks.Add(row);}
        row.ExternalCode=input.ExternalCode;row.VariantId=input.VariantId;row.IsActive=input.IsActive;row.SearchText=PersianText.Normalize(input.ExternalItemId+" "+(input.ExternalCode??""));row.ChangedBy=actorId;row.ChangedAt=now;db.Entry(row).Property(x=>x.ChangedAt).IsModified=true;
        await db.SaveChangesAsync(ct);return id;
    }
}
