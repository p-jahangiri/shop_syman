using System.Globalization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public static class CreditScheduleCalculator
{
    public const string TimeZone="Asia/Tehran";
    public static CreditScheduleCalculation Calculate(CreditOrderScheduleSource source,string calendarKind,string anchorDate)
    {
        if(source is null||calendarKind is not("Persian"or"Gregorian"))throw CreditScheduleRules.Invalid();var anchor=CreditScheduleRules.Date(anchorDate);
        var createdDay=DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(source.CreatedAt,TimeZoneInfo.FindSystemTimeZoneById(TimeZone)).DateTime);
        if(source.CreatedAt.Offset!=TimeSpan.Zero||source.ExpiresAt<=source.CreatedAt||anchor<createdDay||source.PayableTotalRial<=0||source.PlanDownPaymentRial<0||source.Installments is null||source.Installments.Length>60)throw CreditScheduleRules.Invalid();
        try{
            long sum=0;var lines=new List<CreditScheduleLineData>();var lastOffset=0;var lastDate=anchor;var calendar=new PersianCalendar();
            for(var i=0;i<source.Installments.Length;i++){
                var line=source.Installments[i];if(line.Sequence!=i+1||line.MonthOffset<=lastOffset||line.MonthOffset>60||line.AmountRial<=0)throw CreditScheduleRules.Invalid();sum=checked(sum+line.AmountRial);
                // Both calendar implementations clamp a missing day to the last
                // valid day of the destination month. Never chain from a prior
                // due date: every offset is measured from the original anchor.
                var due=calendarKind=="Gregorian"?anchor.AddMonths(line.MonthOffset):DateOnly.FromDateTime(calendar.AddMonths(anchor.ToDateTime(TimeOnly.MinValue),line.MonthOffset));if(due<=lastDate)throw CreditScheduleRules.Invalid();
                lines.Add(new(line.Sequence,line.MonthOffset,due.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture),Money(line.AmountRial)));lastOffset=line.MonthOffset;lastDate=due;
            }
            var upfront=checked(source.PayableTotalRial-sum);var outside=checked(upfront-source.PlanDownPaymentRial);if(upfront<0||outside<0)throw CreditScheduleRules.Invalid();
            return new(calendarKind,anchorDate,TimeZone,Money(source.PlanDownPaymentRial),Money(outside),Money(upfront),Money(sum),Money(source.PayableTotalRial),lines.ToArray());
        }catch(Exception e)when(e is OverflowException or ArgumentOutOfRangeException){throw CreditScheduleRules.Invalid();}
    }
    private static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
}
