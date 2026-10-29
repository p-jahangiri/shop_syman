using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;
public sealed class ChequeReviewHoldPolicy{public int Id{get;set;}=1;public string? PublishedRevisionId{get;set;}public byte[] Version{get;set;}=[];}
public sealed class ChequeReviewHoldRevision
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public int PolicyId{get;set;}=1;public int Revision{get;set;}public bool Enabled{get;set;}public int? Minutes{get;set;}public string ActorId{get;set;}="";public DateTimeOffset CreatedAt{get;set;}
}
public sealed class ChequeReviewHoldCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public int PolicyId{get;set;}=1;public string RevisionId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public string ResultJson{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CreditOrderReviewHold
{
    public string OrderId{get;set;}="";public string PolicyRevisionId{get;set;}="";public string PolicyVersion{get;set;}="";public int Minutes{get;set;}public DateTimeOffset QuoteExpiresAt{get;set;}public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset ExpiresAt{get;set;}
}
internal static class ChequeReviewHoldModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ChequeReviewHoldPolicy>(e=>{e.ToTable("ChequeReviewHoldPolicies",t=>t.HasCheckConstraint("CK_ChequeReviewHoldPolicy_Singleton","[Id]=1"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).ValueGeneratedNever();e.Property(x=>x.PublishedRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Version).IsRowVersion();e.HasOne<ChequeReviewHoldRevision>().WithMany().HasForeignKey(x=>new{x.Id,x.PublishedRevisionId}).HasPrincipalKey(x=>new{x.PolicyId,x.Id}).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<ChequeReviewHoldRevision>(e=>{e.ToTable("ChequeReviewHoldRevisions",t=>{t.HasCheckConstraint("CK_ChequeReviewHoldRevision_Facts","[PolicyId]=1 AND [Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[CreatedAt])=0");t.HasCheckConstraint("CK_ChequeReviewHoldRevision_Limit","([Enabled]=1 AND [Minutes] IS NOT NULL AND [Minutes] BETWEEN 1 AND 60) OR ([Enabled]=0 AND [Minutes] IS NULL)");});e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.PolicyId,x.Id});e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.HasIndex(x=>new{x.PolicyId,x.Revision}).IsUnique();e.HasOne<ChequeReviewHoldPolicy>().WithMany().HasForeignKey(x=>x.PolicyId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<ChequeReviewHoldCommand>(e=>{e.ToTable("ChequeReviewHoldCommands",t=>t.HasCheckConstraint("CK_ChequeReviewHoldCommand_Facts","[PolicyId]=1 AND DATALENGTH([ResultJson]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[At])=0"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var n in new[]{"CommandId","RevisionId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(4096);e.HasIndex(x=>x.RevisionId).IsUnique();e.HasOne<ChequeReviewHoldRevision>().WithMany().HasForeignKey(x=>new{x.PolicyId,x.RevisionId}).HasPrincipalKey(x=>new{x.PolicyId,x.Id}).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<CreditOrderReviewHold>(e=>{e.ToTable("CreditOrderReviewHolds",t=>t.HasCheckConstraint("CK_CreditOrderReviewHold_Facts","[Minutes] BETWEEN 1 AND 60 AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[QuoteExpiresAt])=0 AND DATEPART(TZOFFSET,[ExpiresAt])=0 AND [CreatedAt]<[QuoteExpiresAt] AND [CreatedAt]<[ExpiresAt] AND [ExpiresAt]<=DATEADD(MINUTE,[Minutes],[CreatedAt])"));e.HasKey(x=>x.OrderId);e.Property(x=>x.OrderId).HasMaxLength(32);e.Property(x=>x.PolicyRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PolicyVersion).HasMaxLength(12).IsUnicode(false);e.HasOne<SalesOrder>().WithOne().HasForeignKey<CreditOrderReviewHold>(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);e.HasOne<ChequeReviewHoldRevision>().WithMany().HasForeignKey(x=>x.PolicyRevisionId).OnDelete(DeleteBehavior.Restrict);});
    }
}
public sealed partial class SalesDbContext
{
    public DbSet<ChequeReviewHoldPolicy> ChequeReviewHoldPolicies=>Set<ChequeReviewHoldPolicy>();public DbSet<ChequeReviewHoldRevision> ChequeReviewHoldRevisions=>Set<ChequeReviewHoldRevision>();public DbSet<ChequeReviewHoldCommand> ChequeReviewHoldCommands=>Set<ChequeReviewHoldCommand>();public DbSet<CreditOrderReviewHold> CreditOrderReviewHolds=>Set<CreditOrderReviewHold>();
    private void GuardChequeReviewHold()
    {
        foreach(var e in ChangeTracker.Entries()){
            if((e.Entity is ChequeReviewHoldRevision or ChequeReviewHoldCommand or CreditOrderReviewHold)&&(e.State is EntityState.Modified or EntityState.Deleted))throw ChequeReviewHoldRules.Immutable();
            if(e.Entity is ChequeReviewHoldPolicy&&(e.State==EntityState.Deleted||e.State==EntityState.Modified&&e.Properties.Any(x=>x.IsModified&&x.Metadata.Name!="PublishedRevisionId")))throw ChequeReviewHoldRules.Immutable();
            if(e.Entity is ChequeReviewHoldPolicy policy&&e.State==EntityState.Modified&&!ChangeTracker.Entries<ChequeReviewHoldRevision>().Any(x=>x.State==EntityState.Added&&x.Entity.Id==policy.PublishedRevisionId))throw ChequeReviewHoldRules.Immutable();
            if(e.Entity is ChequeReviewHoldCommand cmd&&e.State==EntityState.Added){ChequeReviewHoldRules.Id(cmd.CommandId);ChequeReviewHoldRules.Id(cmd.RevisionId);CreditCheckoutQuoteRules.Owner(cmd.ActorId);if(cmd.PolicyId!=1||cmd.PayloadHash.Length!=64||cmd.ResultHash.Length!=64||cmd.ResultJson.Length is<1 or>4096||cmd.At.Offset!=TimeSpan.Zero)throw ChequeReviewHoldRules.Invalid();}
            if(e.Entity is ChequeReviewHoldRevision r&&e.State==EntityState.Added){ChequeReviewHoldRules.Id(r.Id);CreditCheckoutQuoteRules.Owner(r.ActorId);if(r.PolicyId!=1||r.Revision is<1 or>10000||r.CreatedAt.Offset!=TimeSpan.Zero||(r.Enabled?r.Minutes is not(>=1 and<=60):r.Minutes is not null))throw ChequeReviewHoldRules.Invalid();}
            if(e.Entity is CreditOrderReviewHold h&&e.State==EntityState.Added){ChequeReviewHoldRules.Id(h.OrderId);ChequeReviewHoldRules.Id(h.PolicyRevisionId);ChequeReviewHoldRules.Version(h.PolicyVersion);if(h.Minutes is<1 or>60||h.CreatedAt.Offset!=TimeSpan.Zero||h.ExpiresAt.Offset!=TimeSpan.Zero||h.QuoteExpiresAt.Offset!=TimeSpan.Zero||h.CreatedAt>=h.ExpiresAt||h.CreatedAt>=h.QuoteExpiresAt||h.ExpiresAt>h.CreatedAt.AddMinutes(h.Minutes))throw ChequeReviewHoldRules.Invalid();}
        }
    }
}
