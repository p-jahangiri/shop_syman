using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed class MarketSourcingReader(MarketDbContext db,ICatalogSourcingReader catalog,TimeProvider clock,bool allowDemo):IMarketSourcingReader
{
    private IPhoneConfigurationReader? phoneConfigurations;
    public MarketSourcingReader(MarketDbContext db,ICatalogSourcingReader catalog,TimeProvider clock,bool allowDemo,IPhoneConfigurationReader phones):this(db,catalog,clock,allowDemo){phoneConfigurations=phones;}
    public async Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadConfiguredAsync(string locale,string[] listingIds,IReadOnlyDictionary<string,string> configurations,CancellationToken ct)
    {
        var found=await ReadAsync(locale,listingIds,ct);var result=found.ToDictionary(p=>p.Key,p=>p.Value,StringComparer.OrdinalIgnoreCase);
        var required=await db.PhoneConfigurations.AsNoTracking().Where(c=>listingIds.Contains(c.ListingId)).Select(c=>c.ListingId).Distinct().ToArrayAsync(ct);
        foreach(var id in required)if(!configurations.ContainsKey(id)&&result.TryGetValue(id,out var missing)&&missing.Model is not null)result[id]=NeutralPhone(missing) with{Issue="phone_configuration_required"};
        if(configurations.Count==0)return result;
        if(phoneConfigurations is null)throw new BusinessException("phone_discovery_unavailable","Phone configurations are unavailable.");
        var selected=await phoneConfigurations.ReadSelectionsAsync(locale,configurations,ct);
        foreach(var pair in configurations){if(!result.TryGetValue(pair.Key,out var candidate)||candidate.Model is null||candidate.Fingerprint is null)continue;var model=candidate.Model;candidate=NeutralPhone(candidate);if(!selected.TryGetValue(pair.Key,out var choice)||choice.Configuration.ModelId!=model.Id){result[pair.Key]=candidate with{Issue="unavailable"};continue;}
            result[pair.Key]=candidate with{Configuration=choice.Configuration,Fingerprint=SourcingRules.Payload(new{Base=candidate.Fingerprint,Configuration=choice.Configuration.Fingerprint,choice.AvailableInStore}),Model=model with{HasAvailableStoreOffer=choice.AvailableInStore},Issue=choice.AvailableInStore?"now_in_store":null};}
        return result;
    }
    private static SourcingCandidate NeutralPhone(SourcingCandidate candidate)=>candidate with{SourceNameFa="درخواست تأمین گوشی",SourceNameEn="Phone sourcing request",SourceUrl=null,ReferencePriceRial=null,ReferencePriceCurrent=false,Availability="unknown",ObservedAt=null,ValidUntil=null};
    public async Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadAsync(string locale,string[] listingIds,CancellationToken ct)
    {
        SourcingRules.Locale(locale);
        if(listingIds is null||listingIds.Length>24||listingIds.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=listingIds.Length)throw new BusinessException("invalid_sourcing_input","Choose up to 24 distinct market listings.");
        var ids=listingIds.Select(SourcingRules.Id).ToArray();if(ids.Length==0)return new Dictionary<string,SourcingCandidate>();
        for(var attempt=0;attempt<2;attempt++){
            try{
                var listings=await Published.Where(l=>ids.Contains(l.Id)).ToArrayAsync(ct);
                var models=await catalog.ReadAsync(listings.Select(l=>l.ModelId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
                var versions=await Published.Where(l=>ids.Contains(l.Id)).Select(l=>new{l.Id,l.Version}).ToDictionaryAsync(l=>l.Id,StringComparer.OrdinalIgnoreCase,ct);
                if(listings.Any(l=>!versions.TryGetValue(l.Id,out var version)||!version.Version.SequenceEqual(l.Version)))throw new BusinessException("version_conflict","Market publication changed while reading the selection.");
                var rows=listings.ToDictionary(l=>l.Id,StringComparer.OrdinalIgnoreCase);var now=clock.GetUtcNow();var result=new Dictionary<string,SourcingCandidate>(StringComparer.OrdinalIgnoreCase);
                foreach(var id in ids){
                    if(!rows.TryGetValue(id,out var row)||!models.TryGetValue(row.ModelId,out var model)){result[id]=Unavailable(id);continue;}
                    var state=MarketRules.EffectiveAvailability(row.Availability,row.ValidUntil,now);var current=row.ReferencePriceRial.HasValue&&row.ValidUntil>now;
                    var fingerprint=SourcingRules.Payload(new{SchemaVersion=1,ListingId=row.Id,ListingVersion=Convert.ToBase64String(row.Version),ModelFingerprint=model.Fingerprint,Availability=state,ReferencePriceCurrent=current});
                    result[id]=new(row.Id,model,fingerprint,row.SourceNameFa,row.SourceNameEn,row.SourceUrl,state,row.ObservedAt,row.ValidUntil,row.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),current,row.IsDemo,model.HasAvailableStoreOffer?"now_in_store":null);
                }
                return result;
            }catch(BusinessException e)when(e.Code is "version_conflict" or "catalog_unavailable"){
                ct.ThrowIfCancellationRequested();if(attempt==1)throw new BusinessException("market_unavailable","Market data changed while reading the selection. Refresh and retry.");
            }
        }
        throw new InvalidOperationException("Sourcing selection retry budget was exhausted.");
    }
    private IQueryable<MarketListing> Published=>db.Listings.AsNoTracking().Where(l=>l.Status=="Published"&&(allowDemo||!l.IsDemo));
    private static SourcingCandidate Unavailable(string id)=>new(id,null,null,null,null,null,null,null,null,null,false,false,"unavailable");
}
