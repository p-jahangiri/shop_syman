using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditReminderPolicyRevision
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public int Revision{get;set;}public bool Enabled{get;set;}public string? SendAt{get;set;}public string ActorId{get;set;}="";public DateTimeOffset At{get;set;}public byte[] Version{get;set;}=[];public byte[] ProtectedData{get;set;}=[];
    public List<CreditReminderPolicyOffset> Offsets{get;set;}=[];
}
public sealed class CreditReminderPolicyOffset{public string RevisionId{get;set;}="";public int Days{get;set;}}
public sealed class CreditReminderPolicyCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string RevisionId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class CreditReminderPolicyModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditReminderPolicyRevision>(e=>{
            e.ToTable("ReminderPolicyRevisions",t=>{t.HasCheckConstraint("CK_ReminderPolicyRevision_Facts","[Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedData]) BETWEEN 1 AND 8192");t.HasCheckConstraint("CK_ReminderPolicyRevision_Time","([Enabled]=0 AND [SendAt] IS NULL) OR ([Enabled]=1 AND LEN([SendAt])=5 AND [SendAt] LIKE '[0-2][0-9]:[0-5][0-9]' AND [SendAt]<'24:00')");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.SendAt).HasMaxLength(5).IsUnicode(false);e.Property(x=>x.ProtectedData).HasMaxLength(8192);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>x.Revision).IsUnique();e.HasMany(x=>x.Offsets).WithOne().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditReminderPolicyOffset>(e=>{e.ToTable("ReminderPolicyOffsets",t=>t.HasCheckConstraint("CK_ReminderPolicyOffset_Days","[Days] BETWEEN -365 AND 365"));e.HasKey(x=>new{x.RevisionId,x.Days});e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);});
        b.Entity<CreditReminderPolicyCommand>(e=>{e.ToTable("ReminderPolicyCommands",t=>t.HasCheckConstraint("CK_ReminderPolicyCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.RevisionId).IsUnique();e.HasOne<CreditReminderPolicyRevision>().WithMany().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);});
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditReminderPolicyRevision> ReminderPolicyRevisions=>Set<CreditReminderPolicyRevision>();public DbSet<CreditReminderPolicyOffset> ReminderPolicyOffsets=>Set<CreditReminderPolicyOffset>();public DbSet<CreditReminderPolicyCommand> ReminderPolicyCommands=>Set<CreditReminderPolicyCommand>();
    private void GuardCreditReminderPolicies()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries().Any(x=>(x.Entity is CreditReminderPolicyRevision or CreditReminderPolicyOffset or CreditReminderPolicyCommand)&&(x.State is EntityState.Modified or EntityState.Deleted)))throw CreditReminderPolicyRules.Immutable();
        foreach(var en in ChangeTracker.Entries<CreditReminderPolicyRevision>().Where(x=>x.State==EntityState.Added)){var x=en.Entity;CreditApplicationRules.Id(x.Id);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.Revision is<1 or>CreditReminderPolicyRules.MaxRevisions||x.At.Offset!=TimeSpan.Zero||x.ProtectedData.Length is<1 or>8192)throw CreditReminderPolicyRules.Invalid();CreditReminderPolicyRules.Validate(new(null,x.Enabled,x.Offsets.Select(y=>y.Days).Order().ToArray(),x.SendAt,"retained policy",true));}
        foreach(var en in ChangeTracker.Entries<CreditReminderPolicyOffset>().Where(x=>x.State==EntityState.Added)){var x=en.Entity;var p=ChangeTracker.Entries<CreditReminderPolicyRevision>().SingleOrDefault(y=>y.Entity.Id==x.RevisionId&&y.State==EntityState.Added)?.Entity;if(p is null||!p.Enabled||x.Days is< -365 or>365)throw CreditReminderPolicyRules.Immutable();}
        foreach(var en in ChangeTracker.Entries<CreditReminderPolicyCommand>().Where(x=>x.State==EntityState.Added)){var x=en.Entity;CreditApplicationRules.Id(x.CommandId);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);var rev=ChangeTracker.Entries<CreditReminderPolicyRevision>().SingleOrDefault(y=>y.Entity.Id==x.RevisionId&&y.State==EntityState.Unchanged)?.Entity;if(rev is null||rev.ActorId!=x.ActorId||rev.At!=x.At||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is<1 or>16384)throw CreditReminderPolicyRules.Invalid();}
    }
}
