using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed class SourcingOrderLink
{
    public string AgreementId{get;set;}="";public string EventId{get;set;}="";public string PayloadHash{get;set;}="";
    public string OrderId{get;set;}="";public string OwnerId{get;set;}="";public string RequestId{get;set;}="";
    public string TaskId{get;set;}="";public string OfferId{get;set;}="";public string AcceptanceId{get;set;}="";public string AllocationId{get;set;}="";
    public bool ContainsDemo{get;set;}public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset ProjectedAt{get;set;}
}

internal static class SourcingOrderProjectionModel
{
    public static void Configure(ModelBuilder b)=>b.Entity<SourcingOrderLink>(e=>{
        e.ToTable("SourcingOrderLinks",t=>{t.HasCheckConstraint("CK_SourcingOrderLink_Identity","LEN([AgreementId])=32 AND LEN([EventId])=32 AND LEN([OrderId])=32 AND LEN([RequestId])=32 AND LEN([TaskId])=32 AND LEN([OfferId])=32 AND LEN([AcceptanceId])=32 AND LEN([AllocationId])=32");t.HasCheckConstraint("CK_SourcingOrderLink_Dates","[ProjectedAt]>=[CreatedAt]");});
        e.HasKey(x=>x.AgreementId);foreach(var n in new[]{"AgreementId","EventId","OrderId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId"})e.Property<string>(n).HasMaxLength(32);
        e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);
        e.HasIndex(x=>x.EventId).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.RequestId,x.CreatedAt,x.AgreementId});
        e.HasOne<SourcingRequest>().WithMany().HasForeignKey(x=>x.RequestId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<SourcingSupplyTask>().WithMany().HasForeignKey(x=>x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<SourcingOffer>().WithMany().HasForeignKey(x=>x.OfferId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<SourcingOfferAcceptance>().WithMany().HasForeignKey(x=>x.OfferId).OnDelete(DeleteBehavior.Restrict);
    });
}

