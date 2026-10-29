using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class AccountingImportBatch
{
    public string Id {get;set;}="";
    public string CompanyKey {get;set;}="";
    public string ExternalWarehouseKey {get;set;}="";
    public string QuantityMeaning {get;set;}="";
    public string PriceCurrency {get;set;}="";
    public DateTimeOffset ObservedAt {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
    public string CreatedBy {get;set;}="";
    public bool IsDemo {get;set;}
    public int RowCount {get;set;}
    public string PayloadHash {get;set;}="";
    public List<AccountingImportRow> Rows {get;set;}=[];
}
public sealed class AccountingImportRow
{
    public string BatchId {get;set;}="";
    public int RowNumber {get;set;}
    public string ExternalItemId {get;set;}="";
    public string? ExternalCode {get;set;}
    public string? ExternalName {get;set;}
    public string ExternalUnitKey {get;set;}="";
    public string? QuantityRaw {get;set;}
    public string? PriceRaw {get;set;}
}
internal static class AccountingImportModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<AccountingImportBatch>(e=>{
            e.ToTable("AccountingImportBatches",t=>{t.HasCheckConstraint("CK_AccountingImport_Count","[RowCount] BETWEEN 1 AND 200");t.HasCheckConstraint("CK_AccountingImport_Meaning","[QuantityMeaning] IN ('physical','available','unknown')");t.HasCheckConstraint("CK_AccountingImport_Currency","[PriceCurrency] IN ('IRR','IRT','unknown')");t.HasCheckConstraint("CK_AccountingImport_Dates","[ObservedAt]<=[CreatedAt]");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalWarehouseKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.QuantityMeaning).HasMaxLength(16);e.Property(x=>x.PriceCurrency).HasMaxLength(8).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.HasIndex(x=>new{x.CompanyKey,x.Id});e.HasMany(x=>x.Rows).WithOne().HasForeignKey(x=>x.BatchId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AccountingImportRow>(e=>{
            e.ToTable("AccountingImportRows",t=>t.HasCheckConstraint("CK_AccountingImportRow_Number","[RowNumber] BETWEEN 1 AND 200"));e.HasKey(x=>new{x.BatchId,x.RowNumber});e.Property(x=>x.BatchId).HasMaxLength(32);e.Property(x=>x.ExternalItemId).HasMaxLength(120).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalCode).HasMaxLength(120);e.Property(x=>x.ExternalName).HasMaxLength(300);e.Property(x=>x.ExternalUnitKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.QuantityRaw).HasMaxLength(64);e.Property(x=>x.PriceRaw).HasMaxLength(64);e.HasIndex(x=>new{x.BatchId,x.ExternalItemId}).IsUnique();
        });
    }
}
public sealed class AccountingImportService(CatalogDbContext db,TimeProvider time,bool demoAllowed):IAccountingImports
{
    private static AccountingImportSummary Summary(AccountingImportBatch b)=>new(b.Id,b.CompanyKey,b.ExternalWarehouseKey,b.QuantityMeaning,b.PriceCurrency,b.ObservedAt,b.CreatedAt,b.IsDemo,b.RowCount,b.PayloadHash);
    public async Task<AccountingImportSaved> StageAsync(string id,AccountingImportInput input,string actorId,CancellationToken ct)
    {
        id=AccountingLinkRules.Id(id);var now=time.GetUtcNow();AccountingImportRules.Validate(input,now,demoAllowed);AccountingLinkRules.Key(actorId,64);
        var transaction=db.Database.CurrentTransaction;
        if(transaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Accounting imports require the root Serializable transaction and audit.");
        await using(var command=db.Database.GetDbConnection().CreateCommand()){
            command.Transaction=transaction.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:catalog:holoo-import:"+id;command.Parameters.Add(p);
            if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("accounting_import_busy_conflict","Retry the same import id after the current command completes.");
        }
        // Own id's application lock protects replay; avoid empty PK range locks
        // between unrelated imports. No Stock or cross-module context is read.
        var existing=await db.AccountingImports.FromSqlInterpolated($"SELECT * FROM [catalog].[AccountingImportBatches] WITH (READCOMMITTEDLOCK) WHERE [Id]={id}").AsNoTracking().SingleOrDefaultAsync(ct);
        var hash=AccountingImportRules.Hash(input);
        if(existing is not null){if(existing.PayloadHash!=hash)throw new BusinessException("accounting_import_identity_conflict","This import id already holds different data. Read it or use a new import id.");return new(1,id,hash,true,false);}
        var entity=new AccountingImportBatch{Id=id,CompanyKey=input.CompanyKey,ExternalWarehouseKey=input.ExternalWarehouseKey,QuantityMeaning=input.QuantityMeaning,PriceCurrency=input.PriceCurrency,ObservedAt=input.ObservedAt,CreatedAt=now,CreatedBy=actorId,IsDemo=input.IsDemo,RowCount=input.Rows.Length,PayloadHash=hash,Rows=input.Rows.Select((x,i)=>new AccountingImportRow{BatchId=id,RowNumber=i+1,ExternalItemId=x.ExternalItemId,ExternalCode=x.ExternalCode,ExternalName=x.ExternalName,ExternalUnitKey=x.ExternalUnitKey,QuantityRaw=x.QuantityRaw,PriceRaw=x.PriceRaw}).ToList()};
        db.AccountingImports.Add(entity);await db.SaveChangesAsync(ct);return new(1,id,hash,false,false);
    }
    public async Task<AccountingImportPage> PageAsync(string? companyKey,string? cursor,CancellationToken ct)
    {
        if(companyKey is not null)AccountingLinkRules.Key(companyKey,64);var filter=PurchaseAdminFilter.Create(null);var scope="accounting-import:holoo:"+companyKey;var after=PurchaseAdminPaging.Decode(cursor,filter,scope);
        var query=db.AccountingImports.AsNoTracking();if(!demoAllowed)query=query.Where(x=>!x.IsDemo);if(companyKey is not null)query=query.Where(x=>x.CompanyKey==companyKey);if(after is not null)query=query.Where(x=>string.Compare(x.Id,after)>0);
        var rows=await query.OrderBy(x=>x.Id).Take(21).ToArrayAsync(ct);var page=rows.Take(20).Select(Summary).ToArray();return new(1,20,page,rows.Length>20?PurchaseAdminPaging.Encode(page[^1].Id,filter,scope):null);
    }
    public async Task<AccountingImportDetail> ReadAsync(string id,CancellationToken ct)
    {
        id=AccountingLinkRules.Id(id);var batch=await db.AccountingImports.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id&&(demoAllowed||!x.IsDemo),ct)??throw new BusinessException("not_found","The staged import was not found.");
        var rows=await db.AccountingImportRows.AsNoTracking().Where(x=>x.BatchId==id).OrderBy(x=>x.RowNumber).Take(201).ToArrayAsync(ct);if(rows.Length!=batch.RowCount)throw new BusinessException("accounting_import_unavailable","The complete staged import could not be read.");
        var original=new AccountingImportInput(1,batch.CompanyKey,batch.ExternalWarehouseKey,batch.QuantityMeaning,batch.PriceCurrency,batch.ObservedAt,batch.IsDemo,rows.Select(x=>new AccountingImportRowInput(x.ExternalItemId,x.ExternalCode,x.ExternalName,x.ExternalUnitKey,x.QuantityRaw,x.PriceRaw)).ToArray());
        if(rows.Where((row,index)=>row.RowNumber!=index+1).Any()||AccountingImportRules.Hash(original)!=batch.PayloadHash)throw new BusinessException("accounting_import_unavailable","The staged facts no longer match the complete immutable input hash.");
        var keys=rows.Select(x=>x.ExternalItemId).ToArray();
        var matches=await(from l in db.AccountingLinks.AsNoTracking() join v in db.Variants.AsNoTracking() on l.VariantId equals v.Id join p in db.Products.AsNoTracking() on v.ProductId equals p.Id where l.Provider=="holoo"&&l.CompanyKey==batch.CompanyKey&&l.IsActive&&keys.Contains(l.ExternalItemId) select new{l.ExternalItemId,l.Id,l.Version,VariantId=v.Id,v.Sku,v.PriceRial,v.IsActive,p.IsDigital,p.Status,NameFa=p.Translations.Where(t=>t.Locale=="fa").Select(t=>t.Name).FirstOrDefault()??p.Slug,NameEn=p.Translations.Where(t=>t.Locale=="en").Select(t=>t.Name).FirstOrDefault()??p.Slug}).ToArrayAsync(ct);
        var lookup=matches.ToDictionary(x=>x.ExternalItemId,StringComparer.Ordinal);
        var result=rows.Select(row=>{
            var v=AccountingImportRules.Inspect(row.QuantityRaw,row.PriceRaw,batch.QuantityMeaning,batch.PriceCurrency);var issues=v.Issues.ToList();AccountingImportMatch? match=null;string? difference=null;
            if(!lookup.TryGetValue(row.ExternalItemId,out var current))issues.Add("item_mapping_required");
            else{
                match=new(current.Id,Convert.ToBase64String(current.Version),current.VariantId,current.Sku,current.NameFa,current.NameEn,current.PriceRial.ToString(CultureInfo.InvariantCulture),current.IsActive,current.IsDigital,current.Status);
                if(!current.IsActive||current.IsDigital)issues.Add("mapped_sku_not_eligible");
                if(v.PriceRial is not null)difference=(long.Parse(v.PriceRial,CultureInfo.InvariantCulture)-current.PriceRial).ToString(CultureInfo.InvariantCulture);
            }
            return new AccountingImportRowDto(row.RowNumber,row.ExternalItemId,row.ExternalCode,row.ExternalName,row.ExternalUnitKey,row.QuantityRaw,row.PriceRaw,v.Quantity,v.PriceRial,match,difference,issues.ToArray());
        }).ToArray();return new(1,Summary(batch),result,false,false);
    }
}
