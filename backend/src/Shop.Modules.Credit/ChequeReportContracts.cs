using System.Globalization;
using System.Numerics;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public sealed record ChequeReportFilter(string From,string Through,string State);
public sealed record ChequeReportRow(string OwnerId,ChequeSummary Cheque,CreditScheduleOrderSummarySource CurrentOrder);
public sealed record ChequeReportStateTotal(string State,int Count,string AmountRial);
public sealed record ChequeReportTotals(int Count,string AmountRial,ChequeReportStateTotal[] States,int OverdueHeldCount,string OverdueHeldRial,int DueTodayHeldCount,string DueTodayHeldRial,int FutureHeldCount,string FutureHeldRial);
public sealed record ChequeReportPage(int SchemaVersion,ChequeReportFilter Filter,string TimeZone,string Today,DateTimeOffset RegistrationCutoff,DateTimeOffset ObservedAt,DateTimeOffset CursorExpiresAt,ChequeReportRow[] Items,ChequeReportTotals PageTotals,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public interface IChequeReportCursorProtection{string Protect(string actor,string text);string Unprotect(string actor,string cursor);}
public static class ChequeReportRules
{
    public const int PageSize=20;public const string TimeZone="Asia/Tehran";
    public static readonly string[] States=["Received","Deposited","CollectedReported","BouncedReported","Withdrawn","ReturnedToCustomer"];
    public static BusinessException Invalid()=>new("invalid_cheque_report","Use an explicit civil date range up to366days, exact state and the same actor-bound report cursor.");
    public static BusinessException Unavailable()=>new("cheque_report_unavailable","The complete retained cheque report could not be verified.");
    public static BusinessException Changed()=>new("cheque_report_changed_conflict","A cheque changed while this page was being read; refresh this report.");
    public static DateOnly Date(string value){if(value is null||value.Length!=10||!DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var date)||date.Year<2000||date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)!=value)throw Invalid();return date;}
    public static void Validate(ChequeReportFilter f){if(f is null)throw Invalid();var from=Date(f.From);var to=Date(f.Through);if(to<from||to.DayNumber-from.DayNumber>365||f.State!="All"&&!States.Contains(f.State,StringComparer.Ordinal))throw Invalid();}
    public static bool Held(string state)=>state is"Received"or"Deposited"or"BouncedReported"or"Withdrawn";
    public static string Today(DateTimeOffset time)=>DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time,TimeZoneInfo.FindSystemTimeZoneById(TimeZone)).DateTime).ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
    public static ChequeReportTotals Totals(IReadOnlyList<ChequeReportRow> rows,DateOnly today)
    {
        if(rows.Count>20)throw Invalid();BigInteger all=0,overdue=0,due=0,future=0;int overCount=0,dueCount=0,futureCount=0;var sums=States.ToDictionary(x=>x,_=>(Count:0,Amount:BigInteger.Zero),StringComparer.Ordinal);
        foreach(var row in rows){var c=row.Cheque;if(!States.Contains(c.State,StringComparer.Ordinal)||!long.TryParse(c.AmountRial,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)||amount<=0||amount.ToString(CultureInfo.InvariantCulture)!=c.AmountRial)throw Unavailable();var date=Date(c.DueDate);all+=amount;var old=sums[c.State];sums[c.State]=(old.Count+1,old.Amount+amount);if(Held(c.State)){if(date<today){overdue+=amount;overCount++;}else if(date==today){due+=amount;dueCount++;}else{future+=amount;futureCount++;}}}
        string Rial(BigInteger v)=>v.ToString(CultureInfo.InvariantCulture);return new(rows.Count,Rial(all),States.Select(s=>new ChequeReportStateTotal(s,sums[s].Count,Rial(sums[s].Amount))).ToArray(),overCount,Rial(overdue),dueCount,Rial(due),futureCount,Rial(future));
    }
}
