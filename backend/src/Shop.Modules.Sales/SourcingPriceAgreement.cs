using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// Private accepted-price authority. It never edits Catalog prices or creates an
// order. Stock entitlement remains in Inventory and is read separately.
public sealed class SourcingPriceAgreement
{
    public string Id { get; set; }="";
    public string RequestId { get; set; }="";
    public string TaskId { get; set; }="";
    public string OfferId { get; set; }="";
    public int Revision { get; set; }
    public string AcceptanceId { get; set; }="";
    public string OwnerId { get; set; }="";
    public string TermsHash { get; set; }="";
    public string SnapshotHash { get; set; }="";
    public string TermsFa { get; set; }="";
    public string TermsEn { get; set; }="";
    public DateTimeOffset PurchaseUntil { get; set; }
    public string AllocationId { get; set; }="";
    public string State { get; set; }="Active";
    public string? ConsumedOrderId { get; set; }
    public bool ContainsDemo { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public byte[] Version { get; set; }=[];
    public List<SourcingPriceAgreementLine> Lines { get; set; }=[];
}
public sealed class SourcingPriceAgreementLine
{
    public string AgreementId { get; set; }="";
    public string Id { get; set; }="";
    public string OfferLineId { get; set; }="";
    public string ListingId { get; set; }="";
    public string VariantId { get; set; }="";
    public int Quantity { get; set; }
    public long UnitPriceRial { get; set; }
    public long LineTotalRial { get; set; }
    public string SkuSnapshotJson { get; set; }="";
}
public sealed record SourcingPriceAgreementLineData(string Id,string OfferLineId,string ListingId,int Quantity,string UnitPriceRial,string LineTotalRial,OfferSkuSnapshot Sku);
public sealed record SourcingPriceAgreementData(int SchemaVersion,string Id,string RequestId,string TaskId,string OfferId,int Revision,string AcceptanceId,string TermsHash,string AllocationId,string State,string EffectiveState,string Version,string TermsFa,string TermsEn,DateTimeOffset PurchaseUntil,bool IsDemo,SourcingPriceAgreementLineData[] Lines,bool CanPay=false);

public static class SourcingPriceAgreementRules
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=32};
    public static string Id(string? id)=>id is {Length:32}&&id.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f')&&Guid.TryParseExact(id,"N",out var value)&&value!=Guid.Empty?id:throw Invalid();
    public static long Price(string? value)=>value is {Length:>0 and <=19}&&value.All(char.IsAsciiDigit)&&long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var n)&&n>=0&&n.ToString(CultureInfo.InvariantCulture)==value?n:throw Invalid();
    public static string LineId(string acceptanceId,string offerLineId)=>Hash("agreement-line:"+Id(acceptanceId)+":"+Id(offerLineId))[..32].ToLowerInvariant();
    public static long Total(AcceptedSourcingPlanLine[] lines){try{return lines.Aggregate(0L,(sum,l)=>checked(sum+checked(l.Quantity*Price(l.UnitPriceRial))));}catch(OverflowException){throw new BusinessException("sourcing_agreement_amount_limit","The accepted agreement exceeds integer rial capacity.");}}
    public static string SnapshotHash(AcceptedSourcingPurchasePlan plan)
    {
        Validate(plan);
        // Live request/task versions and later allocation ids are not accepted
        // commercial terms. A public price change cannot replace this snapshot.
        var json=JsonSerializer.Serialize(new{plan.RequestId,plan.TaskId,plan.OfferId,plan.Revision,plan.AcceptanceId,plan.OwnerId,plan.TermsHash,plan.PurchaseUntil,plan.TermsFa,plan.TermsEn,plan.ContainsDemo,Lines=plan.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal)},Json);
        if(Encoding.UTF8.GetByteCount(json)>1048576)throw new BusinessException("sourcing_agreement_capacity_unavailable","The accepted agreement snapshot is too large.");return Hash(json);
    }
    public static void Validate(AcceptedSourcingPurchasePlan plan)
    {
        if(plan is null)throw Invalid();Id(plan.RequestId);Id(plan.TaskId);Id(plan.OfferId);Id(plan.AcceptanceId);
        if(string.IsNullOrEmpty(plan.OwnerId)||plan.OwnerId.Length>64||plan.OwnerId.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_'))||plan.Revision<1||plan.TermsHash is not {Length:64}||!plan.TermsHash.All(Uri.IsHexDigit)||plan.PurchaseUntil.Offset!=TimeSpan.Zero||string.IsNullOrWhiteSpace(plan.TermsFa)||string.IsNullOrWhiteSpace(plan.TermsEn)||plan.TermsFa.Length>4000||plan.TermsEn.Length>4000||plan.Lines is not {Length:>0 and <=64}||plan.Lines.Any(l=>l is null)||plan.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=plan.Lines.Length)throw Invalid();
        foreach(var line in plan.Lines){Id(line.OfferLineId);Id(line.ListingId);if(line.Quantity is <1 or >1000000||line.Sku is null||string.IsNullOrEmpty(line.Sku.VariantId)||line.Sku.VariantId.Length>64||line.Sku.VariantId.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();Price(line.UnitPriceRial);}
        Total(plan.Lines);
    }
    internal static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static BusinessException Invalid()=>new("invalid_sourcing_agreement","Use exact bounded server-side accepted terms and canonical integer rial amounts.");
}
public static class SourcingPriceAgreementModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingPriceAgreement>(e=>{
            e.ToTable("SourcingPriceAgreements",t=>{t.HasCheckConstraint("CK_SourcingAgreement_State","[State] IN ('Active','Revoked','Consumed')");t.HasCheckConstraint("CK_SourcingAgreement_Revision","[Revision]>0");t.HasCheckConstraint("CK_SourcingAgreement_Order","([State]='Consumed' AND [ConsumedOrderId] IS NOT NULL) OR ([State] IN ('Active','Revoked') AND [ConsumedOrderId] IS NULL)");});
            e.HasKey(x=>x.Id);foreach(var name in new[]{"Id","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","ConsumedOrderId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.SnapshotHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.TermsFa).HasMaxLength(4000);e.Property(x=>x.TermsEn).HasMaxLength(4000);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>x.AcceptanceId).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.RequestId,x.TaskId});e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.AgreementId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingPriceAgreementLine>(e=>{
            e.ToTable("SourcingPriceAgreementLines",t=>{t.HasCheckConstraint("CK_SourcingAgreementLine_Amount","[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");t.HasCheckConstraint("CK_SourcingAgreementLine_Snapshot","ISJSON([SkuSnapshotJson])=1 AND DATALENGTH([SkuSnapshotJson])<=2097152");});
            e.HasKey(x=>new{x.AgreementId,x.Id});foreach(var name in new[]{"AgreementId","Id","OfferLineId","ListingId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.VariantId).HasMaxLength(64);e.HasIndex(x=>new{x.AgreementId,x.OfferLineId}).IsUnique();
        });
    }
}
public sealed class SourcingPriceAgreementService(SalesDbContext db,TimeProvider clock,bool allowDemo)
{
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Accepted-price commands require the shared Serializable root transaction.");}
    public async Task LockAsync(string acceptanceId,CancellationToken ct)
    {
        RequireTransaction();var id=SourcingPriceAgreementRules.Id(acceptanceId);await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;c.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=c.CreateParameter();p.ParameterName="@resource";p.Value="sayman:sales:sourcing-agreement:"+id;c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("sourcing_agreement_busy_conflict","The accepted agreement is being updated. Retry the same command.");
    }
    public async Task EnsureForAllocationAsync(AcceptedSourcingPurchasePlan plan,string allocationId,CancellationToken ct)
    {
        RequireTransaction();var snapshot=SourcingPriceAgreementRules.SnapshotHash(plan);SourcingPriceAgreementRules.Id(allocationId);if(plan.ContainsDemo&&!allowDemo)throw Missing();await LockAsync(plan.AcceptanceId,ct);
        // Write-intent before insertion avoids shared gap -> X lock conversion.
        var row=await db.Set<SourcingPriceAgreement>().FromSqlInterpolated($"SELECT * FROM [sales].[SourcingPriceAgreements] WITH (UPDLOCK,HOLDLOCK) WHERE [AcceptanceId]={plan.AcceptanceId}").SingleOrDefaultAsync(ct);
        if(row is not null){await db.Entry(row).ReloadAsync(ct);if(row.State!="Active"||row.ConsumedOrderId is not null)throw Consumed();if(row.SnapshotHash!=snapshot||row.OwnerId!=plan.OwnerId||row.RequestId!=plan.RequestId||row.TaskId!=plan.TaskId)throw new BusinessException("sourcing_agreement_terms_conflict","The immutable accepted price agreement differs from this plan.");row.AllocationId=allocationId;row.ChangedAt=clock.GetUtcNow();db.Entry(row).Property(x=>x.ChangedAt).IsModified=true;}
        else{
            var now=clock.GetUtcNow();row=new(){Id=plan.AcceptanceId,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,Revision=plan.Revision,AcceptanceId=plan.AcceptanceId,OwnerId=plan.OwnerId,TermsHash=plan.TermsHash,SnapshotHash=snapshot,TermsFa=plan.TermsFa,TermsEn=plan.TermsEn,PurchaseUntil=plan.PurchaseUntil,AllocationId=allocationId,ContainsDemo=plan.ContainsDemo,CreatedAt=now,ChangedAt=now};
            row.Lines=plan.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingPriceAgreementLine{AgreementId=row.Id,Id=SourcingPriceAgreementRules.LineId(plan.AcceptanceId,l.OfferLineId),OfferLineId=l.OfferLineId,ListingId=l.ListingId,VariantId=l.Sku.VariantId,Quantity=l.Quantity,UnitPriceRial=SourcingPriceAgreementRules.Price(l.UnitPriceRial),LineTotalRial=checked(l.Quantity*SourcingPriceAgreementRules.Price(l.UnitPriceRial)),SkuSnapshotJson=JsonSerializer.Serialize(l.Sku,SourcingPriceAgreementRules.Json)}).ToList();db.Add(row);
        }
        if(plan.PurchaseUntil<=clock.GetUtcNow())throw new BusinessException("sourcing_agreement_expired_conflict","The accepted price has expired.");await db.SaveChangesAsync(ct);
    }
    public async Task AssertReleaseAllowedAsync(string acceptanceId,string requestId,string taskId,CancellationToken ct)
    {
        await LockAsync(acceptanceId,ct);var row=await db.Set<SourcingPriceAgreement>().FromSqlInterpolated($"SELECT * FROM [sales].[SourcingPriceAgreements] WITH (UPDLOCK,HOLDLOCK) WHERE [AcceptanceId]={acceptanceId}").SingleOrDefaultAsync(ct)??throw Missing();await db.Entry(row).ReloadAsync(ct);
        if(row.RequestId!=requestId||row.TaskId!=taskId)throw Missing();if(row.State=="Consumed"||row.ConsumedOrderId is not null)throw Consumed();
    }
    internal async Task ConsumeForOrderAsync(string owner,PreparedQuoteAgreementV5[] prepared,string orderId,CancellationToken ct)
    {
        RequireTransaction();SourcingPriceAgreementRules.Id(orderId);
        foreach(var p in prepared.OrderBy(p=>p.Agreement.AcceptanceId,StringComparer.Ordinal)){
            await LockAsync(p.Agreement.AcceptanceId,ct);
            var id=p.Agreement.Id;var row=await db.SourcingPriceAgreements.FromSqlInterpolated($"SELECT * FROM [sales].[SourcingPriceAgreements] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").SingleOrDefaultAsync(ct)??throw Missing();
            await db.Entry(row).ReloadAsync(ct);
            if(!row.OwnerId.Equals(owner,StringComparison.OrdinalIgnoreCase)||row.ContainsDemo&&!allowDemo)throw Missing();
            if(row.State!="Active"||row.ConsumedOrderId is not null)throw Consumed();
            if(!row.Version.SequenceEqual(p.Agreement.Version)||row.AllocationId!=p.Agreement.AllocationId||row.SnapshotHash!=p.Agreement.SnapshotHash||row.TermsHash!=p.Agreement.TermsHash)throw CheckoutQuoteV4Rules.Changed();
            if(row.PurchaseUntil<=clock.GetUtcNow())throw CheckoutQuoteV4Rules.Expired();
            row.State="Consumed";row.ConsumedOrderId=orderId;row.ChangedAt=clock.GetUtcNow();
        }
        await db.SaveChangesAsync(ct);
    }
    public async Task BeforeCloseAsync(string acceptanceId,string requestId,string taskId,CancellationToken ct)
    {
        await LockAsync(acceptanceId,ct);var row=await db.Set<SourcingPriceAgreement>().FromSqlInterpolated($"SELECT * FROM [sales].[SourcingPriceAgreements] WITH (UPDLOCK,HOLDLOCK) WHERE [AcceptanceId]={acceptanceId}").SingleOrDefaultAsync(ct);if(row is null)return;await db.Entry(row).ReloadAsync(ct);
        if(row.RequestId!=requestId||row.TaskId!=taskId)throw new InvalidOperationException("Agreement close target mismatch.");if(row.State=="Consumed"||row.ConsumedOrderId is not null)throw Consumed();if(row.State=="Revoked")return;row.State="Revoked";row.ChangedAt=clock.GetUtcNow();await db.SaveChangesAsync(ct);
    }
    public async Task<SourcingPriceAgreementData> ReadAsync(string agreementId,string requestId,string? ownerId,CancellationToken ct)
    {
        agreementId=SourcingPriceAgreementRules.Id(agreementId);requestId=SourcingPriceAgreementRules.Id(requestId);var row=await db.Set<SourcingPriceAgreement>().AsNoTracking().Include(x=>x.Lines.OrderBy(l=>l.Id).Take(65)).SingleOrDefaultAsync(x=>x.Id==agreementId&&x.RequestId==requestId&&(ownerId==null||x.OwnerId==ownerId)&&(allowDemo||!x.ContainsDemo),ct)??throw Missing();
        if(row.Lines.Count is <1 or >64)throw new BusinessException("sourcing_agreement_capacity_unavailable","The accepted agreement is outside supported bounds.");
        var lines=row.Lines.OrderBy(x=>x.Id,StringComparer.Ordinal).Select(x=>new SourcingPriceAgreementLineData(x.Id,x.OfferLineId,x.ListingId,x.Quantity,x.UnitPriceRial.ToString(CultureInfo.InvariantCulture),x.LineTotalRial.ToString(CultureInfo.InvariantCulture),JsonSerializer.Deserialize<OfferSkuSnapshot>(x.SkuSnapshotJson,SourcingPriceAgreementRules.Json)??throw new InvalidOperationException("Invalid accepted SKU snapshot."))).ToArray();
        return new(1,row.Id,row.RequestId,row.TaskId,row.OfferId,row.Revision,row.AcceptanceId,row.TermsHash,row.AllocationId,row.State,row.State=="Active"&&row.PurchaseUntil<=clock.GetUtcNow()?"Expired":row.State,Convert.ToBase64String(row.Version),row.TermsFa,row.TermsEn,row.PurchaseUntil,row.ContainsDemo,lines);
    }
    private static BusinessException Missing()=>new("not_found","Accepted price agreement not found.");
    private static BusinessException Consumed()=>new("sourcing_agreement_consumed_conflict","This accepted agreement was consumed or revoked; use its actual order or a new offer.");
}
