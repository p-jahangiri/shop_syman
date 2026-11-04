using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Support;

public sealed class SupportTicket
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long Sequence { get; set; }
    public string OwnerId { get; set; } = "";
    public byte[] ProtectedSubject { get; set; } = [];
    public string Locale { get; set; } = "fa";
    public string State { get; set; } = "Open";
    public int MessageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public byte[] Version { get; set; } = [];
}
public sealed class TicketMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long Sequence { get; set; }
    public string TicketId { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string Author { get; set; } = "customer";
    public string Locale { get; set; } = "fa";
    public byte[] ProtectedBody { get; set; } = [];
    public DateTimeOffset At { get; set; }
}
public sealed class TicketEvent
{
    public long Sequence { get; set; }
    public string TicketId { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string Action { get; set; } = "";
    public string State { get; set; } = "";
    public DateTimeOffset At { get; set; }
}
public sealed class TicketCommand
{
    public string Audience { get; set; } = "customer";
    public string ActorId { get; set; } = "";
    public string CommandId { get; set; } = "";
    public string TicketId { get; set; } = "";
    public string PayloadHash { get; set; } = "";
    public byte[] ProtectedResult { get; set; } = [];
    public string ResultHash { get; set; } = "";
    public DateTimeOffset At { get; set; }
}
public sealed class TicketAttachment
{
    public string Id{get;set;}="";
    public string TicketId{get;set;}="";
    public string MessageId{get;set;}="";
    public string ActorId{get;set;}="";
    public string Author{get;set;}="customer";
    public long Sequence{get;set;}
    public DateTimeOffset At{get;set;}
}
public sealed class SupportDbContext(DbContextOptions<SupportDbContext> options) : DbContext(options)
{
    public DbSet<SupportTicket> Tickets => Set<SupportTicket>();
    public DbSet<TicketMessage> Messages => Set<TicketMessage>();
    public DbSet<TicketEvent> Events => Set<TicketEvent>();
    public DbSet<TicketCommand> Commands => Set<TicketCommand>();
    public DbSet<TicketAttachment> Attachments=>Set<TicketAttachment>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("support");
        b.Entity<SupportTicket>(e => {
            e.ToTable("Tickets", t => { t.HasCheckConstraint("CK_Ticket_State", "[State] IN ('Open','WaitingCustomer','Closed')"); t.HasCheckConstraint("CK_Ticket_Locale", "[Locale] IN ('fa','en')"); t.HasCheckConstraint("CK_Ticket_MessageCount", "[MessageCount]>0"); t.HasCheckConstraint("CK_Ticket_Subject", "DATALENGTH([ProtectedSubject]) BETWEEN 1 AND 65536"); });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false); e.Property(x => x.Sequence).UseIdentityColumn(); e.HasIndex(x => x.Sequence).IsUnique();
            e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.Locale).HasMaxLength(2).IsUnicode(false); e.Property(x => x.State).HasMaxLength(16).IsUnicode(false); e.Property(x => x.ProtectedSubject).HasMaxLength(65536); e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.OwnerId, x.State, x.Sequence }); e.HasIndex(x => new { x.State, x.Sequence });
        });
        b.Entity<TicketMessage>(e => {
            e.ToTable("Messages", t => { t.HasCheckConstraint("CK_TicketMessage_Author", "[Author] IN ('customer','support')"); t.HasCheckConstraint("CK_TicketMessage_Locale", "[Locale] IN ('fa','en')"); t.HasCheckConstraint("CK_TicketMessage_Body", "DATALENGTH([ProtectedBody]) BETWEEN 1 AND 65536"); });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false); e.Property(x => x.Sequence).UseIdentityColumn(); e.HasIndex(x => x.Sequence).IsUnique();
            e.Property(x => x.TicketId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.Author).HasMaxLength(8).IsUnicode(false); e.Property(x => x.Locale).HasMaxLength(2).IsUnicode(false); e.Property(x => x.ProtectedBody).HasMaxLength(65536);
            e.HasOne<SupportTicket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Restrict); e.HasIndex(x => new { x.TicketId, x.Sequence });
        });
        b.Entity<TicketEvent>(e => {
            e.ToTable("Events", t => { t.HasCheckConstraint("CK_TicketEvent_Action", "[Action] IN ('Created','Replied','Closed','Reopened')"); t.HasCheckConstraint("CK_TicketEvent_State", "[State] IN ('Open','WaitingCustomer','Closed')"); });
            e.HasKey(x => x.Sequence); e.Property(x => x.Sequence).UseIdentityColumn(); e.Property(x => x.TicketId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.Action).HasMaxLength(16).IsUnicode(false); e.Property(x => x.State).HasMaxLength(16).IsUnicode(false);
            e.HasOne<SupportTicket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Restrict); e.HasIndex(x => new { x.TicketId, x.Sequence });
        });
        b.Entity<TicketCommand>(e => {
            e.ToTable("Commands", t => { t.HasCheckConstraint("CK_TicketCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536"); t.HasCheckConstraint("CK_TicketCommand_Audience", "[Audience] IN ('customer','support')"); });
            e.Property(x => x.Audience).HasMaxLength(8).IsUnicode(false);
            e.HasKey(x => new { x.ActorId, x.CommandId }); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.CommandId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.TicketId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.PayloadHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.ResultHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.ProtectedResult).HasMaxLength(65536);
            e.HasOne<SupportTicket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Restrict); e.HasIndex(x => new { x.TicketId, x.At });
        });
        b.Entity<TicketAttachment>(e=>{
            e.ToTable("Attachments",t=>t.HasCheckConstraint("CK_TicketAttachment_Author","[Author] IN ('customer','support')"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.TicketId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.MessageId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Author).HasMaxLength(8).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.HasIndex(x=>new{x.TicketId,x.Sequence});e.HasIndex(x=>x.MessageId).IsUnique();
            e.HasOne<TicketMessage>().WithMany().HasForeignKey(x=>new{x.MessageId,x.TicketId}).HasPrincipalKey(x=>new{x.Id,x.TicketId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
    private void Guard()
    {
        ChangeTracker.DetectChanges();
        if (ChangeTracker.Entries().Any(e => (e.Entity is TicketMessage or TicketEvent or TicketCommand or TicketAttachment) && (e.State is EntityState.Modified or EntityState.Deleted))) throw new BusinessException("ticket_history_immutable", "Support history cannot be edited or deleted.");
        foreach (var e in ChangeTracker.Entries<SupportTicket>()) {
            if (e.State == EntityState.Deleted || e.State == EntityState.Modified && new[] { nameof(SupportTicket.OwnerId), nameof(SupportTicket.ProtectedSubject), nameof(SupportTicket.Locale), nameof(SupportTicket.CreatedAt), nameof(SupportTicket.Sequence) }.Any(x => e.Property(x).IsModified)) throw new BusinessException("ticket_history_immutable", "Ticket ownership and original subject cannot change.");
        }
    }
    public override int SaveChanges() { Guard(); return base.SaveChanges(); }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { Guard(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(CancellationToken ct = default) { Guard(); return base.SaveChangesAsync(ct); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default) { Guard(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, ct); }
}
