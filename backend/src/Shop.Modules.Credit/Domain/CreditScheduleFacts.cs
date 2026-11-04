using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
internal static class CreditScheduleFacts
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=20,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectNullableAnnotations=true,RespectRequiredConstructorParameters=true};
    internal static string FinancialHash(CreditOrderScheduleSource s)=>CreditApplicationRules.Hash(JsonSerializer.Serialize(new{Contract="Sayman.Credit.ScheduleFinancialFacts.v1",s.OwnerId,s.OrderId,s.ApplicationId,s.ScopeId,s.CreditQuoteId,s.QuoteFingerprint,s.CreatedAt,s.ExpiresAt,s.Locale,s.PlanName,s.PayableTotalRial,s.PlanDownPaymentRial,s.Installments},Json));
    internal static string Fingerprint(CreditOrderScheduleSource s,CreditSchedulePreviewInput input,CreditScheduleCalculation calculation)=>CreditApplicationRules.Hash(JsonSerializer.Serialize(new{Contract="Sayman.Credit.SchedulePreview.v1",FinancialHash=FinancialHash(s),Input=input,Calculation=calculation},Json));
    internal static CreditOrderScheduleSource Source(CreditScheduleRevision r)=>new(r.OwnerId,r.OrderId,r.SourceOrderVersion,"AwaitingPayment",r.SourceOrderCreatedAt,r.SourceOrderExpiresAt,r.ApplicationId,r.ScopeId,r.CreditQuoteId,r.QuoteFingerprint,r.Locale,r.PlanName,r.PayableTotalRial,r.PlanDownPaymentRial,r.Lines.OrderBy(x=>x.Sequence).Select(x=>new CreditScheduleInstallmentSource(x.Sequence,x.MonthOffset,x.AmountRial)).ToArray());
    internal static CreditScheduleRevisionData Data(CreditScheduleRevision r)
    {
        try{
            if(r.Version.Length!=8||r.Revision<=0||r.CreatedAt.Offset!=TimeSpan.Zero||r.CreatedAt<r.SourceOrderCreatedAt||r.CreatedAt>=r.SourceOrderExpiresAt)throw CreditScheduleRules.Unavailable();foreach(var id in new[]{r.Id,r.OrderId,r.ApplicationId,r.ScopeId,r.CreditQuoteId})CreditApplicationRules.Id(id);if(r.OwnerId!=CreditApplicationRules.Actor(r.OwnerId)||r.ActorId!=CreditApplicationRules.Actor(r.ActorId))throw CreditScheduleRules.Unavailable();CreditApplicationRules.Version(r.SourceOrderVersion);if(r.PreviousScheduleVersion is{}v)CreditApplicationRules.Version(v);CreditApplicationRules.Locale(r.Locale);if(string.IsNullOrWhiteSpace(r.PlanName)||r.PlanName.Length>200)throw CreditScheduleRules.Unavailable();
            var source=Source(r);var input=new CreditSchedulePreviewInput(r.SourceOrderVersion,r.PreviousScheduleVersion,r.CalendarKind,r.AnchorDate.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture));CreditScheduleRules.Validate(input);var calculation=CreditScheduleCalculator.Calculate(source,input.CalendarKind,input.AnchorDate);
            if(FinancialHash(source)!=r.FinancialHash||Fingerprint(source,input,calculation)!=r.PreviewFingerprint||calculation.UpfrontTotalRial!=Money(r.UpfrontTotalRial)||calculation.InstallmentsTotalRial!=Money(r.InstallmentsTotalRial)||calculation.ChargesOutsideChequesRial!=Money(r.ChargesOutsideChequesRial)||r.Lines.Any(x=>x.RevisionId!=r.Id)||!calculation.Lines.Select(x=>(x.Sequence,x.MonthOffset,x.DueDate,x.AmountRial)).SequenceEqual(r.Lines.OrderBy(x=>x.Sequence).Select(x=>(x.Sequence,x.MonthOffset,x.DueDate.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture),Money(x.AmountRial)))))throw CreditScheduleRules.Unavailable();
            return new(r.Id,r.OrderId,r.Revision,Convert.ToBase64String(r.Version),r.CreditQuoteId,r.QuoteFingerprint,r.PlanName,r.Locale,calculation,r.CreatedAt);
        }catch(BusinessException){throw CreditScheduleRules.Unavailable();}
    }
    private static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
}