public sealed class SourcingOrderProjection(MarketDbContext db,TimeProvider clock,bool allowDemo):IMarketOrderProjection
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=4};
    public static SourcingAgreementOrderedEvent Validate(SourcingAgreementOrderedEvent message)
    {
        if(message is null||message.SchemaVersion!=1||message.At.Offset!=TimeSpan.Zero)throw Invalid();
        foreach(var id in new[]{message.EventId,message.OrderId,message.AgreementId,message.RequestId,message.TaskId,message.OfferId,message.AcceptanceId,message.AllocationId})if(SourcingRules.Id(id)!=id)throw Invalid();
        SourcingRules.Actor(message.OwnerId);if(message.AgreementId!=message.AcceptanceId)throw Invalid();return message;
    }
    public async Task ApplyAsync(SourcingAgreementOrderedEvent supplied,CancellationToken ct)
    {
        var m=Validate(supplied);if(m.ContainsDemo&&!allowDemo)throw Missing();
        if(db.Database.CurrentTransaction is not null||System.Transactions.Transaction.Current is not null)throw new InvalidOperationException("Order projections require an independent post-commit transaction.");
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        await using(var command=db.Database.GetDbConnection().CreateCommand()){
            command.Transaction=tx.GetDbTransaction();command.CommandTimeout=12;command.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
            var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:market:order-link:"+m.AgreementId;command.Parameters.Add(p);
            if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("sourcing_projection_busy_conflict","The historical order projection is busy.");
        }
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(m,Json))));
        var previous=await db.SourcingOrderLinks.FromSqlInterpolated($"SELECT * FROM [market].[SourcingOrderLinks] WITH (UPDLOCK,HOLDLOCK) WHERE [AgreementId]={m.AgreementId}").SingleOrDefaultAsync(ct);
        if(previous is not null){await db.Entry(previous).ReloadAsync(ct);if(previous.EventId!=m.EventId||previous.PayloadHash!=hash)throw new BusinessException("sourcing_projection_conflict","The accepted agreement already has a different immutable order projection.");await tx.CommitAsync(ct);return;}
        // Check immutable Market identity only. Current status, price and expiry
        // can change while an outbox acknowledgement is delayed.
        var request=await db.SourcingRequests.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==m.RequestId&&x.OwnerId==m.OwnerId,ct)??throw Missing();
        var task=await db.SourcingSupplyTasks.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==m.TaskId&&x.RequestId==m.RequestId&&x.OwnerId==m.OwnerId,ct)??throw Missing();
        var acceptance=await db.SourcingOfferAcceptances.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==m.AcceptanceId&&x.OfferId==m.OfferId&&x.OwnerId==m.OwnerId,ct)??throw Missing();
        var offer=await db.SourcingOffers.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==m.OfferId&&x.RequestId==m.RequestId,ct)??throw Missing();
        if(task.OfferId!=m.OfferId||task.AcceptanceId!=m.AcceptanceId||task.TermsHash!=acceptance.TermsHash||offer.TermsHash!=acceptance.TermsHash||m.ContainsDemo!=(request.ContainsDemo||task.ContainsDemo||offer.ContainsDemo)||m.At<task.CreatedAt)throw Invalid();
        var now=clock.GetUtcNow();if(now<m.At)throw new BusinessException("sourcing_projection_clock_conflict","The projection clock precedes the committed order event.");
        db.SourcingOrderLinks.Add(new(){AgreementId=m.AgreementId,EventId=m.EventId,PayloadHash=hash,OrderId=m.OrderId,OwnerId=m.OwnerId,RequestId=m.RequestId,TaskId=m.TaskId,OfferId=m.OfferId,AcceptanceId=m.AcceptanceId,AllocationId=m.AllocationId,ContainsDemo=m.ContainsDemo,CreatedAt=m.At,ProjectedAt=now});
        await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);
    }
    public async Task<SourcingOrderLinksData> ReadAsync(string ownerId,string requestId,string? cursor,CancellationToken ct)
    {
        var owner=SourcingRules.Actor(ownerId);var request=SourcingRules.Id(requestId);
        if(!await db.SourcingRequests.AsNoTracking().AnyAsync(x=>x.Id==request&&x.OwnerId==owner&&(allowDemo||!x.ContainsDemo),ct))throw Missing();
        var query=db.SourcingOrderLinks.AsNoTracking().Where(x=>x.RequestId==request&&x.OwnerId==owner&&(allowDemo||!x.ContainsDemo));
        if(cursor is not null){var c=Decode(cursor,owner,request);query=query.Where(x=>x.CreatedAt<c.At||x.CreatedAt==c.At&&string.Compare(x.AgreementId,c.AgreementId)<0);}
        var rows=await query.OrderByDescending(x=>x.CreatedAt).ThenByDescending(x=>x.AgreementId).Take(21).ToArrayAsync(ct);var page=rows.Take(20).ToArray();
        return new(1,request,page.Select(x=>new SourcingOrderLinkData(x.OrderId,x.TaskId,x.OfferId,x.AcceptanceId,x.CreatedAt)).ToArray(),rows.Length>20?Encode(page[^1],owner):null);
    }
    private sealed record Cursor(string OwnerHash,string RequestId,DateTimeOffset At,string AgreementId);
    private static string OwnerHash(string owner)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner.ToUpperInvariant())));
    private static string Encode(SourcingOrderLink row,string owner)=>Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Cursor(OwnerHash(owner),row.RequestId,row.CreatedAt,row.AgreementId),Json)).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static Cursor Decode(string text,string owner,string request){try{if(text.Length is <1 or >512||text.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw new FormatException();var raw=text.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Json)??throw new FormatException();if(value.OwnerHash!=OwnerHash(owner)||value.RequestId!=request||SourcingRules.Id(value.AgreementId)!=value.AgreementId||value.At.Offset!=TimeSpan.Zero)throw new FormatException();return value;}catch(Exception e)when(e is FormatException or JsonException or BusinessException or ArgumentException){throw new BusinessException("invalid_sourcing_order_cursor","The order link page cursor is invalid.");}}
    private static BusinessException Missing()=>new("not_found","The historical sourcing order link was not found.");
    private static BusinessException Invalid()=>new("invalid_sourcing_order_projection","Use the complete immutable committed order event.");
}
