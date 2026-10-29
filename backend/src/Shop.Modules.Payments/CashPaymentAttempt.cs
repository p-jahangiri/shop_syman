using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Payments;

public sealed class CashPaymentAttempt
{
    public string Id {get;set;}="";
    public string OwnerId {get;set;}="";
    public string RequestId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string OrderId {get;set;}="";
    public string MethodId {get;set;}="";
    public string ProviderKey {get;set;}="";
    public string AccountKey {get;set;}="";
    public long AmountRial {get;set;}
    public string Currency {get;set;}="IRR";
    public string SnapshotFingerprint {get;set;}="";
    public string OriginalOrderVersion {get;set;}="";
    public DateTimeOffset OrderExpiresAt {get;set;}
    public bool ContainsDemo {get;set;}
    public string State {get;set;}="created";
    public string? AuthorityHash {get;set;}
    public byte[]? ProtectedAuthority {get;set;}
    public string? RedirectUri {get;set;}
    public string? LeaseId {get;set;}
    public DateTimeOffset? LeaseUntil {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public byte[] Version {get;set;}=[];
}
public sealed class CashPaymentEvent
{
    public long Id {get;set;}
    public string AttemptId {get;set;}="";
    public string State {get;set;}="";
    public string Reason {get;set;}="";
    public DateTimeOffset At {get;set;}
}
public sealed class CashPaymentVerification
{
    public string Id {get;set;}="";
    public string AttemptId {get;set;}="";
    public string ProviderKey {get;set;}="";
    public string AccountKey {get;set;}="";
    public string AuthorityHash {get;set;}="";
    public string ReferenceHash {get;set;}="";
    public long AmountRial {get;set;}
    public string ProofHash {get;set;}="";
    public string Disposition {get;set;}="";
    public string Reason {get;set;}="";
    public DateTimeOffset VerifiedAt {get;set;}
    public string ResponseJson {get;set;}="";
    public string ResponseHash {get;set;}="";
    public bool ContainsDemo {get;set;}
}
internal static class CashPaymentModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<CashPaymentAttempt>(e=>{
            e.ToTable("CashPaymentAttempts",t=>{
                t.HasCheckConstraint("CK_CashAttempt_Identity","LEN([Id])=32 AND LEN([RequestId])=32 AND LEN([OrderId])=32 AND LEN([PayloadHash])=64 AND LEN([SnapshotFingerprint])=64");
                t.HasCheckConstraint("CK_CashAttempt_Amount","[AmountRial]>0 AND [Currency]='IRR'");
                t.HasCheckConstraint("CK_CashAttempt_State","[State] IN ('created','initiating','pending','verified','review','failed','cancelled')");
                t.HasCheckConstraint("CK_CashAttempt_Dates","[CreatedAt]<[OrderExpiresAt] AND [ChangedAt]>=[CreatedAt]");
                t.HasCheckConstraint("CK_CashAttempt_Authority","([AuthorityHash] IS NULL AND [ProtectedAuthority] IS NULL AND [RedirectUri] IS NULL) OR ([AuthorityHash] IS NOT NULL AND [ProtectedAuthority] IS NOT NULL AND LEN([AuthorityHash])=64 AND DATALENGTH([ProtectedAuthority]) BETWEEN 1 AND 4096 AND [RedirectUri] IS NOT NULL)");
                t.HasCheckConstraint("CK_CashAttempt_PendingAuthority","[State] NOT IN ('pending','verified') OR [AuthorityHash] IS NOT NULL");
                t.HasCheckConstraint("CK_CashAttempt_Lease","([LeaseId] IS NULL AND [LeaseUntil] IS NULL) OR ([LeaseId] IS NOT NULL AND LEN([LeaseId])=32 AND [LeaseUntil] IS NOT NULL)");
            });e.HasKey(x=>x.Id);foreach(var name in new[]{"Id","RequestId","OrderId","LeaseId"})e.Property<string>(name).HasMaxLength(32);
            foreach(var name in new[]{"OwnerId","MethodId","AccountKey"})e.Property<string>(name).HasMaxLength(64);e.Property(x=>x.ProviderKey).HasMaxLength(40);e.Property(x=>x.Currency).HasMaxLength(3).IsUnicode(false);
            foreach(var name in new[]{"PayloadHash","SnapshotFingerprint","AuthorityHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.OriginalOrderVersion).HasMaxLength(12);e.Property(x=>x.State).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.ProtectedAuthority).HasMaxLength(4096);e.Property(x=>x.RedirectUri).HasMaxLength(2048);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.OwnerId,x.RequestId}).IsUnique();e.HasIndex(x=>new{x.ProviderKey,x.AccountKey,x.AuthorityHash}).IsUnique().HasFilter("[AuthorityHash] IS NOT NULL");e.HasIndex(x=>new{x.OwnerId,x.CreatedAt,x.Id});e.HasIndex(x=>new{x.State,x.ChangedAt,x.Id});
        });
        b.Entity<CashPaymentEvent>(e=>{e.ToTable("CashPaymentEvents");e.HasKey(x=>x.Id);e.Property(x=>x.AttemptId).HasMaxLength(32);e.Property(x=>x.State).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.Reason).HasMaxLength(100).IsUnicode(false);e.HasIndex(x=>new{x.AttemptId,x.Id});e.HasOne<CashPaymentAttempt>().WithMany().HasForeignKey(x=>x.AttemptId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<CashPaymentVerification>(e=>{
            e.ToTable("CashPaymentVerifications",t=>{
                t.HasCheckConstraint("CK_CashVerification_Identity","LEN([Id])=32 AND LEN([AttemptId])=32 AND LEN([AuthorityHash])=64 AND LEN([ReferenceHash])=64 AND LEN([ProofHash])=64 AND LEN([ResponseHash])=64");
                t.HasCheckConstraint("CK_CashVerification_Amount","[AmountRial]>0");t.HasCheckConstraint("CK_CashVerification_Disposition","[Disposition] IN ('applied','requires_review')");t.HasCheckConstraint("CK_CashVerification_Response","ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=16384");
            });e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.AttemptId).HasMaxLength(32);e.Property(x=>x.ProviderKey).HasMaxLength(40);e.Property(x=>x.AccountKey).HasMaxLength(64);
            foreach(var name in new[]{"AuthorityHash","ReferenceHash","ProofHash","ResponseHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResponseJson).HasMaxLength(8192);e.Property(x=>x.Disposition).HasMaxLength(20).IsUnicode(false);e.Property(x=>x.Reason).HasMaxLength(100).IsUnicode(false);
            e.HasIndex(x=>x.AttemptId).IsUnique();e.HasIndex(x=>new{x.ProviderKey,x.AccountKey,x.ReferenceHash}).IsUnique().HasFilter("[Disposition]='applied'");e.HasOne<CashPaymentAttempt>().WithMany().HasForeignKey(x=>x.AttemptId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
