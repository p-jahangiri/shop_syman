using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;

// Sales owns the immutable successful payment -> order link. Other attempts and
// review outcomes belong to Payments; no FK crosses a module boundary.
public sealed class OrderCashPayment
{
    public string OrderId {get;set;}="";
    public string AttemptId {get;set;}="";
    public string VerificationId {get;set;}="";
    public string OwnerId {get;set;}="";
    public string MethodId {get;set;}="";
    public string ProviderKey {get;set;}="";
    public string AccountKey {get;set;}="";
    public string AuthorityHash {get;set;}="";
    public string ReferenceHash {get;set;}="";
    public string SnapshotFingerprint {get;set;}="";
    public string ProofHash {get;set;}="";
    public long AmountRial {get;set;}
    public DateTimeOffset VerifiedAt {get;set;}
    public DateTimeOffset RecordedAt {get;set;}
    public bool ContainsDemo {get;set;}
    public string ResponseJson {get;set;}="";
    public string ResponseHash {get;set;}="";
}
internal static class OrderCashPaymentModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<OrderCashPayment>(e=>{
            e.ToTable("OrderCashPayments",t=>{
                t.HasCheckConstraint("CK_OrderCashPayment_Identity","LEN([OrderId])=32 AND LEN([AttemptId])=32 AND LEN([VerificationId])=32 AND LEN([ProofHash])=64 AND LEN([AuthorityHash])=64 AND LEN([ReferenceHash])=64 AND LEN([SnapshotFingerprint])=64 AND LEN([ResponseHash])=64");
                t.HasCheckConstraint("CK_OrderCashPayment_Amount","[AmountRial]>0");
                t.HasCheckConstraint("CK_OrderCashPayment_Dates","[VerifiedAt]<=[RecordedAt]");
                t.HasCheckConstraint("CK_OrderCashPayment_Response","ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=16384");
            });
            e.HasKey(x=>x.OrderId);foreach(var name in new[]{"OrderId","AttemptId","VerificationId"})e.Property<string>(name).HasMaxLength(32);
            foreach(var name in new[]{"OwnerId","MethodId","AccountKey"})e.Property<string>(name).HasMaxLength(64);
            e.Property(x=>x.ProviderKey).HasMaxLength(40);
            foreach(var name in new[]{"ProofHash","AuthorityHash","ReferenceHash","SnapshotFingerprint","ResponseHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.ResponseJson).HasMaxLength(8192);
            e.HasIndex(x=>x.AttemptId).IsUnique();e.HasIndex(x=>x.VerificationId).IsUnique();
            e.HasIndex(x=>new{x.ProviderKey,x.AccountKey,x.ReferenceHash}).IsUnique();
            e.HasIndex(x=>new{x.ProviderKey,x.AccountKey,x.AuthorityHash}).IsUnique();
            e.HasOne<SalesOrder>().WithMany().HasForeignKey(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
