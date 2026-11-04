using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;
public sealed record MarketAdminPage(int SchemaVersion,int PageSize,MarketAdminItem[] Items,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record MarketAdminItem(string Id,string ModelId,string NameFa,string NameEn,string Status,string SourceKey,string SourceItemKey,bool IsDemo,string Version);
public sealed record MarketAdminDetail(int SchemaVersion,string Id,string ModelId,MarketDetailsInput Details,string Version);
public sealed partial class MarketService(MarketDbContext db,IMarketModelCatalog catalog,TimeProvider time,bool allowDemo)
{
    public async Task<string> EditModelAsync(string id,EditMarketModelInput input,string actorId,CancellationToken ct)
    {
        MarketRules.Id(id);
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=System.Data.IsolationLevel.Serializable)throw new InvalidOperationException("Editing a model and listing requires the composition root Serializable transaction.");
        var row=await db.Listings.AsNoTracking().SingleOrDefaultAsync(l=>l.Id==id,ct)??throw new BusinessException("not_found","Market listing was not found.");
        if(Convert.ToBase64String(row.Version)!=input.ListingVersion)throw new BusinessException("version_conflict","The market listing changed. Reload before saving.");
        MarketRules.Validate(new(row.ModelId,input.Details,input.ListingVersion),allowDemo,time.GetUtcNow());
        await catalog.SaveAsync(row.ModelId,input.Model,actorId,ct);
        return await SaveAsync(id,new(row.ModelId,input.Details,input.ListingVersion),ct);
    }
    public async Task<string> CreateModelAsync(CreateMarketModelInput input,string actorId,CancellationToken ct)
    {
        // Validate source before creating any catalogue model. The composition
        // root enlists both owning contexts and the success audit atomically.
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=System.Data.IsolationLevel.Serializable)throw new InvalidOperationException("Creating a model and listing requires the composition root Serializable transaction.");
        MarketRules.Validate(new("pending",input.Details,null),allowDemo,time.GetUtcNow());
        var modelId=await catalog.SaveAsync(null,input.Model,actorId,ct);
        return await SaveAsync(null,new(modelId,input.Details,null),ct);
    }
    public async Task<string> SaveAsync(string? id,MarketListingInput input,CancellationToken ct)
    {
        var price=MarketRules.Validate(input,allowDemo,time.GetUtcNow());var value=input.Details;
        var row=id is null?new MarketListing():await db.Listings.SingleOrDefaultAsync(l=>l.Id==MarketRules.Id(id),ct)??throw new BusinessException("not_found","Market listing was not found.");
        if(id is null&&input.Version is not null||id is not null&&Convert.ToBase64String(row.Version)!=input.Version)throw new BusinessException("version_conflict","The market listing changed. Reload before saving.");
        if(id is not null&&row.ModelId!=input.ModelId)throw new BusinessException("market_model_conflict","A listing cannot be moved to another model.");
        if(await db.Sources.AnyAsync(s=>s.SourceKey==value.SourceKey&&s.SourceItemKey==value.SourceItemKey.Trim(),ct))throw new BusinessException("market_source_conflict","This source/item is already assigned to an extra source.");
        var candidates=await catalog.ReadCandidatesAsync("fa",[input.ModelId],ct);
        if(value.Status=="Published"&&candidates.Length!=1)throw new BusinessException("incomplete_market_model","Market publication needs a physical model with both translations, an image, active category/brand and required model attributes.");
        if(id is null&&!await db.CatalogModels.AnyAsync(m=>m.ModelId==input.ModelId,ct))throw new BusinessException("not_found","Model was not found.");
        row.ModelId=input.ModelId;row.Status=value.Status;row.SourceKey=value.SourceKey;row.SourceItemKey=value.SourceItemKey.Trim();row.SourceNameFa=value.SourceNameFa.Trim();row.SourceNameEn=value.SourceNameEn.Trim();row.SourceUrl=value.SourceUrl;
        row.Availability=value.Availability;row.ObservedAt=value.ObservedAt?.ToUniversalTime();row.ValidUntil=value.ValidUntil?.ToUniversalTime();row.ReferencePriceRial=price;row.IsDemo=value.IsDemo;row.UpdatedAt=time.GetUtcNow();
        if(id is null){row.CreatedAt=row.UpdatedAt;db.Listings.Add(row);}else db.Entry(row).Property(l=>l.UpdatedAt).IsModified=true;
        RecordObservation(row.Id,row.Id,true,Details(row),row.UpdatedAt);
        await db.SaveChangesAsync(ct);return row.Id;
    }
    public async Task<MarketAdminDetail> AdminDetailAsync(string id,CancellationToken ct)
    {
        MarketRules.Id(id);var l=await db.Listings.AsNoTracking().SingleOrDefaultAsync(l=>l.Id==id,ct)??throw new BusinessException("not_found","Market listing was not found.");
        return new(1,l.Id,l.ModelId,new(l.Status,l.SourceKey,l.SourceItemKey,l.SourceNameFa,l.SourceNameEn,l.SourceUrl,l.Availability,l.ObservedAt,l.ValidUntil,l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.IsDemo),Convert.ToBase64String(l.Version));
    }
    public async Task<MarketAdminPage> AdminPageAsync(string? query,string? status,string? categoryId,string? cursor,CancellationToken ct,string? brandId=null)
    {
        status??="all";if(status is not ("all" or "Draft" or "Published" or "Hidden"))throw new BusinessException("invalid_market_input","Use a known market publication status.");
        if(brandId is not null)MarketRules.Id(brandId);
        var filter=PurchaseAdminFilter.Create(query,categoryId:categoryId);var scope="market-listings:"+status+(brandId is null?"":":brand:"+brandId);var after=PurchaseAdminPaging.Decode(cursor,filter,scope);
        var rows=from l in db.Listings.AsNoTracking() join m in db.CatalogModels on l.ModelId equals m.ModelId into models from model in models.DefaultIfEmpty() select new{Listing=l,Model=model};
        if(status!="all")rows=rows.Where(r=>r.Listing.Status==status);if(categoryId is not null)rows=rows.Where(r=>r.Model.ModelId!=null&&r.Model.CategoryId==categoryId);
        if(brandId is not null)rows=rows.Where(r=>r.Model.ModelId!=null&&r.Model.BrandId==brandId);
        foreach(var term in filter.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))rows=rows.Where(r=>r.Listing.ModelId.Contains(term)||r.Listing.SourceItemKey.Contains(term)||r.Model.ModelId!=null&&(r.Model.SearchFa.Contains(term)||r.Model.SearchEn.Contains(term)));
        if(after is not null)rows=rows.Where(r=>string.Compare(r.Listing.Id,after)>0);
        var result=await rows.OrderBy(r=>r.Listing.Id).Take(51).Select(r=>new MarketAdminItem(r.Listing.Id,r.Listing.ModelId,r.Model.ModelId==null?"":r.Model.NameFa,r.Model.ModelId==null?"":r.Model.NameEn,r.Listing.Status,r.Listing.SourceKey,r.Listing.SourceItemKey,r.Listing.IsDemo,Convert.ToBase64String(r.Listing.Version))).ToArrayAsync(ct);
        return new(1,50,result.Take(50).ToArray(),result.Length>50?PurchaseAdminPaging.Encode(result[49].Id,filter,scope):null);
    }
    private IQueryable<MarketListing> PublicListings=>db.Listings.AsNoTracking().Where(l=>l.Status=="Published"&&(allowDemo||!l.IsDemo));
    public async Task<MarketPage> PageAsync(string locale,MarketSearchInput input,CancellationToken ct)
    {
        if(locale is not ("fa" or "en"))throw new BusinessException("invalid_market_input","Use fa or en.");var search=MarketRules.Search(input);
        for(var attempt=0;attempt<2;attempt++){
            try{
                var definitions=await AttributeDefinitionsAsync(input,ct);
                var filtered=ApplyAttributes(SearchableModels(search),input,definitions);
                var rows=from listing in PublicListings join model in filtered on listing.ModelId equals model.ModelId select new{Listing=listing,Model=model};
                if(input.CategoryId is not null)rows=rows.Where(r=>r.Model.CategoryId==input.CategoryId);if(input.BrandId is not null)rows=rows.Where(r=>r.Model.BrandId==input.BrandId);
                var count=await rows.CountAsync(ct);var found=await rows.OrderBy(r=>r.Listing.Id).Skip((input.Page-1)*input.PageSize).Take(input.PageSize).ToArrayAsync(ct);
                var models=await catalog.ReadCandidatesAsync(locale,found.Select(r=>r.Listing.ModelId).ToArray(),ct);var byId=models.ToDictionary(m=>m.Model.Id);
                if(found.Any(r=>!byId.TryGetValue(r.Listing.ModelId,out var m)||m.Version!=Convert.ToBase64String(r.Model.Version)))throw Changed();
                var ids=found.Select(r=>r.Listing.Id).ToArray();var versions=await db.Listings.AsNoTracking().Where(l=>ids.Contains(l.Id)).Select(l=>new{l.Id,l.Version}).ToDictionaryAsync(l=>l.Id,ct);
                if(found.Any(r=>!versions.TryGetValue(r.Listing.Id,out var v)||!v.Version.SequenceEqual(r.Listing.Version)))throw Changed();
                var modelIds=found.Select(r=>r.Listing.ModelId).ToArray();var currentModels=await db.CatalogModels.AsNoTracking().Where(m=>modelIds.Contains(m.ModelId)&&m.IsEligible&&!m.HasAvailableStoreOffer).Select(m=>m.ModelId).ToArrayAsync(ct);if(currentModels.Length!=found.Length)throw Changed();
                await EnsureAttributeDefinitionsAsync(input.CategoryId,definitions,ct);
                var now=time.GetUtcNow();var items=found.Select(r=>Item(r.Listing,byId[r.Listing.ModelId].Model,locale,now)).ToArray();return new(1,locale,items,count,input.Page,input.PageSize,(int)Math.Ceiling(count/(double)input.PageSize),Selections(input));
            }catch(BusinessException e)when(e.Code is "version_conflict" or "catalog_unavailable"){
                ct.ThrowIfCancellationRequested();if(attempt==1)throw new BusinessException("market_unavailable","Market data is changing. Retry this read shortly.");
            }
        }
        throw new InvalidOperationException("Market read retry budget was exhausted.");
    }
    public async Task<MarketItemDto> DetailAsync(string locale,string id,CancellationToken ct)
    {
        MarketRules.Id(id);if(locale is not ("fa" or "en"))throw new BusinessException("invalid_market_input","Use fa or en.");
        var row=await PublicListings.SingleOrDefaultAsync(l=>l.Id==id,ct)??throw new BusinessException("not_found","Published market listing was not found.");
        if(!await db.CatalogModels.AnyAsync(m=>m.ModelId==row.ModelId&&m.IsEligible&&!m.HasAvailableStoreOffer,ct))throw new BusinessException("not_found","The model is unavailable in the sourcing market.");
        var model=(await catalog.ReadCandidatesAsync(locale,[row.ModelId],ct)).SingleOrDefault()??throw new BusinessException("not_found","Published market model was not found.");
        if(!await db.CatalogModels.AnyAsync(m=>m.ModelId==row.ModelId&&m.IsEligible&&!m.HasAvailableStoreOffer,ct))throw Changed();
        var fresh=await db.Listings.AsNoTracking().Where(l=>l.Id==id).Select(l=>l.Version).SingleOrDefaultAsync(ct);if(fresh is null||!fresh.SequenceEqual(row.Version))throw Changed();
        return Item(row,model.Model,locale,time.GetUtcNow());
    }
    private static MarketItemDto Item(MarketListing l,CatalogModelDto model,string locale,DateTimeOffset now)=>new(l.Id,model,locale=="en"?l.SourceNameEn:l.SourceNameFa,l.SourceUrl,MarketRules.EffectiveAvailability(l.Availability,l.ValidUntil,now),l.ObservedAt,l.ValidUntil,l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.ReferencePriceRial.HasValue&&l.ValidUntil>now,l.IsDemo);
    private static BusinessException Changed()=>new("version_conflict","Market data changed while being read.");
}
