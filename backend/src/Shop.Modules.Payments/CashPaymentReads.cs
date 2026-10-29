using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Payments;
public sealed record CashPaymentFilter([property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? State,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? OrderId);
public sealed record CashPaymentReadItem(string Id,string OrderId,string State,string AmountRial,string Currency,
    DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,DateTimeOffset OrderExpiresAt,string Version,bool ContainsDemo,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? VerifiedAmountRial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? VerificationDisposition,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? VerificationReason,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? VerifiedAt);
public sealed record CashPaymentPage(int SchemaVersion,CashPaymentFilter Filter,CashPaymentReadItem[] Items,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record CashPaymentDetail(int SchemaVersion,CashPaymentReadItem Attempt);
public sealed class CashPaymentReadService(PaymentsDbContext db,bool allowDemo=false)
{
    private sealed record Cursor(int SchemaVersion,string Scope,DateTimeOffset At,string Id);
    private sealed record Projection(string Id,string OrderId,string State,long AmountRial,string Currency,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,DateTimeOffset OrderExpiresAt,byte[] Version,bool ContainsDemo,long? VerifiedAmount,string? Disposition,string? Reason,DateTimeOffset? VerifiedAt,bool? VerificationContainsDemo);
    public async Task<CashPaymentPage> PageAsync(string? ownerId,CashPaymentFilter filter,string? cursor,CancellationToken ct)
    {
        if(ownerId is not null&&!CashPaymentProofRules.Key(ownerId,64))throw Invalid();filter=Normalize(filter);var scope=Scope(ownerId,filter);var seek=cursor is null?null:Decode(cursor,scope);
        var query=db.CashAttempts.AsNoTracking().Where(a=>allowDemo||!a.ContainsDemo);if(ownerId is not null)query=query.Where(a=>a.OwnerId==ownerId);if(filter.State is not null)query=query.Where(a=>a.State==filter.State);if(filter.OrderId is not null)query=query.Where(a=>a.OrderId==filter.OrderId);
        if(seek is not null)query=query.Where(a=>a.CreatedAt<seek.At||a.CreatedAt==seek.At&&string.Compare(a.Id,seek.Id)<0);
        var rows=await Project(query.OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id)).Take(51).ToArrayAsync(ct);
        var page=rows.Take(50).ToArray();var result=page.Select(Read).ToArray();return new(1,filter,result,rows.Length<=50?null:Encode(new(1,scope,page[^1].CreatedAt,page[^1].Id)));
    }
    private IQueryable<Projection> Project(IQueryable<CashPaymentAttempt> query)=>query.Select(a=>new Projection(a.Id,a.OrderId,a.State,a.AmountRial,a.Currency,a.CreatedAt,a.ChangedAt,a.OrderExpiresAt,a.Version,a.ContainsDemo,
            db.CashVerifications.Where(v=>v.AttemptId==a.Id).Select(v=>(long?)v.AmountRial).FirstOrDefault(),db.CashVerifications.Where(v=>v.AttemptId==a.Id).Select(v=>v.Disposition).FirstOrDefault(),db.CashVerifications.Where(v=>v.AttemptId==a.Id).Select(v=>v.Reason).FirstOrDefault(),db.CashVerifications.Where(v=>v.AttemptId==a.Id).Select(v=>(DateTimeOffset?)v.VerifiedAt).FirstOrDefault(),db.CashVerifications.Where(v=>v.AttemptId==a.Id).Select(v=>(bool?)v.ContainsDemo).FirstOrDefault()));
    public async Task<CashPaymentDetail> DetailAsync(string ownerId,string attemptId,CancellationToken ct)
    {
        if(!CashPaymentProofRules.Key(ownerId,64))throw Invalid();var id=CashPaymentProofRules.Id(attemptId);var row=await Project(db.CashAttempts.AsNoTracking().Where(a=>a.OwnerId==ownerId&&a.Id==id&&(allowDemo||!a.ContainsDemo))).SingleOrDefaultAsync(ct)??throw new BusinessException("not_found","Payment attempt not found.");return new(1,Read(row));
    }
    private static CashPaymentReadItem Read(Projection row)
    {
        _=CashPaymentProofRules.Id(row.Id);_=CashPaymentProofRules.Id(row.OrderId);if(row.AmountRial<=0||row.Currency!="IRR"||row.CreatedAt>=row.OrderExpiresAt||row.CreatedAt>row.ChangedAt||row.CreatedAt.Offset!=TimeSpan.Zero||row.ChangedAt.Offset!=TimeSpan.Zero||row.OrderExpiresAt.Offset!=TimeSpan.Zero||row.Version.Length!=8||!State(row.State))throw Unavailable();
        if(row.VerifiedAmount is null){if(row.Disposition is not null||row.Reason is not null||row.VerifiedAt is not null||row.VerificationContainsDemo is not null||row.State=="verified")throw Unavailable();}
        else if(row.VerificationContainsDemo!=row.ContainsDemo||row.VerifiedAmount<=0||row.VerifiedAt is null||row.VerifiedAt.Value.Offset!=TimeSpan.Zero||row.VerifiedAt<row.CreatedAt||row.VerifiedAt>row.ChangedAt||row.Reason is null||row.Reason.Length is <1 or >100||row.Reason.Any(c=>c is not(>= 'a' and <= 'z' or '_'))||row.Disposition is not("applied" or "requires_review")||row.State!=(row.Disposition=="applied"?"verified":"review")||row.Disposition=="applied"&&row.VerifiedAmount!=row.AmountRial)throw Unavailable();
        return new(row.Id,row.OrderId,row.State,row.AmountRial.ToString(CultureInfo.InvariantCulture),"IRR",row.CreatedAt,row.ChangedAt,row.OrderExpiresAt,Convert.ToBase64String(row.Version),row.ContainsDemo,row.VerifiedAmount?.ToString(CultureInfo.InvariantCulture),row.Disposition,row.Reason,row.VerifiedAt);
    }
    public static CashPaymentFilter Normalize(CashPaymentFilter filter)
    {
        if(filter.State is not null&&!State(filter.State))throw Invalid();if(filter.OrderId is not null)_=CashPaymentProofRules.Id(filter.OrderId);return filter;
    }
    private static bool State(string s)=>s is "created" or "initiating" or "pending" or "verified" or "review" or "failed" or "cancelled";
    private static string Scope(string? owner,CashPaymentFilter filter)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new{Owner=owner?.ToUpperInvariant(),Filter=filter})));
    private static string Encode(Cursor c)=>Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(c)).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static Cursor Decode(string value,string scope)
    {
        try{if(value.Length is <1 or >512||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-' or '_')))throw Invalid();var raw=value.Replace('-','+').Replace('_','/');var bytes=Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'='));var c=JsonSerializer.Deserialize<Cursor>(bytes,new JsonSerializerOptions{UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true,MaxDepth=4})??throw Invalid();if(c.SchemaVersion!=1||c.Scope!=scope||c.At==default||c.At.Offset!=TimeSpan.Zero||Encode(c)!=value)throw Invalid();_=CashPaymentProofRules.Id(c.Id);return c;}
        catch(Exception e)when(e is FormatException or JsonException or ArgumentException){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("invalid_payment_filter","Use a supported state, canonical order id and cursor for the same private scope.");
    private static BusinessException Unavailable()=>new("payment_attempt_unavailable","The payment history is inconsistent; no success was inferred.");
}
