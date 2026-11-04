using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditPurchaseScopeUse
{
    public string ScopeId{get;set;}="";public string ApplicationId{get;set;}="";public string OrderId{get;set;}="";public string CreditQuoteId{get;set;}="";public string QuoteFingerprint{get;set;}="";public string ActorId{get;set;}="";public long AssessedAmountRial{get;set;}public DateTimeOffset At{get;set;}
}
internal static class CreditPurchaseUseModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditPurchaseScopeUse>(e=>{
            e.ToTable("PurchaseScopeUses",t=>{t.HasCheckConstraint("CK_CreditScopeUse_Amount","[AssessedAmountRial]>=0");t.HasCheckConstraint("CK_CreditScopeUse_Time","DATEPART(TZOFFSET,[At])=0");t.HasCheckConstraint("CK_CreditScopeUse_Identity","LEN([ScopeId])=32 AND LEN([ApplicationId])=32 AND LEN([OrderId])=32 AND LEN([CreditQuoteId])=32 AND LEN([QuoteFingerprint])=64 AND LEN([ActorId]) BETWEEN 1 AND 64");});
            e.HasKey(x=>x.ScopeId);foreach(var n in new[]{"ScopeId","ApplicationId","OrderId","CreditQuoteId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.QuoteFingerprint).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);
            e.HasIndex(x=>x.OrderId).IsUnique();e.HasIndex(x=>x.CreditQuoteId).IsUnique();
            // Credit owns this FK. The order identity crosses modules only via
            // SharedKernel and the same root transaction, not SalesDbContext.
            e.HasOne<CreditPurchaseScope>().WithMany().HasForeignKey(x=>new{x.ScopeId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditPurchaseScopeUse> PurchaseScopeUses=>Set<CreditPurchaseScopeUse>();
    private void GuardPurchaseUses()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries<CreditPurchaseScopeUse>().Any(e=>e.State is EntityState.Modified or EntityState.Deleted))throw CreditApplicationRules.Immutable();
        foreach(var e in ChangeTracker.Entries<CreditPurchaseScopeUse>().Where(e=>e.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.ScopeId);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.OrderId);CreditApplicationRules.Id(x.CreditQuoteId);CreditApplicationRules.Digest(x.QuoteFingerprint);
            if(x.AssessedAmountRial<0||x.At.Offset!=TimeSpan.Zero||x.ActorId!=CreditApplicationRules.Actor(x.ActorId))throw CreditPurchaseScopeRules.Invalid();
        }
    }
}
