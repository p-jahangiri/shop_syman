using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditUpfrontConfirmation
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string OriginalScheduleId{get;set;}="";public string QuoteFingerprint{get;set;}="";public string FinancialHash{get;set;}="";public long RequiredAmountRial{get;set;}public string ActorId{get;set;}="";public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedOrigin{get;set;}=[];
}
public sealed class CreditUpfrontEvent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string ConfirmationId{get;set;}="";public string OrderId{get;set;}="";public string ScheduleId{get;set;}="";public int Sequence{get;set;}public string Action{get;set;}="";public string State{get;set;}="";public long RequiredAmountRial{get;set;}public long AcknowledgedAmountRial{get;set;}public string ActorId{get;set;}="";public DateTimeOffset OccurredAt{get;set;}public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedEvent{get;set;}=[];public byte[] Version{get;set;}=[];
}
public sealed class CreditUpfrontCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ConfirmationId{get;set;}="";public string EventId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class CreditUpfrontModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditUpfrontConfirmation>(e=>{
            e.ToTable("UpfrontConfirmations",t=>t.HasCheckConstraint("CK_UpfrontConfirmation_Facts","[RequiredAmountRial]>=0 AND DATALENGTH([ProtectedOrigin]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[RecordedAt])=0"));e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.OrderId});e.HasIndex(x=>x.OrderId).IsUnique();foreach(var n in new[]{"Id","OrderId","OriginalScheduleId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"QuoteFingerprint","FinancialHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ProtectedOrigin).HasMaxLength(8192);e.HasOne<CreditScheduleRevision>().WithMany().HasForeignKey(x=>new{x.OriginalScheduleId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditUpfrontEvent>(e=>{
            e.ToTable("UpfrontEvents",t=>{
                t.HasCheckConstraint("CK_UpfrontEvent_Facts","[Sequence] BETWEEN 1 AND 200 AND [RequiredAmountRial]>=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");
                t.HasCheckConstraint("CK_UpfrontEvent_State","([Action]='ConfirmReceipt' AND [State]='ReceiptConfirmed' AND [RequiredAmountRial]>0 AND [AcknowledgedAmountRial]=[RequiredAmountRial]) OR ([Action]='ConfirmNoUpfrontDue' AND [State]='NoUpfrontDue' AND [RequiredAmountRial]=0 AND [AcknowledgedAmountRial]=0) OR ([Action]='RevokeConfirmation' AND [State]='Revoked' AND [Sequence]>1 AND [AcknowledgedAmountRial]=0)");});
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.ConfirmationId,x.Id});foreach(var n in new[]{"Id","ConfirmationId","OrderId","ScheduleId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Action).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ProtectedEvent).HasMaxLength(8192);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.ConfirmationId,x.Sequence}).IsUnique();e.HasOne<CreditUpfrontConfirmation>().WithMany().HasForeignKey(x=>new{x.ConfirmationId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditScheduleRevision>().WithMany().HasForeignKey(x=>new{x.ScheduleId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditUpfrontCommand>(e=>{
            e.ToTable("UpfrontCommands",t=>t.HasCheckConstraint("CK_UpfrontCommand_Facts","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0"));e.HasKey(x=>new{x.ActorId,x.CommandId});foreach(var n in new[]{"CommandId","OrderId","ConfirmationId","EventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.EventId).IsUnique();e.HasOne<CreditUpfrontEvent>().WithMany().HasForeignKey(x=>new{x.ConfirmationId,x.EventId}).HasPrincipalKey(x=>new{x.ConfirmationId,x.Id}).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditUpfrontConfirmation>().WithMany().HasForeignKey(x=>new{x.ConfirmationId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditUpfrontConfirmation> UpfrontConfirmations=>Set<CreditUpfrontConfirmation>();public DbSet<CreditUpfrontEvent> UpfrontEvents=>Set<CreditUpfrontEvent>();public DbSet<CreditUpfrontCommand> UpfrontCommands=>Set<CreditUpfrontCommand>();
    private void GuardUpfront()
    {
        var entries=ChangeTracker.Entries().Where(e=>e.Entity is CreditUpfrontConfirmation or CreditUpfrontEvent or CreditUpfrontCommand).ToArray();if(entries.Length==0)return;
        if(entries.Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw CreditUpfrontRules.Immutable();
        static void Actor(string actor){if(CreditApplicationRules.Actor(actor)!=actor)throw CreditUpfrontRules.Invalid();}
        static void Blob(byte[] b,int max){if(b is null||b.Length is<1||b.Length>max)throw CreditUpfrontRules.Invalid();}
        foreach(var entry in entries.Where(e=>e.State==EntityState.Added)){
            if(entry.Entity is CreditUpfrontConfirmation c){foreach(var id in new[]{c.Id,c.OrderId,c.OriginalScheduleId})CreditApplicationRules.Id(id);Actor(c.OwnerId);Actor(c.ActorId);CreditApplicationRules.Digest(c.QuoteFingerprint);CreditApplicationRules.Digest(c.FinancialHash);Blob(c.ProtectedOrigin,8192);if(c.RequiredAmountRial<0||c.RecordedAt.Offset!=TimeSpan.Zero)throw CreditUpfrontRules.Invalid();}
            else if(entry.Entity is CreditUpfrontEvent e){foreach(var id in new[]{e.Id,e.ConfirmationId,e.OrderId,e.ScheduleId})CreditApplicationRules.Id(id);Actor(e.ActorId);Blob(e.ProtectedEvent,8192);if(e.Sequence is<1 or>200||e.RequiredAmountRial<0||e.RecordedAt.Offset!=TimeSpan.Zero||e.OccurredAt.Offset!=TimeSpan.Zero||e.OccurredAt>e.RecordedAt||e.AcknowledgedAmountRial!=CreditUpfrontRules.Acknowledged(e.State,e.RequiredAmountRial)||e.Action!=(e.State switch{"ReceiptConfirmed"=>"ConfirmReceipt","NoUpfrontDue"=>"ConfirmNoUpfrontDue","Revoked"when e.Sequence>1=>"RevokeConfirmation",_=>throw CreditUpfrontRules.Invalid()}))throw CreditUpfrontRules.Invalid();}
            else if(entry.Entity is CreditUpfrontCommand cmd){foreach(var id in new[]{cmd.CommandId,cmd.OrderId,cmd.ConfirmationId,cmd.EventId})CreditApplicationRules.Id(id);Actor(cmd.OwnerId);Actor(cmd.ActorId);CreditApplicationRules.Digest(cmd.PayloadHash);CreditApplicationRules.Digest(cmd.ResultHash);Blob(cmd.ProtectedResult,16384);if(cmd.At.Offset!=TimeSpan.Zero)throw CreditUpfrontRules.Invalid();}
        }
    }
}
