using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed record PhoneDiscoveryOptions(string CategoryId="phones",bool AutomaticNotificationsEnabled=true);
public sealed class PhoneDiscoveryService(MarketDbContext db,IMarketModelCatalog catalog,ICatalogSourcingReader specifications,ICatalogOfferReader offers,IInventoryReader inventory,TimeProvider clock,PhoneDiscoveryOptions options,bool allowDemo):IPhoneConfigurationReader
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=24};
    private static string Version(byte[] value)=>Convert.ToBase64String(value);
    private IQueryable<MarketListing> Published=>db.Listings.AsNoTracking().Where(l=>l.Status=="Published"&&(allowDemo||!l.IsDemo));
    private IQueryable<CatalogMarketModelV1> Models=>db.CatalogModels.AsNoTracking().Where(m=>m.IsEligible&&m.CategoryId==options.CategoryId);
    private sealed class Row{public MarketListing Listing{get;set;}=null!;public CatalogMarketModelV1 Model{get;set;}=null!;public PhoneConfiguration Configuration{get;set;}=null!;}
    private IQueryable<Row> Rows=>from listing in Published join model in Models on listing.ModelId equals model.ModelId join configuration in db.PhoneConfigurations.AsNoTracking().Where(c=>c.Enabled) on listing.Id equals configuration.ListingId select new Row{Listing=listing,Model=model,Configuration=configuration};
    private IQueryable<Row> Filter(PhoneSearchInput input,string? except=null)
    {
        var query=Rows;var search=PersianText.Normalize(input.Query??"");
        if(input.Page is <1 or >10000||input.PageSize is <1 or >24||input.Query?.Length>120||search.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>8||input.RamGb is <1 or >128||input.StorageGb is <1 or >32768||input.ColorKey is{Length:>64})throw PhoneDiscoveryRules.Invalid();
        if(input.BrandId is not null)MarketRules.Id(input.BrandId);if(input.ColorKey is not null)MarketRules.Id(input.ColorKey);
        foreach(var token in search.Split(' ',StringSplitOptions.RemoveEmptyEntries))query=query.Where(r=>r.Model.SearchFa.Contains(token)||r.Model.SearchEn.Contains(token)||r.Model.Brand.Contains(token));
        if(except!="brand"&&input.BrandId is not null)query=query.Where(r=>r.Model.BrandId==input.BrandId);
        if(except!="ram"&&input.RamGb.HasValue)query=query.Where(r=>r.Configuration.RamGb==input.RamGb.Value);
        if(except!="storage"&&input.StorageGb.HasValue)query=query.Where(r=>r.Configuration.StorageGb==input.StorageGb.Value);
        if(except!="color"&&input.ColorKey is not null)query=query.Where(r=>r.Configuration.ColorKey==input.ColorKey);
        return query;
    }
    public async Task<PhonePage> PageAsync(string locale,PhoneSearchInput input,CancellationToken ct)
    {
        SourcingRules.Locale(locale);var filtered=Filter(input);var ids=filtered.Select(r=>r.Listing.Id).Distinct();var total=await ids.CountAsync(ct);
        var page=await ids.OrderBy(id=>id).Skip((input.Page-1)*input.PageSize).Take(input.PageSize).ToArrayAsync(ct);
        var listings=await Published.Where(l=>page.Contains(l.Id)).OrderBy(l=>l.Id).ToArrayAsync(ct);
        var models=await catalog.ReadCandidatesAsync(locale,listings.Select(l=>l.ModelId).ToArray(),ct);var map=models.ToDictionary(m=>m.Model.Id);
        if(listings.Any(l=>!map.ContainsKey(l.ModelId)))throw Unavailable();
        var configurations=await db.PhoneConfigurations.AsNoTracking().Where(c=>page.Contains(c.ListingId)&&c.Enabled).OrderBy(c=>c.Id).ToArrayAsync(ct);
        if(configurations.GroupBy(c=>c.ListingId).Any(g=>g.Count()>PhoneDiscoveryRules.MaximumConfigurations))throw Unavailable();
        var availability=await Available(configurations,listings.ToDictionary(l=>l.Id,l=>l.ModelId),ct);
        var specificationModels=await specifications.ReadAsync(listings.Select(l=>l.ModelId).ToArray(),ct);
        var items=listings.Select(l=>new PhoneItem(l.Id,map[l.ModelId].Model,l.IsDemo,configurations.Where(c=>c.ListingId==l.Id).Select(c=>Choice(c,availability)).ToArray()){Specifications=Specifications(locale,map[l.ModelId],specificationModels)}).ToArray();
        var facets=await Facets(input,ct);await EnsurePublic(listings,configurations,ct);return new(1,locale,items,total,input.Page,input.PageSize,(int)Math.Ceiling(total/(double)input.PageSize),facets);
    }
    private async Task<PhoneFacets> Facets(PhoneSearchInput input,CancellationToken ct)
    {
        var brands=await Filter(input,"brand").GroupBy(r=>new{r.Model.BrandId,r.Model.Brand}).Select(g=>new{Id=g.Key.BrandId,Name=g.Key.Brand,Count=g.Select(r=>r.Model.ModelId).Distinct().Count()}).OrderBy(g=>g.Id).Take(201).ToArrayAsync(ct);
        var ram=await Filter(input,"ram").GroupBy(r=>r.Configuration.RamGb).Select(g=>new{Value=g.Key,Count=g.Select(r=>r.Model.ModelId).Distinct().Count()}).OrderBy(g=>g.Value).Take(201).ToArrayAsync(ct);
        var storage=await Filter(input,"storage").GroupBy(r=>r.Configuration.StorageGb).Select(g=>new{Value=g.Key,Count=g.Select(r=>r.Model.ModelId).Distinct().Count()}).OrderBy(g=>g.Value).Take(201).ToArrayAsync(ct);
        var colors=await Filter(input,"color").GroupBy(r=>r.Configuration.ColorKey).Select(g=>new{Key=g.Key,NameFa=g.Min(r=>r.Configuration.ColorNameFa),NameEn=g.Min(r=>r.Configuration.ColorNameEn),Hex=g.Select(r=>r.Configuration.ColorHex).Distinct().Count()==1?g.Min(r=>r.Configuration.ColorHex):null,Count=g.Select(r=>r.Model.ModelId).Distinct().Count()}).OrderBy(g=>g.Key).Take(201).ToArrayAsync(ct);
        return new(brands.Take(200).Select(x=>new PhoneBrandFacet(x.Id,x.Name,x.Count)).ToArray(),ram.Take(200).Select(x=>new PhoneNumberFacet(x.Value,x.Count)).ToArray(),storage.Take(200).Select(x=>new PhoneNumberFacet(x.Value,x.Count)).ToArray(),colors.Take(200).Select(x=>new PhoneColorFacet(x.Key,x.NameFa??throw Unavailable(),x.NameEn??throw Unavailable(),x.Hex,x.Count)).ToArray(),brands.Length>200||ram.Length>200||storage.Length>200||colors.Length>200);
    }
    public async Task<PhoneItem> DetailAsync(string locale,string listingId,CancellationToken ct)
    {
        SourcingRules.Locale(locale);listingId=SourcingRules.Id(listingId);var listing=await Published.SingleOrDefaultAsync(l=>l.Id==listingId&&Models.Any(m=>m.ModelId==l.ModelId),ct)??throw Missing();
        var model=(await catalog.ReadCandidatesAsync(locale,[listing.ModelId],ct)).SingleOrDefault()??throw Missing();
        var configs=await db.PhoneConfigurations.AsNoTracking().Where(c=>c.ListingId==listingId&&c.Enabled).OrderBy(c=>c.Id).Take(65).ToArrayAsync(ct);if(configs.Length==0)throw Missing();if(configs.Length>64)throw Unavailable();
        var availability=await Available(configs,new Dictionary<string,string>{{listingId,listing.ModelId}},ct);
        var specificationModels=await specifications.ReadAsync([listing.ModelId],ct);
        await EnsurePublic([listing],configs,ct);return new(listingId,model.Model,listing.IsDemo,configs.Select(c=>Choice(c,availability)).ToArray()){Specifications=Specifications(locale,model,specificationModels)};
    }
    private static PhoneSpecification[] Specifications(string locale,CatalogModelRead model,IReadOnlyDictionary<string,SourcingModelSnapshot> snapshots)
    {
        if(!snapshots.TryGetValue(model.Model.Id,out var snapshot)||snapshot.Version!=model.Version||snapshot.Attributes.Length>64)throw Unavailable();
        return snapshot.Attributes.Select(attribute=>new PhoneSpecification(attribute.Key,locale=="fa"?attribute.LabelFa:attribute.LabelEn,SpecificationValue(locale,attribute))).ToArray();
    }
    public static string SpecificationValue(string locale,SourcingAttributeSnapshot value)
    {
        if(value.Options.Length>0)return string.Join(locale=="fa"?"، ":", ",value.Options.Select(option=>locale=="fa"?option.LabelFa:option.LabelEn));
        if(value.Number is{} number){var unit=(locale=="fa"?value.UnitFa:value.UnitEn)??value.Unit;return number.ToString("0.############################",CultureInfo.InvariantCulture)+(string.IsNullOrEmpty(unit)?"":" "+unit);}
        if(value.Bool is{} flag)return flag?(locale=="fa"?"بله":"Yes"):(locale=="fa"?"خیر":"No");
        return locale=="fa"?value.TextFa??value.TextEn??"":value.TextEn??value.TextFa??"";
    }
    private async Task EnsurePublic(MarketListing[] listings,PhoneConfiguration[] configurations,CancellationToken ct)
    {
        var ids=listings.Select(l=>l.Id).ToArray();var current=await Published.Where(l=>ids.Contains(l.Id)&&Models.Any(m=>m.ModelId==l.ModelId)).Select(l=>new{l.Id,l.Version}).ToDictionaryAsync(l=>l.Id,ct);
        if(current.Count!=listings.Length||listings.Any(l=>!current.TryGetValue(l.Id,out var row)||!row.Version.SequenceEqual(l.Version)))throw Unavailable();
        var configIds=configurations.Select(c=>c.Id).ToArray();var latest=await db.PhoneConfigurations.AsNoTracking().Where(c=>configIds.Contains(c.Id)&&c.Enabled).Select(c=>new{c.Id,c.Version}).ToDictionaryAsync(c=>c.Id,ct);
        if(latest.Count!=configurations.Length||configurations.Any(c=>!latest.TryGetValue(c.Id,out var row)||!row.Version.SequenceEqual(c.Version)))throw Unavailable();
    }
    private async Task<Dictionary<string,(bool Available,string? Slug,OfferSkuSnapshot? Sku)>> Available(PhoneConfiguration[] configurations,IReadOnlyDictionary<string,string> modelIds,CancellationToken ct)
    {
        var ids=configurations.Where(c=>c.LinkedVariantId is not null).Select(c=>c.LinkedVariantId!).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();var current=new Dictionary<string,OfferSkuSnapshot>(StringComparer.OrdinalIgnoreCase);
        foreach(var batch in ids.Chunk(64))foreach(var pair in await offers.ReadAsync(batch,ct))current[pair.Key]=pair.Value;
        var stock=await inventory.AvailableAsync(ids,ct);var result=new Dictionary<string,(bool,string?,OfferSkuSnapshot?)>(StringComparer.Ordinal);
        foreach(var config in configurations){var matched=config.LinkedVariantId is{} id&&current.TryGetValue(id,out var sku)&&PhoneDiscoveryRules.Matches(Snapshot(config,modelIds[config.ListingId]),sku);var available=matched&&stock.TryGetValue(config.LinkedVariantId!,out var count)&&count>0;result[config.Id]=(available,matched?current[config.LinkedVariantId!].Model.Slug:null,matched?current[config.LinkedVariantId!]:null);}
        return result;
    }
    private static PhoneChoice Choice(PhoneConfiguration c,IReadOnlyDictionary<string,(bool Available,string? Slug,OfferSkuSnapshot? Sku)> available)
    {
        var status=available.GetValueOrDefault(c.Id);return new(c.Id,c.RamGb,c.StorageGb,c.ColorKey,c.ColorNameFa,c.ColorNameEn,c.ColorHex,c.ImageUrl,Version(c.Version),status.Available,status.Slug,status.Slug is null?null:c.LinkedVariantId,!status.Available,!status.Available);
    }
    public async Task<IReadOnlyDictionary<string,PhoneConfigurationSelection>> ReadSelectionsAsync(string locale,IReadOnlyDictionary<string,string> selections,CancellationToken ct)
    {
        SourcingRules.Locale(locale);if(selections.Count>24)throw PhoneDiscoveryRules.Invalid();foreach(var pair in selections){SourcingRules.Id(pair.Key);SourcingRules.Id(pair.Value);}
        var listingIds=selections.Keys.ToArray();var configIds=selections.Values.ToArray();var listings=await Published.Where(l=>listingIds.Contains(l.Id)&&Models.Any(m=>m.ModelId==l.ModelId)).ToDictionaryAsync(l=>l.Id,l=>l.ModelId,ct);
        var configs=await db.PhoneConfigurations.AsNoTracking().Where(c=>configIds.Contains(c.Id)&&c.Enabled&&listingIds.Contains(c.ListingId)).ToArrayAsync(ct);
        configs=configs.Where(c=>listings.ContainsKey(c.ListingId)&&selections.TryGetValue(c.ListingId,out var chosen)&&chosen==c.Id).ToArray();
        var availability=await Available(configs,listings,ct);return configs.ToDictionary(c=>c.ListingId,c=>new PhoneConfigurationSelection(Snapshot(c,listings[c.ListingId]),availability[c.Id].Available,availability[c.Id].Slug));
    }
    public async Task<PhoneAdminConfigurations> AdminAsync(string listingId,CancellationToken ct)
    {
        listingId=SourcingRules.Id(listingId);var listing=await db.Listings.AsNoTracking().SingleOrDefaultAsync(l=>l.Id==listingId,ct)??throw Missing();await CheckPhone(listing,ct);
        var configs=await db.PhoneConfigurations.AsNoTracking().Where(c=>c.ListingId==listingId).OrderBy(c=>c.Id).Take(65).ToArrayAsync(ct);if(configs.Length>64)throw Unavailable();
        return new(1,listingId,Version(listing.Version),configs.Select(c=>new PhoneAdminConfiguration(c.Id,c.Enabled,c.RamGb,c.StorageGb,c.ColorKey,c.ColorNameFa,c.ColorNameEn,c.ColorHex,c.ImageUrl,c.LinkedVariantId,Version(c.Version))).ToArray());
    }
    public async Task<PhoneConfigurationResult> SaveAsync(string actor,string listingId,string configurationId,string commandId,PhoneConfigurationCommand supplied,CancellationToken ct)
    {
        RequireTransaction();actor=SourcingRules.Actor(actor);listingId=SourcingRules.Id(listingId);configurationId=SourcingRules.Id(configurationId);commandId=SourcingRules.CommandId(commandId);var input=PhoneDiscoveryRules.Normalize(supplied.Configuration);var listingVersion=SourcingRules.Version(supplied.ListingVersion);var configVersion=supplied.ConfigurationVersion is null?null:SourcingRules.Version(supplied.ConfigurationVersion);
        var hash=SourcingRules.Payload(new{listingId,configurationId,listingVersion,configVersion,input});await Lock("configuration-command:"+actor+":"+commandId,ct);if(await Replay<PhoneConfigurationResult>(actor,"configuration",commandId,hash,ct)is{} replay)return replay with{Replayed=true};
        await Lock("listing:"+listingId,ct);var listing=await db.Listings.SingleOrDefaultAsync(l=>l.Id==listingId,ct)??throw Missing();await CheckPhone(listing,ct);if(Version(listing.Version)!=listingVersion)throw Changed();
        var row=await db.PhoneConfigurations.SingleOrDefaultAsync(c=>c.Id==configurationId,ct);if(row is not null&&(row.ListingId!=listingId||Version(row.Version)!=configVersion)||row is null&&configVersion is not null)throw Changed();
        if(row is not null&&(row.RamGb!=input.RamGb||row.StorageGb!=input.StorageGb||row.ColorKey!=input.ColorKey))throw new BusinessException("phone_configuration_identity_conflict","RAM, storage and color identity are immutable. Create a new configuration and explicitly disable the old choice.");
        if(row is null&&await db.PhoneConfigurations.CountAsync(c=>c.ListingId==listingId,ct)>=64)throw new BusinessException("phone_configuration_capacity","A phone supports up to 64 explicit configurations.");
        if(await db.PhoneConfigurations.AnyAsync(c=>c.ListingId==listingId&&c.Id!=configurationId&&c.RamGb==input.RamGb&&c.StorageGb==input.StorageGb&&c.ColorKey==input.ColorKey,ct))throw new BusinessException("phone_configuration_conflict","This memory and color configuration already exists.");
        var model=await catalog.ReadEditableAsync(listing.ModelId,ct);if(input.ImageUrl is not null&&!model.Input.ImageUrls.Contains(input.ImageUrl,StringComparer.Ordinal))throw PhoneDiscoveryRules.Invalid();
        row??=new(){Id=configurationId,ListingId=listingId};row.Enabled=input.Enabled;row.RamGb=input.RamGb;row.StorageGb=input.StorageGb;row.ColorKey=input.ColorKey;row.ColorNameFa=input.ColorNameFa;row.ColorNameEn=input.ColorNameEn;row.ColorHex=input.ColorHex;row.ImageUrl=input.ImageUrl;row.LinkedVariantId=input.LinkedVariantId;row.UpdatedAt=clock.GetUtcNow();
        if(input.LinkedVariantId is{} variant){var sku=(await offers.ReadAsync([variant],ct)).GetValueOrDefault(variant);if(sku is null||!PhoneDiscoveryRules.Matches(Snapshot(row,listing.ModelId),sku))throw new BusinessException("phone_configuration_sku_conflict","The linked published physical SKU must match this model, RAM, storage and color exactly.");}
        if(configVersion is null)db.PhoneConfigurations.Add(row);listing.UpdatedAt=row.UpdatedAt;db.Entry(listing).Property(l=>l.UpdatedAt).IsModified=true;await db.SaveChangesAsync(ct);
        var result=new PhoneConfigurationResult(1,Guid.ParseExact(commandId,"N").ToString("D"),listingId,configurationId,Version(listing.Version),Version(row.Version),false);await Remember(actor,"configuration",commandId,hash,result,listing.IsDemo,ct);return result;
    }
    private async Task CheckPhone(MarketListing listing,CancellationToken ct)
    {
        if(listing.IsDemo&&!allowDemo||!await db.CatalogModels.AnyAsync(m=>m.ModelId==listing.ModelId&&m.CategoryId==options.CategoryId,ct))throw Missing();
    }
    public async Task<PhoneConfigurationResult> ConfigurationReceiptAsync(string actor,string commandId,CancellationToken ct)
    {
        var row=await Command(SourcingRules.Actor(actor),"configuration",SourcingRules.CommandId(commandId),ct)??throw Missing();return Deserialize<PhoneConfigurationResult>(row.ResultJson) with{Replayed=true};
    }
    public async Task<PhoneInterestResult> InterestAsync(string owner,string listingId,string commandId,PhoneInterestInput input,CancellationToken ct)
    {
        RequireTransaction();owner=SourcingRules.Actor(owner);listingId=SourcingRules.Id(listingId);commandId=SourcingRules.CommandId(commandId);var configurationId=SourcingRules.Id(input.ConfigurationId);var version=input.Version is null?null:SourcingRules.Version(input.Version);var hash=SourcingRules.Payload(new{listingId,configurationId,input.Active,version});
        await Lock("interest-owner:"+owner.ToUpperInvariant(),ct);if(await Replay<PhoneInterestResult>(owner,"interest",commandId,hash,ct)is{} replay)return replay with{Replayed=true};
        var row=await db.PhoneInterests.SingleOrDefaultAsync(i=>i.OwnerId==owner&&i.ListingId==listingId&&i.ConfigurationId==configurationId,ct);if(row is null&&!input.Active)throw Missing();if(row is null&&version is not null||row is not null&&Version(row.Version)!=version)throw Changed();
        var now=clock.GetUtcNow();if(input.Active){var current=(await ReadSelectionsAsync("fa",new Dictionary<string,string>{{listingId,configurationId}},ct)).GetValueOrDefault(listingId)??throw Missing();var listing=await Published.SingleAsync(l=>l.Id==listingId,ct);if(row is null){if(await db.PhoneInterests.CountAsync(i=>i.OwnerId==owner,ct)>=200)throw new BusinessException("phone_interest_capacity","This account supports up to 200 phone alert choices. Existing alerts can be reactivated.");row=new(){OwnerId=owner,ListingId=listingId,ConfigurationId=configurationId,CreatedAt=now};db.PhoneInterests.Add(row);}else if(row.State!="Active")row.Generation=checked(row.Generation+1);var model=(await catalog.ReadCandidatesAsync("fa",[current.Configuration.ModelId],ct)).SingleOrDefault()??throw Missing();row.ModelNameFa=model.Model.Name;row.ModelNameEn=model.Model.EnglishName;row.ConfigurationJson=JsonSerializer.Serialize(current.Configuration,Json);row.State="Active";row.IsDemo=listing.IsDemo;}else row!.State="Cancelled";
        row!.ChangedAt=now;db.Entry(row).Property(i=>i.ChangedAt).IsModified=true;await db.SaveChangesAsync(ct);var result=new PhoneInterestResult(1,Guid.ParseExact(commandId,"N").ToString("D"),InterestData(row),false);await Remember(owner,"interest",commandId,hash,result,row.IsDemo,ct);return result;
    }
    public async Task<PhoneInterestPage> InterestsAsync(string owner,string? cursor,CancellationToken ct)
    {
        owner=SourcingRules.Actor(owner);var after=cursor is null?null:SourcingRules.Id(cursor);var query=db.PhoneInterests.AsNoTracking().Where(i=>i.OwnerId==owner&&(allowDemo||!i.IsDemo));if(after is not null)query=query.Where(i=>string.Compare(i.Id,after)>0);var rows=await query.OrderBy(i=>i.Id).Take(51).ToArrayAsync(ct);return new(1,rows.Take(50).Select(InterestData).ToArray(),rows.Length>50?rows[49].Id:null);
    }
    public async Task<PhoneInterestResult> InterestReceiptAsync(string owner,string commandId,CancellationToken ct)
    {
        var row=await Command(SourcingRules.Actor(owner),"interest",SourcingRules.CommandId(commandId),ct)??throw Missing();return Deserialize<PhoneInterestResult>(row.ResultJson) with{Replayed=true};
    }
    public async Task<PhoneInterestData> ReadInterestAsync(string owner,string listingId,string configurationId,CancellationToken ct)
    {
        owner=SourcingRules.Actor(owner);listingId=SourcingRules.Id(listingId);configurationId=SourcingRules.Id(configurationId);var row=await db.PhoneInterests.AsNoTracking().SingleOrDefaultAsync(i=>i.OwnerId==owner&&i.ListingId==listingId&&i.ConfigurationId==configurationId&&(allowDemo||!i.IsDemo),ct)??throw Missing();return InterestData(row);
    }
    public async Task<int> NotifyOwnerAsync(string owner,IPhoneDiscoveryNotificationWriter writer,CancellationToken ct)
    {
        RequireTransaction();owner=SourcingRules.Actor(owner);await Lock("interest-owner:"+owner.ToUpperInvariant(),ct);var rows=await db.PhoneInterests.Where(i=>i.OwnerId==owner&&i.State=="Active"&&(allowDemo||!i.IsDemo)).OrderBy(i=>i.Id).Take(200).ToArrayAsync(ct);var notified=0;
        var listingIds=rows.Select(i=>i.ListingId).Distinct().ToArray();var configIds=rows.Select(i=>i.ConfigurationId).ToArray();var listings=await Published.Where(l=>listingIds.Contains(l.Id)&&Models.Any(m=>m.ModelId==l.ModelId)).ToDictionaryAsync(l=>l.Id,l=>l.ModelId,ct);var configs=await db.PhoneConfigurations.AsNoTracking().Where(c=>configIds.Contains(c.Id)&&c.Enabled&&listingIds.Contains(c.ListingId)).ToArrayAsync(ct);configs=configs.Where(c=>listings.ContainsKey(c.ListingId)).ToArray();var available=await Available(configs,listings,ct);var current=configs.ToDictionary(c=>c.Id);
        foreach(var row in rows){if(!current.TryGetValue(row.ConfigurationId,out var config)||config.ListingId!=row.ListingId||!available[config.Id].Available)continue;var snapshot=Snapshot(config,listings[row.ListingId]);var historical=Deserialize<PhoneConfigurationSnapshot>(row.ConfigurationJson);if(historical.ModelId!=snapshot.ModelId||historical.RamGb!=snapshot.RamGb||historical.StorageGb!=snapshot.StorageGb||historical.ColorKey!=snapshot.ColorKey||available[config.Id].Sku is not{} actualSku||!PhoneDiscoveryRules.Matches(historical with{LinkedVariantId=null},actualSku))continue;
            var now=clock.GetUtcNow();var id=SourcingRules.Hash("phone-available:"+row.Id+":"+row.Generation.ToString(CultureInfo.InvariantCulture))[..32].ToLowerInvariant();await writer.RecordAsync(new(id,owner,"phone_available",row.ListingId,row.ConfigurationId,null,null,available[config.Id].Slug,config.LinkedVariantId,now),ct);row.State="Notified";row.ChangedAt=now;db.Entry(row).Property(i=>i.ChangedAt).IsModified=true;notified++;
        }
        if(notified>0)await db.SaveChangesAsync(ct);return notified;
    }
    public async Task<string[]> ActiveOwnersAsync(string? after,CancellationToken ct)
    {
        var query=db.PhoneInterests.AsNoTracking().Where(i=>i.State=="Active"&&(allowDemo||!i.IsDemo));if(after is not null)query=query.Where(i=>string.Compare(i.OwnerId,after)>0);return await query.Select(i=>i.OwnerId).Distinct().OrderBy(i=>i).Take(20).ToArrayAsync(ct);
    }
    private static PhoneInterestData InterestData(PhoneInterest row)=>new(row.Id,row.ListingId,row.ModelNameFa,row.ModelNameEn,Deserialize<PhoneConfigurationSnapshot>(row.ConfigurationJson),row.State,row.Generation,Version(row.Version),row.CreatedAt,row.ChangedAt);
    public static PhoneConfigurationSnapshot Snapshot(PhoneConfiguration c,string modelId)
    {
        var version=Version(c.Version);var fingerprint=SourcingRules.Payload(new{c.Id,ModelId=modelId,c.RamGb,c.StorageGb,c.ColorKey,c.ColorNameFa,c.ColorNameEn,c.ColorHex,c.ImageUrl,c.LinkedVariantId,Version=version});return new(c.Id,modelId,c.RamGb,c.StorageGb,c.ColorKey,c.ColorNameFa,c.ColorNameEn,c.ColorHex,c.ImageUrl,c.LinkedVariantId,version,fingerprint);
    }
    private async Task<PhoneDiscoveryCommand?> Command(string actor,string operation,string command,CancellationToken ct)=>await db.PhoneDiscoveryCommands.AsNoTracking().SingleOrDefaultAsync(c=>c.ActorId==actor&&c.Operation==operation&&c.RequestId==command&&(allowDemo||!c.ContainsDemo),ct);
    private async Task<T?> Replay<T>(string actor,string operation,string command,string hash,CancellationToken ct)where T:class{var row=await Command(actor,operation,command,ct);if(row is null)return null;if(row.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This phone command UUID belongs to another target or payload.");return Deserialize<T>(row.ResultJson);}
    private async Task Remember<T>(string actor,string operation,string command,string hash,T result,bool demo,CancellationToken ct){var json=JsonSerializer.Serialize(result,Json);if(json.Length>16000)throw Unavailable();db.PhoneDiscoveryCommands.Add(new(){ActorId=actor,Operation=operation,RequestId=command,PayloadHash=hash,ResultJson=json,ContainsDemo=demo,At=clock.GetUtcNow()});await db.SaveChangesAsync(ct);}
    private static T Deserialize<T>(string json)=>JsonSerializer.Deserialize<T>(json,Json)??throw Unavailable();
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Phone discovery commands require the shared root Serializable transaction.");}
    private async Task Lock(string key,CancellationToken ct){RequireTransaction();await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:phone-discovery:"+SourcingRules.Hash(key);command.Parameters.Add(p);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("phone_discovery_busy_conflict","Another phone command is in progress. Retry the same UUID.");}
    private static BusinessException Missing()=>new("not_found","The configured phone or owned alert was not found.");
    private static BusinessException Changed()=>new("version_conflict","The phone configuration or alert changed. Reload before changing it.");
    private static BusinessException Unavailable()=>new("phone_discovery_unavailable","Phone configuration data changed or exceeded supported bounds.");
}
