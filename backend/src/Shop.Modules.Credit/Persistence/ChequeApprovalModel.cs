using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class ChequeApproval
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";public string ScheduleId{get;set;}="";public string ActorId{get;set;}="";public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedOrigin{get;set;}=[];
}
public sealed class ChequeApprovalEvent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string ApprovalId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";public string LedgerEventId{get;set;}="";public int Sequence{get;set;}public string Action{get;set;}="";public string State{get;set;}="";public string ActorId{get;set;}="";public DateTimeOffset OccurredAt{get;set;}public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedEvent{get;set;}=[];public byte[] Version{get;set;}=[];
}
public sealed class ChequeApprovalCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";public string ApprovalId{get;set;}="";public string EventId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class ChequeApprovalModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ChequeApproval>(e=>{
            e.ToTable("ChequeApprovals",t=>t.HasCheckConstraint("CK_ChequeApproval_Facts","DATALENGTH([ProtectedOrigin]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[RecordedAt])=0"));e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.OrderId,x.ChequeId});e.HasIndex(x=>x.ChequeId).IsUnique();foreach(var n in new[]{"Id","OrderId","ChequeId","ScheduleId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ProtectedOrigin).HasMaxLength(8192);e.HasOne<ReceivedCheque>().WithMany().HasForeignKey(x=>x.ChequeId).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditScheduleRevision>().WithMany().HasForeignKey(x=>new{x.ScheduleId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ChequeApprovalEvent>(e=>{
            e.ToTable("ChequeApprovalEvents",t=>{t.HasCheckConstraint("CK_ChequeApprovalEvent_Facts","[Sequence] BETWEEN 1 AND 200 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");t.HasCheckConstraint("CK_ChequeApprovalEvent_State","([Action]='Approve' AND [State]='Approved') OR ([Action]='Revoke' AND [State]='Revoked' AND [Sequence]>1)");});
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.ApprovalId,x.Id});foreach(var n in new[]{"Id","ApprovalId","OrderId","ChequeId","LedgerEventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.ProtectedEvent).HasMaxLength(8192);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.ApprovalId,x.Sequence}).IsUnique();e.HasOne<ChequeApproval>().WithMany().HasForeignKey(x=>new{x.ApprovalId,x.OrderId,x.ChequeId}).HasPrincipalKey(x=>new{x.Id,x.OrderId,x.ChequeId}).OnDelete(DeleteBehavior.Restrict);e.HasOne<ChequeLedgerEvent>().WithMany().HasForeignKey(x=>x.LedgerEventId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ChequeApprovalCommand>(e=>{
            e.ToTable("ChequeApprovalCommands",t=>t.HasCheckConstraint("CK_ChequeApprovalCommand_Facts","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0"));e.HasKey(x=>new{x.ActorId,x.CommandId});foreach(var n in new[]{"CommandId","OrderId","ChequeId","ApprovalId","EventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.EventId).IsUnique();e.HasOne<ChequeApprovalEvent>().WithMany().HasForeignKey(x=>new{x.ApprovalId,x.EventId}).HasPrincipalKey(x=>new{x.ApprovalId,x.Id}).OnDelete(DeleteBehavior.Restrict);e.HasOne<ChequeApproval>().WithMany().HasForeignKey(x=>new{x.ApprovalId,x.OrderId,x.ChequeId}).HasPrincipalKey(x=>new{x.Id,x.OrderId,x.ChequeId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<ChequeApproval> ChequeApprovals=>Set<ChequeApproval>();public DbSet<ChequeApprovalEvent> ChequeApprovalEvents=>Set<ChequeApprovalEvent>();public DbSet<ChequeApprovalCommand> ChequeApprovalCommands=>Set<ChequeApprovalCommand>();
    private void GuardChequeApprovals()
    {
        var entries=ChangeTracker.Entries().Where(x=>x.Entity is ChequeApproval or ChequeApprovalEvent or ChequeApprovalCommand).ToArray();if(entries.Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw ChequeApprovalRules.Immutable();
        static void Actor(string a){if(CreditApplicationRules.Actor(a)!=a)throw ChequeApprovalRules.Invalid();}static void Blob(byte[] b,int max){if(b is null||b.Length is<1||b.Length>max)throw ChequeApprovalRules.Invalid();}
        foreach(var x in entries.Where(x=>x.State==EntityState.Added)){
            if(x.Entity is ChequeApproval c){foreach(var id in new[]{c.Id,c.OrderId,c.ChequeId,c.ScheduleId})CreditApplicationRules.Id(id);Actor(c.OwnerId);Actor(c.ActorId);Blob(c.ProtectedOrigin,8192);if(c.RecordedAt.Offset!=TimeSpan.Zero)throw ChequeApprovalRules.Invalid();}
            else if(x.Entity is ChequeApprovalEvent e){foreach(var id in new[]{e.Id,e.ApprovalId,e.OrderId,e.ChequeId,e.LedgerEventId})CreditApplicationRules.Id(id);Actor(e.ActorId);Blob(e.ProtectedEvent,8192);if(e.Sequence is<1 or>200||e.Action!=(e.State switch{"Approved"=>"Approve","Revoked"when e.Sequence>1=>"Revoke",_=>throw ChequeApprovalRules.Invalid()})||e.RecordedAt.Offset!=TimeSpan.Zero||e.OccurredAt.Offset!=TimeSpan.Zero||e.OccurredAt>e.RecordedAt)throw ChequeApprovalRules.Invalid();}
            else if(x.Entity is ChequeApprovalCommand c1){foreach(var id in new[]{c1.CommandId,c1.OrderId,c1.ChequeId,c1.ApprovalId,c1.EventId})CreditApplicationRules.Id(id);Actor(c1.ActorId);Actor(c1.OwnerId);CreditApplicationRules.Digest(c1.PayloadHash);CreditApplicationRules.Digest(c1.ResultHash);Blob(c1.ProtectedResult,16384);if(c1.At.Offset!=TimeSpan.Zero)throw ChequeApprovalRules.Invalid();}
        }
    }
}
