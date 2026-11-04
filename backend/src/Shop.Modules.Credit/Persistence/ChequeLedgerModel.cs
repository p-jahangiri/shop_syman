using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class ReceivedCheque
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ScheduleId{get;set;}="";
    public int Sequence{get;set;}public DateOnly DueDate{get;set;}public long AmountRial{get;set;}
    public string ActorId{get;set;}="";public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedRegistration{get;set;}=[];
}
public sealed class ChequeLedgerEvent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string ChequeId{get;set;}="";
    public int Sequence{get;set;}public string Action{get;set;}="";public string State{get;set;}="";
    public string ActorId{get;set;}="";public DateTimeOffset OccurredAt{get;set;}public DateTimeOffset RecordedAt{get;set;}
    public byte[] ProtectedEvent{get;set;}=[];public byte[] Version{get;set;}=[];
}
public sealed class ChequeLedgerCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";
    public string ChequeId{get;set;}="";public string EventId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";
    public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class ChequeLedgerModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditScheduleRevision>().HasAlternateKey(x=>new{x.Id,x.OrderId});
        b.Entity<ReceivedCheque>(e=>{
            e.ToTable("ReceivedCheques",t=>{
                t.HasCheckConstraint("CK_ReceivedCheque_Facts","[Sequence] BETWEEN 1 AND 60 AND [AmountRial]>0 AND DATEPART(TZOFFSET,[RecordedAt])=0");
                t.HasCheckConstraint("CK_ReceivedCheque_Sealed","DATALENGTH([ProtectedRegistration]) BETWEEN 1 AND 8192");});
            e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","OrderId","ScheduleId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ProtectedRegistration).HasMaxLength(8192);
            e.HasIndex(x=>new{x.OrderId,x.Sequence}).IsUnique();e.HasIndex(x=>new{x.DueDate,x.Id});
            e.HasOne<CreditScheduleRevision>().WithMany().HasForeignKey(x=>new{x.ScheduleId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<CreditScheduleLine>().WithMany().HasForeignKey(x=>new{x.ScheduleId,x.Sequence}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ChequeLedgerEvent>(e=>{
            e.ToTable("ChequeLedgerEvents",t=>{
                t.HasCheckConstraint("CK_ChequeLedgerEvent_Facts","[Sequence] BETWEEN 1 AND 200 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");
                t.HasCheckConstraint("CK_ChequeLedgerEvent_State","([Action]='Receive' AND [State]='Received' AND [Sequence]=1) OR ([Sequence]>1 AND (([Action]='Deposit' AND [State]='Deposited') OR ([Action]='ReportCollection' AND [State]='CollectedReported') OR ([Action]='ReportBounce' AND [State]='BouncedReported') OR ([Action]='Withdraw' AND [State]='Withdrawn') OR ([Action]='ReturnToCustomer' AND [State]='ReturnedToCustomer') OR ([Action]='CorrectCollectionReport' AND [State]='Deposited')))");
                t.HasCheckConstraint("CK_ChequeLedgerEvent_Sealed","DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192");});
            e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","ChequeId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Action).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ProtectedEvent).HasMaxLength(8192);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.ChequeId,x.Sequence}).IsUnique();e.HasOne<ReceivedCheque>().WithMany().HasForeignKey(x=>x.ChequeId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ChequeLedgerCommand>(e=>{
            e.ToTable("ChequeLedgerCommands",t=>{t.HasCheckConstraint("CK_ChequeLedgerCommand_Facts","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0");});
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.OwnerId).HasMaxLength(64);
            foreach(var n in new[]{"CommandId","OrderId","ChequeId","EventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.EventId).IsUnique();e.HasOne<ChequeLedgerEvent>().WithMany().HasForeignKey(x=>x.EventId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<ReceivedCheque> ReceivedCheques=>Set<ReceivedCheque>();
    public DbSet<ChequeLedgerEvent> ChequeLedgerEvents=>Set<ChequeLedgerEvent>();
    public DbSet<ChequeLedgerCommand> ChequeLedgerCommands=>Set<ChequeLedgerCommand>();
    private void GuardChequeLedger()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries().Any(x=>(x.Entity is ReceivedCheque or ChequeLedgerEvent or ChequeLedgerCommand)&&(x.State is EntityState.Modified or EntityState.Deleted)))throw ChequeLedgerRules.Immutable();
        foreach(var e in ChangeTracker.Entries<ReceivedCheque>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;foreach(var id in new[]{x.Id,x.OrderId,x.ScheduleId})CreditApplicationRules.Id(id);
            if(x.OwnerId!=CreditApplicationRules.Actor(x.OwnerId)||x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.Sequence is <1 or >60||x.AmountRial<=0||x.RecordedAt.Offset!=TimeSpan.Zero||x.ProtectedRegistration.Length is <1 or >8192)throw ChequeLedgerRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<ChequeLedgerEvent>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Id(x.ChequeId);
            var valid=x.Sequence==1?x.Action=="Receive"&&x.State=="Received":x.Sequence is >=2 and <=200&&x.State==(x.Action switch{"Deposit"or"CorrectCollectionReport"=>"Deposited","ReportCollection"=>"CollectedReported","ReportBounce"=>"BouncedReported","Withdraw"=>"Withdrawn","ReturnToCustomer"=>"ReturnedToCustomer",_=>""});
            if(!valid||x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.OccurredAt.Offset!=TimeSpan.Zero||x.RecordedAt.Offset!=TimeSpan.Zero||x.OccurredAt>x.RecordedAt||x.ProtectedEvent.Length is <1 or >8192)throw ChequeLedgerRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<ChequeLedgerCommand>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;foreach(var id in new[]{x.CommandId,x.OrderId,x.ChequeId,x.EventId})CreditApplicationRules.Id(id);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);
            var ev=ChangeTracker.Entries<ChequeLedgerEvent>().SingleOrDefault(y=>y.Entity.Id==x.EventId&&y.State is EntityState.Added or EntityState.Unchanged)?.Entity;
            if(ev is null||ev.ActorId!=x.ActorId||ev.ChequeId!=x.ChequeId||ev.RecordedAt!=x.At||x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.OwnerId!=CreditApplicationRules.Actor(x.OwnerId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is <1 or >16384)throw ChequeLedgerRules.Invalid();
        }
    }
}
