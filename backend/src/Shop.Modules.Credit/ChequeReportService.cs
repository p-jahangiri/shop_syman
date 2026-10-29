using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed class ChequeReportService(CreditDbContext db,ChequeLedgerService ledger,ICreditOrderFinanceSummaries orders,IChequeReportCursorProtection protection,TimeProvider clock)
{
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed record Cursor(int SchemaVersion,ChequeReportFilter Filter,DateTimeOffset Cutoff,string Today,DateOnly LastDate,string LastId);
    private sealed class Candidate
    {
        public string Id{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ScheduleId{get;set;}="";
        public int Sequence{get;set;}public DateOnly DueDate{get;set;}public long AmountRial{get;set;}public string? State{get;set;}public byte[]? Version{get;set;}
    }
    private static readonly TimeSpan Lifetime=TimeSpan.FromMinutes(15);
    private Cursor ReadCursor(string actor,ChequeReportFilter filter,string token,DateTimeOffset now)
    {
        Cursor c;
        try{c=JsonSerializer.Deserialize<Cursor>(protection.Unprotect(actor,token),CreditScheduleFacts.Json)??throw ChequeReportRules.Invalid();}
        catch(JsonException){throw ChequeReportRules.Invalid();}
        if(c.SchemaVersion!=1||c.Filter!=filter||c.Cutoff.Offset!=TimeSpan.Zero||c.Cutoff.Year<2000||c.Cutoff>now||c.Today!=ChequeReportRules.Today(c.Cutoff)||c.LastDate<ChequeReportRules.Date(filter.From)||c.LastDate>ChequeReportRules.Date(filter.Through))throw ChequeReportRules.Invalid();
        CreditApplicationRules.Id(c.LastId);if(c.Cutoff+Lifetime<=now)throw new BusinessException("cheque_report_expired_conflict","Start a fresh report; this technical cursor has expired.");return c;
    }
    public async Task<ChequeReportPage> ReadAsync(string actor,ChequeReportFilter filter,string? cursor,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Cheque reports require the root Sales/Credit Serializable transaction.");
        actor=CreditApplicationRules.Actor(actor);ChequeReportRules.Validate(filter);var now=clock.GetUtcNow().ToUniversalTime();
        var saved=cursor is null?null:ReadCursor(actor,filter,cursor,now);var cutoff=saved?.Cutoff??now;var today=saved?.Today??ChequeReportRules.Today(cutoff);
        var from=ChequeReportRules.Date(filter.From);var through=ChequeReportRules.Date(filter.Through);var lastDate=saved?.LastDate??from;var lastId=saved?.LastId??"";var hasCursor=saved is not null;
        // Candidate reads precede the owner gates. Never retain Serializable range locks here:
        // ledger writers take the Sales owner gate before inserting their event/receipt.
        var candidates=await db.Database.SqlQuery<Candidate>($"""
            SELECT TOP (21) c.[Id],c.[OwnerId],c.[OrderId],c.[ScheduleId],c.[Sequence],c.[DueDate],c.[AmountRial],h.[State],h.[Version]
            FROM [credit].[ReceivedCheques] c WITH (READCOMMITTEDLOCK)
            OUTER APPLY (SELECT TOP (1) e.[State],e.[Version] FROM [credit].[ChequeLedgerEvents] e WITH (READCOMMITTEDLOCK)
                WHERE e.[ChequeId]=c.[Id] ORDER BY e.[Sequence] DESC) h
            WHERE c.[DueDate]>={from} AND c.[DueDate]<={through} AND c.[RecordedAt]<={cutoff}
                AND ({filter.State}='All' OR h.[State]={filter.State})
                AND ({hasCursor}=CAST(0 AS bit) OR c.[DueDate]>{lastDate} OR (c.[DueDate]={lastDate} AND c.[Id]>{lastId}))
            ORDER BY c.[DueDate],c.[Id]
            """).ToArrayAsync(ct);
        var selected=candidates.Take(ChequeReportRules.PageSize).ToArray();var verified=new Dictionary<string,ChequeSummary>(StringComparer.Ordinal);
        // Every report takes multiple owners in the same order. Each detail verifies the
        // retained financial source, sealed registration, current event and command receipt.
        foreach(var candidate in selected.OrderBy(x=>x.OwnerId,StringComparer.Ordinal).ThenBy(x=>x.OrderId,StringComparer.Ordinal).ThenBy(x=>x.Id,StringComparer.Ordinal))
        {
            var detail=await ledger.DetailAsync(candidate.OwnerId,candidate.OrderId,candidate.Id,false,ct);var c=detail.Cheque;
            if(candidate.State is null||candidate.Version is null)throw ChequeReportRules.Unavailable();
            if(c.State!=candidate.State||c.Version!=Convert.ToBase64String(candidate.Version))throw ChequeReportRules.Changed();
            if(c.Id!=candidate.Id||c.OrderId!=candidate.OrderId||c.ScheduleId!=candidate.ScheduleId||c.Sequence!=candidate.Sequence||c.DueDate!=candidate.DueDate.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)||c.AmountRial!=candidate.AmountRial.ToString(CultureInfo.InvariantCulture)||c.BankVerified)throw ChequeReportRules.Unavailable();
            verified.Add(c.Id,c);
        }
        var sources=selected.Length==0?[]:await orders.ReadAsync(selected.Select(x=>x.OrderId).Distinct(StringComparer.Ordinal).ToArray(),ct);
        var rows=selected.Select(c=>{var order=sources.SingleOrDefault(x=>x.OrderId==c.OrderId)??throw ChequeReportRules.Unavailable();if(order.OwnerId!=c.OwnerId)throw ChequeReportRules.Unavailable();return new ChequeReportRow(c.OwnerId,verified[c.Id],order);}).ToArray();
        string? next=null;if(candidates.Length>ChequeReportRules.PageSize){var last=selected[^1];next=protection.Protect(actor,JsonSerializer.Serialize(new Cursor(1,filter,cutoff,today,last.DueDate,last.Id),CreditScheduleFacts.Json));}
        var observed=clock.GetUtcNow().ToUniversalTime();if(observed<now||observed>=cutoff+Lifetime)throw new BusinessException("cheque_report_expired_conflict","Start a fresh report; this technical cursor has expired.");
        return new(1,filter,ChequeReportRules.TimeZone,today,cutoff,observed,cutoff+Lifetime,rows,ChequeReportRules.Totals(rows,ChequeReportRules.Date(today)),next);
    }
}
