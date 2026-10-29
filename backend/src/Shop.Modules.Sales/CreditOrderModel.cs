using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;
public sealed class CreditOrderLink
{
    public string OrderId{get;set;}="";public string OwnerId{get;set;}="";public string CommandId{get;set;}="";public string PayloadHash{get;set;}="";public string CreditQuoteId{get;set;}="";public string ApplicationId{get;set;}="";public string ScopeId{get;set;}="";public string QuoteFingerprint{get;set;}="";public string LimitBasis{get;set;}="";public long LimitAmountRial{get;set;}public long AssessedAmountRial{get;set;}public DateTimeOffset AcceptedAt{get;set;}public byte[] ProtectedResult{get;set;}=[];public string ResultHash{get;set;}="";
}
internal static class CreditOrderModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditOrderLink>(e=>{
            e.ToTable("CreditOrderLinks",t=>{t.HasCheckConstraint("CK_CreditOrderLink_Amount","[LimitAmountRial]>0 AND [AssessedAmountRial]>=0 AND [AssessedAmountRial]<=[LimitAmountRial]");t.HasCheckConstraint("CK_CreditOrderLink_Basis","[LimitBasis] IN ('PayableTotalRial','InstallmentsTotalRial')");t.HasCheckConstraint("CK_CreditOrderLink_Time","DATEPART(TZOFFSET,[AcceptedAt])=0");t.HasCheckConstraint("CK_CreditOrderLink_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 1572864");});
            e.HasKey(x=>x.OrderId);e.Property(x=>x.OrderId).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);foreach(var n in new[]{"CommandId","CreditQuoteId","ApplicationId","ScopeId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            foreach(var n in new[]{"PayloadHash","QuoteFingerprint","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.LimitBasis).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(1572864);
            e.HasIndex(x=>new{x.OwnerId,x.CommandId}).IsUnique();e.HasIndex(x=>x.CreditQuoteId).IsUnique();e.HasIndex(x=>x.ScopeId).IsUnique();
            e.HasOne<SalesOrder>().WithMany().HasForeignKey(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditCheckoutQuote>().WithMany().HasForeignKey(x=>x.CreditQuoteId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
