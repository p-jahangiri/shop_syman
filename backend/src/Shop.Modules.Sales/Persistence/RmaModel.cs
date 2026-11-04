using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;

public sealed class RmaPolicyRevision
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public int Revision{get;set;}public bool Enabled{get;set;}
    public bool PhysicalReturns{get;set;}public bool DigitalComplaints{get;set;}public string ConditionsFa{get;set;}="";public string ConditionsEn{get;set;}="";
    public string WindowMode{get;set;}="";public int? WindowDays{get;set;}public int? MaxOpenPerOwner{get;set;}
    public string ActorId{get;set;}="";public byte[] ProtectedNote{get;set;}=[];public DateTimeOffset At{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class RmaPolicyCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string RevisionId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
public sealed class RmaCase
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public long Number{get;set;}public string OwnerId{get;set;}="";public string OrderId{get;set;}="";
    public string Locale{get;set;}="";public string Kind{get;set;}="";public string State{get;set;}="submitted";public string? Outcome{get;set;}public bool IsOpen{get;set;}=true;
    public int OriginalSnapshotVersion{get;set;}public string SnapshotHash{get;set;}="";public string PolicyRevisionId{get;set;}="";
    public byte[] ProtectedRequest{get;set;}=[];public bool ContainsDemo{get;set;}public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];public List<RmaCaseLine> Lines{get;set;}=[];public List<RmaCaseEvent> Events{get;set;}=[];
}
public sealed class RmaCaseLine
{
    public string CaseId{get;set;}="";public string LineKey{get;set;}="";public string VariantId{get;set;}="";public string Sku{get;set;}="";
    public string Name{get;set;}="";public string Label{get;set;}="";public bool IsDigital{get;set;}public int OrderedQuantity{get;set;}public int Quantity{get;set;}
    public int HandedOffOrAvailableQuantity{get;set;}public byte[] ProtectedFacts{get;set;}=[];
}
public sealed class RmaCaseEvent
{
    public long Id{get;set;}public string CaseId{get;set;}="";public string ActorId{get;set;}="";public string Author{get;set;}="";
    public string Action{get;set;}="";public string State{get;set;}="";public string? Outcome{get;set;}public DateTimeOffset At{get;set;}public byte[] ProtectedText{get;set;}=[];
}
public sealed class RmaCaseCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string CaseId{get;set;}="";public string OwnerId{get;set;}="";
    public string Audience{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];
    public bool ContainsDemo{get;set;}public DateTimeOffset At{get;set;}
}

