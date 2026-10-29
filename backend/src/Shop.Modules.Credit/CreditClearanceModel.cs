using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditClearanceEvent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public int Sequence{get;set;}public string ActorId{get;set;}="";public string Action{get;set;}="";public string State{get;set;}="";public DateTimeOffset RecordedAt{get;set;}public byte[] ProtectedEvent{get;set;}=[];public byte[] Version{get;set;}=[];
}
public sealed class CreditClearanceCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string EventId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class CreditClearanceModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditClearanceEvent>(e=>{e.ToTable("ClearanceEvents",t=>{t.HasCheckConstraint("CK_ClearanceEvent_Facts","[Sequence] BETWEEN 1 AND 200 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_ClearanceEvent_State","([Action]='Approve' AND [State]='Approved') OR ([Action]='Revoke' AND [State]='Revoked' AND [Sequence]>1)");});e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.OrderId,x.Id});e.HasIndex(x=>new{x.OrderId,x.Sequence}).IsUnique();foreach(var n in new[]{"Id","OrderId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"OwnerId","ActorId"})e.Property<string>(n).HasMaxLength(64);foreach(var n in new[]{"Action","State"})e.Property<string>(n).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.RecordedAt).HasPrecision(7);e.Property(x=>x.Version).IsRowVersion();e.Property(x=>x.ProtectedEvent).HasMaxLength(65536);});
        b.Entity<CreditClearanceCommand>(e=>{e.ToTable("ClearanceCommands",t=>t.HasCheckConstraint("CK_ClearanceCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384"));e.HasKey(x=>new{x.ActorId,x.CommandId});foreach(var n in new[]{"CommandId","OrderId","EventId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"ActorId","OwnerId"})e.Property<string>(n).HasMaxLength(64);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(16384);e.HasIndex(x=>x.EventId).IsUnique();e.HasOne<CreditClearanceEvent>().WithMany().HasForeignKey(x=>new{x.OrderId,x.EventId}).HasPrincipalKey(x=>new{x.OrderId,x.Id}).OnDelete(DeleteBehavior.Restrict);});
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditClearanceEvent> ClearanceEvents=>Set<CreditClearanceEvent>();public DbSet<CreditClearanceCommand> ClearanceCommands=>Set<CreditClearanceCommand>();
    private void GuardClearances()
    {
        var entries=ChangeTracker.Entries().Where(x=>x.Entity is CreditClearanceEvent or CreditClearanceCommand).ToArray();if(entries.Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw CreditClearanceRules.Immutable();
        static void Actor(string a){if(CreditApplicationRules.Actor(a)!=a)throw CreditClearanceRules.Invalid();}
        foreach(var e in entries.Where(x=>x.State==EntityState.Added)){
            if(e.Entity is CreditClearanceEvent v){CreditApplicationRules.Id(v.Id);CreditApplicationRules.Id(v.OrderId);Actor(v.OwnerId);Actor(v.ActorId);if(v.Sequence is<1 or>200||v.RecordedAt.Offset!=TimeSpan.Zero||v.ProtectedEvent.Length is<1 or>65536||v.Action!=(v.State switch{"Approved"=>"Approve","Revoked"when v.Sequence>1=>"Revoke",_=>throw CreditClearanceRules.Invalid()}))throw CreditClearanceRules.Invalid();}
            else if(e.Entity is CreditClearanceCommand c){foreach(var id in new[]{c.CommandId,c.OrderId,c.EventId})CreditApplicationRules.Id(id);Actor(c.ActorId);Actor(c.OwnerId);CreditApplicationRules.Digest(c.PayloadHash);CreditApplicationRules.Digest(c.ResultHash);if(c.At.Offset!=TimeSpan.Zero||c.ProtectedResult.Length is<1 or>16384)throw CreditClearanceRules.Invalid();}
        }
    }
}
