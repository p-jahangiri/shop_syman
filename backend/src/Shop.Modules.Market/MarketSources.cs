using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

// The listing remains the stable model/sourcing identity. Its original source
// is primary; extra sources never multiply catalogue models or sourcing lines.
public sealed class MarketSource
{
    public string Id{get;set;}="";public string ListingId{get;set;}="";
    public string Status{get;set;}="Draft";public string SourceKey{get;set;}="";public string SourceItemKey{get;set;}="";
    public string SourceNameFa{get;set;}="";public string SourceNameEn{get;set;}="";public string? SourceUrl{get;set;}
    public string Availability{get;set;}="unknown";public DateTimeOffset? ObservedAt{get;set;}public DateTimeOffset? ValidUntil{get;set;}
    public long? ReferencePriceRial{get;set;}public bool IsDemo{get;set;}public DateTimeOffset UpdatedAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class MarketSourceObservation
{
    public long Sequence{get;set;}public string ListingId{get;set;}="";public string SourceId{get;set;}="";public bool IsPrimary{get;set;}
    public string Origin{get;set;}="recorded";public DateTimeOffset RecordedAt{get;set;}
    public string Status{get;set;}="Draft";public string SourceKey{get;set;}="";public string SourceItemKey{get;set;}="";
    public string SourceNameFa{get;set;}="";public string SourceNameEn{get;set;}="";public string? SourceUrl{get;set;}
    public string Availability{get;set;}="unknown";public DateTimeOffset? ObservedAt{get;set;}public DateTimeOffset? ValidUntil{get;set;}
    public long? ReferencePriceRial{get;set;}public bool IsDemo{get;set;}
}
public sealed class MarketSourceCommand
{
    public string ActorId{get;set;}="";public string RequestId{get;set;}="";public string PayloadHash{get;set;}="";
    public string ResultJson{get;set;}="";public bool ContainsDemo{get;set;}public DateTimeOffset RecordedAt{get;set;}
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketSourceInput(string ListingVersion,string? SourceVersion,MarketDetailsInput Details);
public sealed record MarketSourceResult(int SchemaVersion,string RequestId,string ListingId,string SourceId,string ListingVersion,string SourceVersion,bool Replayed);
public sealed record MarketAdminSource(string Id,bool IsPrimary,MarketDetailsInput Details,string Version);
public sealed record MarketAdminSources(int SchemaVersion,string ListingId,string ListingVersion,MarketAdminSource[] Sources);
public sealed record MarketSourceDto(string Id,bool IsPrimary,string SourceName,string? SourceUrl,string Availability,DateTimeOffset? ObservedAt,DateTimeOffset? ValidUntil,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReferencePriceRial,bool ReferencePriceCurrent,bool IsDemo);
public sealed record MarketSourcesDto(int SchemaVersion,string Locale,string ListingId,MarketSourceDto[] Sources);
public sealed record MarketObservationDto(string Sequence,string Origin,DateTimeOffset RecordedAt,MarketSourceDto Source);
public sealed record MarketObservationsDto(int SchemaVersion,string Locale,string ListingId,string SourceId,MarketObservationDto[] Items,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextBefore);

public static class MarketSourceModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<MarketSource>(e=>{
            e.ToTable("Sources",t=>{
                t.HasCheckConstraint("CK_MarketSource_Status","[Status] IN ('Draft','Published','Hidden')");
                t.HasCheckConstraint("CK_MarketSource_Availability","[Availability] IN ('unknown','available','unavailable')");
                t.HasCheckConstraint("CK_MarketSource_Observation","([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");
                t.HasCheckConstraint("CK_MarketSource_Price","[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                t.HasCheckConstraint("CK_MarketSource_Id","[Id]<>[ListingId]");
            });
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);e.HasIndex(x=>new{x.SourceKey,x.SourceItemKey}).IsUnique();
            e.HasIndex(x=>new{x.ListingId,x.Id});e.Property(x=>x.Status).HasMaxLength(16);e.Property(x=>x.Availability).HasMaxLength(16);
            e.Property(x=>x.SourceKey).HasMaxLength(64);e.Property(x=>x.SourceItemKey).HasMaxLength(120);e.Property(x=>x.SourceNameFa).HasMaxLength(200);e.Property(x=>x.SourceNameEn).HasMaxLength(200);e.Property(x=>x.SourceUrl).HasMaxLength(1500);
            e.Property(x=>x.ReferencePriceRial).HasColumnType("bigint");e.Property(x=>x.Version).IsRowVersion();e.HasOne<MarketListing>().WithMany().HasForeignKey(x=>x.ListingId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<MarketSourceObservation>(e=>{
            e.ToTable("SourceObservations",t=>{
                t.HasCheckConstraint("CK_MarketObservation_Origin","[Origin] IN ('recorded','migrationBaseline')");
                t.HasCheckConstraint("CK_MarketObservation_Status","[Status] IN ('Draft','Published','Hidden')");
                t.HasCheckConstraint("CK_MarketObservation_Availability","[Availability] IN ('unknown','available','unavailable')");
                t.HasCheckConstraint("CK_MarketObservation_Price","[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                t.HasCheckConstraint("CK_MarketObservation_Time","([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt] AND [ObservedAt]<=[RecordedAt])");
                t.HasCheckConstraint("CK_MarketObservation_Primary","([IsPrimary]=1 AND [SourceId]=[ListingId]) OR ([IsPrimary]=0 AND [SourceId]<>[ListingId])");
            });
            e.HasKey(x=>x.Sequence);e.Property(x=>x.Sequence).UseIdentityColumn();e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.SourceId).HasMaxLength(32);e.HasIndex(x=>new{x.ListingId,x.SourceId,x.Sequence});
            e.Property(x=>x.Origin).HasMaxLength(24);e.Property(x=>x.Status).HasMaxLength(16);e.Property(x=>x.Availability).HasMaxLength(16);e.Property(x=>x.SourceKey).HasMaxLength(64);e.Property(x=>x.SourceItemKey).HasMaxLength(120);e.Property(x=>x.SourceNameFa).HasMaxLength(200);e.Property(x=>x.SourceNameEn).HasMaxLength(200);e.Property(x=>x.SourceUrl).HasMaxLength(1500);e.Property(x=>x.ReferencePriceRial).HasColumnType("bigint");
            e.HasOne<MarketListing>().WithMany().HasForeignKey(x=>x.ListingId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<MarketSourceCommand>(e=>{
            e.ToTable("SourceCommands",t=>t.HasCheckConstraint("CK_MarketSourceCommand_Json","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=32000"));e.HasKey(x=>new{x.ActorId,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(16000);
        });
    }
}

public sealed partial class MarketService
{
    private static readonly JsonSerializerOptions SourceJson=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    private static MarketDetailsInput Details(MarketListing l)=>new(l.Status,l.SourceKey,l.SourceItemKey,l.SourceNameFa,l.SourceNameEn,l.SourceUrl,l.Availability,l.ObservedAt,l.ValidUntil,l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.IsDemo);
    private static MarketDetailsInput Details(MarketSource l)=>new(l.Status,l.SourceKey,l.SourceItemKey,l.SourceNameFa,l.SourceNameEn,l.SourceUrl,l.Availability,l.ObservedAt,l.ValidUntil,l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.IsDemo);
    private static MarketDetailsInput Details(MarketSourceObservation l)=>new(l.Status,l.SourceKey,l.SourceItemKey,l.SourceNameFa,l.SourceNameEn,l.SourceUrl,l.Availability,l.ObservedAt,l.ValidUntil,l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.IsDemo);
    private void RecordObservation(string listingId,string sourceId,bool primary,MarketDetailsInput d,DateTimeOffset recordedAt)
    {
        db.SourceObservations.Add(new(){ListingId=listingId,SourceId=sourceId,IsPrimary=primary,RecordedAt=recordedAt,Status=d.Status,SourceKey=d.SourceKey,SourceItemKey=d.SourceItemKey.Trim(),SourceNameFa=d.SourceNameFa.Trim(),SourceNameEn=d.SourceNameEn.Trim(),SourceUrl=d.SourceUrl,Availability=d.Availability,ObservedAt=d.ObservedAt?.ToUniversalTime(),ValidUntil=d.ValidUntil?.ToUniversalTime(),ReferencePriceRial=d.ReferencePriceRial is null?null:long.Parse(d.ReferencePriceRial,CultureInfo.InvariantCulture),IsDemo=d.IsDemo});
    }
    public async Task<MarketAdminSources> AdminSourcesAsync(string listingId,CancellationToken ct)
    {
        MarketRules.Id(listingId);var row=await db.Listings.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==listingId,ct)??throw MissingSource();
        if(row.IsDemo&&!allowDemo)throw MissingSource();
        var extras=await db.Sources.AsNoTracking().Where(x=>x.ListingId==listingId&&(allowDemo||!x.IsDemo)).OrderBy(x=>x.Id).Take(16).ToArrayAsync(ct);if(extras.Length>15)throw SourcesUnavailable();
        var sources=new[]{new MarketAdminSource(row.Id,true,Details(row),Convert.ToBase64String(row.Version))}.Concat(extras.Select(x=>new MarketAdminSource(x.Id,false,Details(x),Convert.ToBase64String(x.Version)))).ToArray();
        var fresh=await db.Listings.AsNoTracking().Where(x=>x.Id==listingId).Select(x=>x.Version).SingleOrDefaultAsync(ct);if(fresh is null||!fresh.SequenceEqual(row.Version))throw SourcesUnavailable();
        return new(1,listingId,Convert.ToBase64String(row.Version),sources);
    }
    public async Task<MarketSourceResult> SourceReceiptAsync(string requestId,string actorId,CancellationToken ct)
    {
        var key=SourceCommandKey(requestId,actorId);var row=await db.SourceCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actorId&&x.RequestId==key,ct)??throw MissingSource();
        if(row.ContainsDemo&&!allowDemo)throw MissingSource();return DecodeSourceResult(row) with{Replayed=true};
    }
    public async Task<MarketSourceResult> SaveSourceAsync(string listingId,string sourceId,string requestId,MarketSourceInput input,string actorId,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Source commands require the root Serializable transaction.");
        MarketRules.Id(listingId);if(!Guid.TryParseExact(sourceId,"N",out var sourceGuid)||sourceGuid.ToString("N")!=sourceId||sourceId==listingId)throw InvalidSource();var key=SourceCommandKey(requestId,actorId);
        _=MarketRules.Validate(new("pending",input.Details,null),allowDemo,time.GetUtcNow());
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{ListingId=listingId,SourceId=sourceId,Input=input},SourceJson))));
        var prior=await db.SourceCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actorId&&x.RequestId==key,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This UUID was used for another source command.");if(prior.ContainsDemo&&!allowDemo)throw MissingSource();return DecodeSourceResult(prior) with{Replayed=true};}
        var listing=await db.Listings.SingleOrDefaultAsync(x=>x.Id==listingId,ct)??throw MissingSource();if(Convert.ToBase64String(listing.Version)!=input.ListingVersion)throw Changed();
        if(listing.IsDemo&&!allowDemo)throw MissingSource();
        var row=await db.Sources.SingleOrDefaultAsync(x=>x.Id==sourceId,ct);var creating=row is null;
        if(creating&&input.SourceVersion is not null||!creating&&(row!.ListingId!=listingId||Convert.ToBase64String(row.Version)!=input.SourceVersion))throw Changed();
        if(creating&&await db.Sources.CountAsync(x=>x.ListingId==listingId,ct)>=15)throw new BusinessException("market_source_capacity_conflict","A model supports up to sixteen sources including its primary source.");
        var d=input.Details;var itemKey=d.SourceItemKey.Trim();
        if(await db.Listings.AnyAsync(x=>x.SourceKey==d.SourceKey&&x.SourceItemKey==itemKey,ct)||await db.Sources.AnyAsync(x=>x.Id!=sourceId&&x.SourceKey==d.SourceKey&&x.SourceItemKey==itemKey,ct))throw new BusinessException("market_source_conflict","This source/item is already assigned.");
        if(!creating&&(row!.SourceKey!=d.SourceKey||row.SourceItemKey!=itemKey))throw new BusinessException("market_source_conflict","The identity of an existing extra source cannot be changed.");
        if(d.Status=="Published"&&(await catalog.ReadCandidatesAsync("fa",[listing.ModelId],ct)).Length!=1)throw new BusinessException("incomplete_market_model","Publishable model specifications are required.");
        row??=new(){Id=sourceId,ListingId=listingId};row.Status=d.Status;row.SourceKey=d.SourceKey;row.SourceItemKey=itemKey;row.SourceNameFa=d.SourceNameFa.Trim();row.SourceNameEn=d.SourceNameEn.Trim();row.SourceUrl=d.SourceUrl;row.Availability=d.Availability;row.ObservedAt=d.ObservedAt?.ToUniversalTime();row.ValidUntil=d.ValidUntil?.ToUniversalTime();row.ReferencePriceRial=d.ReferencePriceRial is null?null:long.Parse(d.ReferencePriceRial,CultureInfo.InvariantCulture);row.IsDemo=d.IsDemo;row.UpdatedAt=time.GetUtcNow();if(creating)db.Sources.Add(row);
        // Bump the owning listing so all source commands share one concurrency
        // boundary and readers can verify the whole source collection.
        listing.UpdatedAt=row.UpdatedAt;db.Entry(listing).Property(x=>x.UpdatedAt).IsModified=true;RecordObservation(listingId,sourceId,false,d,row.UpdatedAt);await db.SaveChangesAsync(ct);
        var result=new MarketSourceResult(1,Guid.Parse(requestId).ToString("D"),listingId,sourceId,Convert.ToBase64String(listing.Version),Convert.ToBase64String(row.Version),false);
        db.SourceCommands.Add(new(){ActorId=actorId,RequestId=key,PayloadHash=hash,ResultJson=JsonSerializer.Serialize(result,SourceJson),ContainsDemo=listing.IsDemo||d.IsDemo,RecordedAt=row.UpdatedAt});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<MarketSourcesDto> SourcesAsync(string locale,string listingId,CancellationToken ct)
    {
        for(var attempt=0;attempt<2;attempt++)try{
            _=await DetailAsync(locale,listingId,ct);var all=await AdminSourcesAsync(listingId,ct);var now=time.GetUtcNow();var sources=all.Sources.Where(x=>x.Details.Status=="Published"&&(allowDemo||!x.Details.IsDemo)).Select(x=>PublicSource(x.Id,x.IsPrimary,x.Details,locale,now)).ToArray();
            // Recheck publication/model eligibility as well as the collection
            // version after reading. Hidden sources never leak their history.
            _=await DetailAsync(locale,listingId,ct);var fresh=await AdminDetailAsync(listingId,ct);if(fresh.Version!=all.ListingVersion)throw Changed();return new(1,locale,listingId,sources);
        }catch(BusinessException e)when(e.Code is "version_conflict" or "market_unavailable"){if(attempt==1)throw SourcesUnavailable();}
        throw SourcesUnavailable();
    }
    public async Task<MarketObservationsDto> ObservationsAsync(string locale,string listingId,string sourceId,string? before,bool administrative,CancellationToken ct)
    {
        MarketRules.Id(listingId);MarketRules.Id(sourceId);if(locale is not ("fa" or "en"))throw InvalidSource();long? sequence=null;
        if(before is not null){if(before.Length is <1 or >19||before.Any(c=>c is <'0' or >'9')||!long.TryParse(before,NumberStyles.None,CultureInfo.InvariantCulture,out var parsed)||parsed<=0)throw InvalidSource();sequence=parsed;}
        var all=await AdminSourcesAsync(listingId,ct);var source=all.Sources.SingleOrDefault(x=>x.Id==sourceId)??throw MissingSource();
        if(!administrative){_=await DetailAsync(locale,listingId,ct);if(source.Details.Status!="Published"||source.Details.IsDemo&&!allowDemo)throw MissingSource();}
        var rows=db.SourceObservations.AsNoTracking().Where(x=>x.ListingId==listingId&&x.SourceId==sourceId);
        if(!allowDemo)rows=rows.Where(x=>!x.IsDemo);
        if(!administrative)rows=rows.Where(x=>x.Status=="Published"&&(allowDemo||!x.IsDemo));if(sequence.HasValue)rows=rows.Where(x=>x.Sequence<sequence.Value);
        var found=await rows.OrderByDescending(x=>x.Sequence).Take(21).ToArrayAsync(ct);if(!administrative)_=await DetailAsync(locale,listingId,ct);var current=await AdminDetailAsync(listingId,ct);if(current.Version!=all.ListingVersion)throw SourcesUnavailable();
        var now=time.GetUtcNow();return new(1,locale,listingId,sourceId,found.Take(20).Select(x=>new MarketObservationDto(x.Sequence.ToString(CultureInfo.InvariantCulture),x.Origin,x.RecordedAt,PublicSource(x.SourceId,x.IsPrimary,Details(x),locale,now))).ToArray(),found.Length>20?found[19].Sequence.ToString(CultureInfo.InvariantCulture):null);
    }
    private static MarketSourceDto PublicSource(string id,bool primary,MarketDetailsInput d,string locale,DateTimeOffset now)=>new(id,primary,locale=="en"?d.SourceNameEn:d.SourceNameFa,d.SourceUrl,MarketRules.EffectiveAvailability(d.Availability,d.ValidUntil,now),d.ObservedAt,d.ValidUntil,d.ReferencePriceRial,d.ReferencePriceRial is not null&&d.ValidUntil>now,d.IsDemo);
    private static string SourceCommandKey(string requestId,string actorId)=>Guid.TryParseExact(requestId,"D",out var id)&&actorId is{Length:>0 and <=64}?id.ToString("N"):throw InvalidSource();
    private static MarketSourceResult DecodeSourceResult(MarketSourceCommand row)
    {
        try{
            var result=JsonSerializer.Deserialize<MarketSourceResult>(row.ResultJson,SourceJson)??throw SourcesUnavailable();
            if(result.SchemaVersion!=1||!Guid.TryParseExact(result.RequestId,"D",out var id)||id.ToString("N")!=row.RequestId||result.ListingId is not{Length:>0 and <=32}||!Guid.TryParseExact(result.SourceId,"N",out _)||result.SourceId==result.ListingId||Convert.FromBase64String(result.ListingVersion).Length!=8||Convert.FromBase64String(result.SourceVersion).Length!=8||result.Replayed)throw SourcesUnavailable();
            return result;
        }catch(Exception e)when(e is JsonException or FormatException or ArgumentNullException){throw SourcesUnavailable();}
    }
    private static BusinessException MissingSource()=>new("not_found","Market source was not found.");
    private static BusinessException InvalidSource()=>new("invalid_market_input","Use bounded source identifiers, a UUID and the current versions.");
    private static BusinessException SourcesUnavailable()=>new("market_unavailable","Market source data is changing or unavailable. Read it again shortly.");
}
