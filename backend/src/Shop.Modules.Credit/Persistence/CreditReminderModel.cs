using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;

public sealed class CreditReminderEvent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";
    public int Sequence{get;set;}public DateOnly CivilDay{get;set;}public string ActorId{get;set;}="";public DateTimeOffset At{get;set;}public byte[] ProtectedEvent{get;set;}=[];
}
public sealed class CreditReminderCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";public string EventId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public DateTimeOffset At{get;set;}public byte[] ProtectedResult{get;set;}=[];
}
internal static class CreditReminderModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ReceivedCheque>().HasAlternateKey(x=>new{x.Id,x.OrderId,x.OwnerId});
        b.Entity<CreditReminderEvent>(e=>{
            e.ToTable("ReminderEvents",t=>{t.HasCheckConstraint("CK_ReminderEvent_Facts","[Sequence] BETWEEN 1 AND 3650 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192");});
            e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","OrderId","ChequeId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"OwnerId","ActorId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.ProtectedEvent).HasMaxLength(8192);
            e.HasAlternateKey(x=>new{x.Id,x.OrderId,x.OwnerId,x.ChequeId});e.HasIndex(x=>new{x.ChequeId,x.Sequence}).IsUnique();e.HasIndex(x=>new{x.ChequeId,x.CivilDay}).IsUnique();
            e.HasOne<ReceivedCheque>().WithMany().HasForeignKey(x=>new{x.ChequeId,x.OrderId,x.OwnerId}).HasPrincipalKey(x=>new{x.Id,x.OrderId,x.OwnerId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditReminderCommand>(e=>{
            e.ToTable("ReminderCommands",t=>t.HasCheckConstraint("CK_ReminderCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384"));e.HasKey(x=>new{x.ActorId,x.CommandId});foreach(var n in new[]{"CommandId","OrderId","ChequeId","EventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"ActorId","OwnerId"})e.Property<string>(n).HasMaxLength(64);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.EventId).IsUnique();e.HasOne<CreditReminderEvent>().WithMany().HasForeignKey(x=>new{x.EventId,x.OrderId,x.OwnerId,x.ChequeId}).HasPrincipalKey(x=>new{x.Id,x.OrderId,x.OwnerId,x.ChequeId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditReminderEvent> ReminderEvents=>Set<CreditReminderEvent>();public DbSet<CreditReminderCommand> ReminderCommands=>Set<CreditReminderCommand>();
    private void GuardCreditReminders()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries().Any(x=>(x.Entity is CreditReminderEvent or CreditReminderCommand)&&(x.State is EntityState.Modified or EntityState.Deleted)))throw CreditReminderRules.Immutable();
        foreach(var entry in ChangeTracker.Entries<CreditReminderEvent>().Where(x=>x.State==EntityState.Added)){var x=entry.Entity;foreach(var id in new[]{x.Id,x.OrderId,x.ChequeId})CreditApplicationRules.Id(id);if(x.OwnerId!=CreditApplicationRules.Actor(x.OwnerId)||x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.Sequence is<1 or>CreditReminderRules.MaxEvents||x.At.Offset!=TimeSpan.Zero||x.CivilDay!=ChequeReportRules.Date(ChequeReportRules.Today(x.At))||x.ProtectedEvent.Length is<1 or>8192)throw CreditReminderRules.Invalid();}
        foreach(var entry in ChangeTracker.Entries<CreditReminderCommand>().Where(x=>x.State==EntityState.Added)){var x=entry.Entity;foreach(var id in new[]{x.CommandId,x.OrderId,x.ChequeId,x.EventId})CreditApplicationRules.Id(id);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);var e=ChangeTracker.Entries<CreditReminderEvent>().SingleOrDefault(y=>y.Entity.Id==x.EventId&&y.State is EntityState.Added or EntityState.Unchanged)?.Entity;if(e is null||e.OwnerId!=x.OwnerId||e.OrderId!=x.OrderId||e.ChequeId!=x.ChequeId||e.ActorId!=x.ActorId||e.At!=x.At||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is<1 or>16384||x.ActorId!=CreditApplicationRules.Actor(x.ActorId))throw CreditReminderRules.Invalid();}
    }
}
