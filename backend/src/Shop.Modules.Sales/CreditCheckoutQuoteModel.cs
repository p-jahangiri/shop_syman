using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditCheckoutQuoteInput(string CartVersion,string MethodId,string PlanId,string ApplicationId,string ScopeId,string ApplicationVersion,string ScopeVersion);
public sealed record CreditCheckoutQuoteData(int SchemaVersion,string Id,string Locale,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,string Fingerprint,CreditQuoteAuthorityData Authority,CreditQuoteAssessmentData Assessment,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CheckoutQuoteData? OrdinaryQuote,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CheckoutQuoteV5Data? AcceptedQuote,bool CanPlaceOrder=false,bool CanPay=false);
public sealed record CreditCheckoutQuoteResult(int SchemaVersion,bool Replayed,string CommandId,CreditCheckoutQuoteData Quote);
public interface ICreditCheckoutQuoteProtection
{
    byte[] Protect(string owner,string quoteId,string text);
    string Unprotect(string owner,string quoteId,byte[] bytes);
}
public sealed class CreditCheckoutQuote
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string Locale{get;set;}="";public string OwnerId{get;set;}="";public string CommandId{get;set;}="";public string PayloadHash{get;set;}="";
    public string BaseQuoteId{get;set;}="";public int BaseContractVersion{get;set;}public string BaseSnapshotHash{get;set;}="";public string Fingerprint{get;set;}="";
    public string ApplicationId{get;set;}="";public string ApplicationVersion{get;set;}="";public string ScopeId{get;set;}="";public string ScopeVersion{get;set;}="";public string ReviewId{get;set;}="";public string SubmissionId{get;set;}="";
    public string PlanId{get;set;}="";public string PlanVersion{get;set;}="";public string PlanSnapshotHash{get;set;}="";
    public string LimitBasis{get;set;}="";public long LimitAmountRial{get;set;}public DateTimeOffset ScopeExpiresAt{get;set;}public long? AssessedAmountRial{get;set;}public bool? WithinLimit{get;set;}
    public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset ExpiresAt{get;set;}
    public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];
}
internal static class CreditCheckoutQuoteModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditCheckoutQuote>(e=>{
            e.ToTable("CreditCheckoutQuotes",t=>{
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Locale","[Locale] IN ('fa','en')");
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Contract","[BaseContractVersion] IN (3,5)");
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Basis","[LimitBasis] IN ('PayableTotalRial','InstallmentsTotalRial')");
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Limit","[LimitAmountRial]>0 AND (([AssessedAmountRial] IS NULL AND [WithinLimit] IS NULL) OR ([AssessedAmountRial] IS NOT NULL AND [WithinLimit] IS NOT NULL AND [AssessedAmountRial]>=0 AND (([AssessedAmountRial]<=[LimitAmountRial] AND [WithinLimit]=1) OR ([AssessedAmountRial]>[LimitAmountRial] AND [WithinLimit]=0))))");
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Time","[ExpiresAt]>[CreatedAt] AND [ExpiresAt]<=[ScopeExpiresAt] AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ExpiresAt])=0 AND DATEPART(TZOFFSET,[ScopeExpiresAt])=0");
                t.HasCheckConstraint("CK_CreditCheckoutQuote_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 1572864");
            });
            e.HasKey(x=>x.Id);foreach(var name in new[]{"Id","CommandId","ApplicationId","ScopeId","ReviewId","SubmissionId"})e.Property<string>(name).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.BaseQuoteId).HasMaxLength(32);e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.PlanId).HasMaxLength(64);e.Property(x=>x.LimitBasis).HasMaxLength(32).IsUnicode(false);
            foreach(var name in new[]{"ApplicationVersion","ScopeVersion","PlanVersion"})e.Property<string>(name).HasMaxLength(12).IsUnicode(false);
            foreach(var name in new[]{"PayloadHash","BaseSnapshotHash","Fingerprint","PlanSnapshotHash","ResultHash"})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.ProtectedResult).HasMaxLength(1572864);e.HasIndex(x=>new{x.OwnerId,x.CommandId}).IsUnique();e.HasIndex(x=>x.BaseQuoteId).IsUnique();e.HasIndex(x=>new{x.ScopeId,x.CreatedAt});
            e.HasOne<CheckoutQuote>().WithMany().HasForeignKey(x=>x.BaseQuoteId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public static class CreditCheckoutQuoteRules
{
    public static string Id(string value)=>value is{Length:32}&&value.Any(c=>c!='0')&&value.All(c=>c is >= 'a' and <= 'f' or >= '0' and <= '9')?value:throw Invalid();
    public static string Owner(string value)=>!string.IsNullOrWhiteSpace(value)&&value==value.Trim()&&value.Length<=64&&!value.Any(char.IsControl)?value:throw Invalid();
    public static string Version(string value){try{if(value.Length!=12||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();return value;}catch(Exception e)when(e is FormatException or NullReferenceException){throw Invalid();}}
    public static CreditCheckoutQuoteInput Validate(CreditCheckoutQuoteInput x){if(x is null)throw Invalid();Version(x.CartVersion);Version(x.ApplicationVersion);Version(x.ScopeVersion);Id(x.ApplicationId);Id(x.ScopeId);foreach(var k in new[]{x.PlanId,x.MethodId})if(k is not{Length:>0 and <=64}||k.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_'))||k!=k.ToLowerInvariant())throw Invalid();return x;}
    public static BusinessException Invalid()=>new("invalid_credit_quote","Use the current cart, method, plan and explicit owned purchase scope versions.");
    public static BusinessException Unavailable()=>new("credit_quote_unavailable","The private cheque quote could not be verified.");
    public static BusinessException Missing()=>new("not_found","The private cheque quote was not found.");
}