internal static class RmaModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<RmaPolicyRevision>(e=>{
            e.ToTable("RmaPolicyRevisions",t=>{
                t.HasCheckConstraint("CK_RmaPolicy_Facts","[Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384 AND LEN([ConditionsFa])>0 AND LEN([ConditionsEn])>0 AND ([Enabled]=0 OR [PhysicalReturns]=1 OR [DigitalComplaints]=1)");
                t.HasCheckConstraint("CK_RmaPolicy_Window","([WindowMode]='manualReview' AND [WindowDays] IS NULL) OR ([WindowMode]='deliveryDays' AND [WindowDays] BETWEEN 1 AND 3650 AND [WindowDays] IS NOT NULL)");
                t.HasCheckConstraint("CK_RmaPolicy_Capacity","[MaxOpenPerOwner] IS NULL OR [MaxOpenPerOwner] BETWEEN 1 AND 10000");
            });e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.HasIndex(x=>x.Revision).IsUnique();e.Property(x=>x.ActorId).HasMaxLength(64);
            e.Property(x=>x.ConditionsFa).HasMaxLength(4000);e.Property(x=>x.ConditionsEn).HasMaxLength(4000);e.Property(x=>x.WindowMode).HasMaxLength(16).IsUnicode(false);
            e.Property(x=>x.ProtectedNote).HasMaxLength(16384);e.Property(x=>x.Version).IsRowVersion();
        });
        b.Entity<RmaPolicyCommand>(e=>{
            e.ToTable("RmaPolicyCommands",t=>t.HasCheckConstraint("CK_RmaPolicyCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 2097152"));
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var name in new[]{"CommandId","RevisionId"})e.Property<string>(name).HasMaxLength(32).IsUnicode(false);
            foreach(var name in new[]{"PayloadHash","ResultHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(2097152);
            e.HasIndex(x=>x.RevisionId).IsUnique();e.HasOne<RmaPolicyRevision>().WithMany().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<RmaCase>(e=>{
            e.ToTable("RmaCases",t=>{
                t.HasCheckConstraint("CK_RmaCase_Facts","[OriginalSnapshotVersion] IN(1,2) AND [Kind] IN('physicalReturn','digitalComplaint') AND [Locale] IN('fa','en') AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ChangedAt])=0 AND [ChangedAt]>=[CreatedAt] AND DATALENGTH([ProtectedRequest]) BETWEEN 1 AND 32768");
                t.HasCheckConstraint("CK_RmaCase_State","([State] IN('submitted','reviewing') AND [Outcome] IS NULL AND [IsOpen]=1) OR ([State]='reviewed' AND (([Outcome]='followUp' AND [IsOpen]=1) OR ([Outcome]='declined' AND [IsOpen]=0))) OR ([State]='withdrawn' AND [Outcome] IS NULL AND [IsOpen]=0)");
            });e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Number).UseIdentityColumn();e.HasIndex(x=>x.Number).IsUnique();
            e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.OrderId).HasMaxLength(32);e.Property(x=>x.PolicyRevisionId).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.Kind).HasMaxLength(20).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.Outcome).HasMaxLength(16).IsUnicode(false);
            e.Property(x=>x.SnapshotHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedRequest).HasMaxLength(32768);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.OrderId,x.IsOpen}).IsUnique().HasFilter("[IsOpen]=1");e.HasIndex(x=>x.OrderId);e.HasIndex(x=>x.PolicyRevisionId);e.HasIndex(x=>new{x.OwnerId,x.Number});e.HasIndex(x=>new{x.OwnerId,x.IsOpen});e.HasIndex(x=>new{x.State,x.Number});
            e.HasOne<SalesOrder>().WithMany().HasForeignKey(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);e.HasOne<RmaPolicyRevision>().WithMany().HasForeignKey(x=>x.PolicyRevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.CaseId).OnDelete(DeleteBehavior.Restrict);e.HasMany(x=>x.Events).WithOne().HasForeignKey(x=>x.CaseId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<RmaCaseLine>(e=>{
            e.ToTable("RmaCaseLines",t=>t.HasCheckConstraint("CK_RmaCaseLine_Quantity","[OrderedQuantity] BETWEEN 1 AND 1000000 AND [Quantity] BETWEEN 1 AND [HandedOffOrAvailableQuantity] AND [HandedOffOrAvailableQuantity]<=[OrderedQuantity] AND DATALENGTH([ProtectedFacts]) BETWEEN 1 AND 131072"));
            e.HasKey(x=>new{x.CaseId,x.LineKey});e.Property(x=>x.CaseId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.LineKey).HasMaxLength(64);e.Property(x=>x.VariantId).HasMaxLength(64);
            e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.Name).HasMaxLength(250);e.Property(x=>x.Label).HasMaxLength(4000);e.Property(x=>x.ProtectedFacts).HasMaxLength(131072);
        });
        b.Entity<RmaCaseEvent>(e=>{
            e.ToTable("RmaCaseEvents",t=>t.HasCheckConstraint("CK_RmaCaseEvent_Facts","[Author] IN('customer','staff') AND [Action] IN('submitted','startReview','completeReview','withdrawn') AND [State] IN('submitted','reviewing','reviewed','withdrawn') AND ([Outcome] IS NULL OR [Outcome] IN('followUp','declined')) AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedText]) BETWEEN 1 AND 65536"));
            e.HasKey(x=>x.Id);e.Property(x=>x.CaseId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Author).HasMaxLength(8).IsUnicode(false);
            e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.Outcome).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.ProtectedText).HasMaxLength(65536);e.HasIndex(x=>new{x.CaseId,x.Id});e.HasIndex(x=>new{x.CaseId,x.Action}).IsUnique();
        });
        b.Entity<RmaCaseCommand>(e=>{
            e.ToTable("RmaCaseCommands",t=>t.HasCheckConstraint("CK_RmaCaseCommand_Facts","[Audience] IN('customer','staff') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 2097152"));
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.OwnerId).HasMaxLength(64);foreach(var name in new[]{"CommandId","CaseId"})e.Property<string>(name).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.Audience).HasMaxLength(8).IsUnicode(false);foreach(var name in new[]{"PayloadHash","ResultHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(2097152);
            e.HasIndex(x=>x.CaseId);e.HasOne<RmaCase>().WithMany().HasForeignKey(x=>x.CaseId).OnDelete(DeleteBehavior.Restrict);
        });
    }
    public static void Guard(SalesDbContext db)
    {
        db.ChangeTracker.DetectChanges();
        foreach(var e in db.ChangeTracker.Entries()){
            if(e.Entity is RmaPolicyRevision or RmaPolicyCommand or RmaCaseLine or RmaCaseEvent or RmaCaseCommand)
                if(e.State is EntityState.Modified or EntityState.Deleted)throw RmaRules.Immutable();
            if(e.Entity is RmaCase&&(e.State==EntityState.Deleted||e.State==EntityState.Modified&&e.Properties.Any(p=>p.IsModified&&p.Metadata.Name is not("State"or"Outcome"or"IsOpen"or"ChangedAt"))))throw RmaRules.Immutable();
            if(e.Entity is RmaCase current&&e.State==EntityState.Modified){
                if(current.ChangedAt<(DateTimeOffset)e.Property("ChangedAt").OriginalValue!
                    ||!db.ChangeTracker.Entries<RmaCaseEvent>().Any(x=>x.State==EntityState.Added&&x.Entity.CaseId==current.Id&&x.Entity.State==current.State&&x.Entity.Outcome==current.Outcome&&x.Entity.At==current.ChangedAt))throw RmaRules.Immutable();
            }
        }
    }
}
public sealed partial class SalesDbContext
{
    public DbSet<RmaPolicyRevision> RmaPolicyRevisions=>Set<RmaPolicyRevision>();public DbSet<RmaPolicyCommand> RmaPolicyCommands=>Set<RmaPolicyCommand>();
    public DbSet<RmaCase> RmaCases=>Set<RmaCase>();public DbSet<RmaCaseLine> RmaCaseLines=>Set<RmaCaseLine>();
    public DbSet<RmaCaseEvent> RmaCaseEvents=>Set<RmaCaseEvent>();public DbSet<RmaCaseCommand> RmaCaseCommands=>Set<RmaCaseCommand>();
}
