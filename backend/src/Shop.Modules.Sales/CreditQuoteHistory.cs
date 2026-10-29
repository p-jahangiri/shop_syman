using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;
public sealed record CreditQuoteHistoryItem(string Id,string Locale,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,string Fingerprint,string PlanName,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PayableTotalRial,string LimitBasis,string LimitAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? AssessedAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]bool? WithinLimit,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? OrderId);
public sealed record CreditQuoteHistoryPage(int SchemaVersion,CreditQuoteHistoryItem[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed partial class CreditCheckoutQuoteService
{
    public async Task<CreditQuoteHistoryPage> HistoryAsync(string owner,string? cursor,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);var query=db.CreditCheckoutQuotes.AsNoTracking().Where(x=>x.OwnerId==owner);
        if(cursor is not null){var at=DecodeHistory(cursor);query=query.Where(x=>x.CreatedAt<at.At||x.CreatedAt==at.At&&string.Compare(x.Id,at.Id)<0);}
        var rows=await query.OrderByDescending(x=>x.CreatedAt).ThenByDescending(x=>x.Id).Take(21).ToArrayAsync(ct);var page=rows.Take(20).ToArray();var ids=page.Select(x=>x.Id).ToArray();var orders=await db.CreditOrderLinks.AsNoTracking().Where(x=>x.OwnerId==owner&&ids.Contains(x.CreditQuoteId)).Select(x=>new{x.CreditQuoteId,x.OrderId}).ToDictionaryAsync(x=>x.CreditQuoteId,ct);
        var items=page.Select(row=>{var q=Read(row).Quote;var plan=q.OrdinaryQuote?.SelectedPlan??q.AcceptedQuote!.SelectedPlan!;return new CreditQuoteHistoryItem(q.Id,q.Locale,q.CreatedAt,q.ExpiresAt,q.Fingerprint,plan.Name,q.OrdinaryQuote?.PayableTotalRial??q.AcceptedQuote?.PayableTotalRial,q.Authority.LimitBasis,q.Authority.LimitAmountRial,q.Assessment.AssessedAmountRial,q.Assessment.WithinLimit,orders.GetValueOrDefault(q.Id)?.OrderId);}).ToArray();
        return new(1,items,rows.Length>20?EncodeHistory(page[^1]):null);
    }
    private sealed record HistoryCursor(DateTimeOffset At,string Id);
    private static string EncodeHistory(CreditCheckoutQuote row)=>Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new HistoryCursor(row.CreatedAt,row.Id)))).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static HistoryCursor DecodeHistory(string cursor)
    {
        try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw CreditCheckoutQuoteRules.Invalid();var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<HistoryCursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),new JsonSerializerOptions{MaxDepth=4})??throw CreditCheckoutQuoteRules.Invalid();CreditCheckoutQuoteRules.Id(value.Id);if(value.At.Offset!=TimeSpan.Zero||EncodeHistory(new(){Id=value.Id,CreatedAt=value.At})!=cursor)throw CreditCheckoutQuoteRules.Invalid();return value;}catch(Exception e)when(e is JsonException or FormatException or ArgumentException){throw CreditCheckoutQuoteRules.Invalid();}
    }
}
