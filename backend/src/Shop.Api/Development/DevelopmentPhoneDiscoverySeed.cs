using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Market;
using Shop.SharedKernel;

// Explicit Development CLI operation only. The reviewed source file is not a
// provider feed and never supplies SKU, inventory, supply promises or prices.
public static class DevelopmentPhoneDiscoverySeed
{
    public const string SourceKey="development-samsung-phones-v1";
    public const string DatasetRelativePath="data/development/samsung-iran-market.v1.json";
    public const string DatasetSha256="6f213812cf3c30c7e859b6734ee260bfe3f07a802a7cf3c6d5a2d40d82cb0337";
    private const string Actor="development-seed-phone-discovery";
    private sealed record Spec(string Key,string Source,AttributeDataType Type,string? Unit,string Fa,string En,bool Filterable=true);
    private static readonly Spec[] Specs=[
        new("phone-screen-size","screenInches",AttributeDataType.Number,"inch","اندازهٔ نمایشگر","Screen size"),
        new("phone-display-technology","display",AttributeDataType.Text,null,"فناوری نمایشگر","Display technology"),
        new("phone-screen-resolution","resolution",AttributeDataType.Text,null,"وضوح نمایشگر","Display resolution"),
        new("phone-refresh-rate","refreshRateHz",AttributeDataType.Number,"Hz","نرخ نوسازی نمایشگر","Display refresh rate"),
        new("phone-chipset","processor",AttributeDataType.Text,null,"تراشه","Chipset"),
        new("phone-rear-cameras","rearCameraMp",AttributeDataType.Text,null,"دوربین‌های پشت","Rear cameras",false),
        new("phone-front-camera","frontCameraMp",AttributeDataType.Number,"MP","دوربین جلو","Front camera",false),
        new("phone-battery-capacity","batteryTypicalMah",AttributeDataType.Number,"mAh","ظرفیت معمول باتری","Typical battery capacity"),
        new("phone-weight","weightG",AttributeDataType.Number,"g","وزن","Weight",false),
        new("phone-charging-max","chargingMaxW",AttributeDataType.Number,"W","حداکثر توان شارژ","Maximum charging power"),
        new("phone-ip-rating","protection",AttributeDataType.Text,null,"درجهٔ حفاظت","IP rating"),
        new("phone-network","network",AttributeDataType.Text,null,"شبکهٔ موبایل","Mobile network"),
        new("phone-dimensions","dimensionsMm",AttributeDataType.Text,"mm","ابعاد","Dimensions",false),
        new("phone-model-code","modelCode",AttributeDataType.Text,null,"کد خانوادهٔ مدل","Model family code",false)
    ];

    public sealed record Result(int Created,int Preserved,int ConfigurationsCreated,int DefinitionsCreated,int CategoryAttributesAdded,bool IsDemo,string DatasetSha256)
    {
        public int RamOptionsAdded{get;init;}
    }
    public static async Task<Result> RunAsync(IServiceProvider services,IHostEnvironment environment,string contentRoot,CancellationToken ct)
    {
        if(!environment.IsDevelopment())throw new InvalidOperationException("Phone discovery samples are unavailable outside Development.");
        var root=await ReadDatasetAsync(contentRoot,ct);
        var models=root.GetProperty("models").EnumerateArray().ToArray();
        var market=services.GetRequiredService<MarketDbContext>();var catalog=services.GetRequiredService<CatalogDbContext>();var identity=services.GetRequiredService<IdentityDbContext>();
        var enlisted=new List<DbContext>();
        await using var transaction=await market.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        try{
            var connection=market.Database.GetDbConnection();
            foreach(var module in new DbContext[]{catalog,identity}){
                var original=module.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Phone sample modules must use closed connections to the same local database.");
                module.Database.SetDbConnection(connection,contextOwnsConnection:false);await module.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(module);
            }
            await LockAsync(market,ct);
            var catalogService=services.GetRequiredService<ICatalogService>();
            var ramOptionsAdded=await EnsureRamOptionsAsync(catalog,catalogService,models,ct);
            if(ramOptionsAdded>0)identity.Audit.Add(new(){ActorId=Actor,Action="DEVELOPMENT_PHONE_RAM_OPTIONS_EXTENDED",Resource="/development/phone-discovery/ram-options",TraceId=Guid.NewGuid().ToString("N")});
            var existing=await market.Listings.AsNoTracking().Where(row=>row.SourceKey==SourceKey).Select(row=>row.SourceItemKey).ToArrayAsync(ct);
            var pending=models.Where(model=>!existing.Contains(Text(model,"key"),StringComparer.Ordinal)).ToArray();
            var preserved=models.Length-pending.Length;
            if(pending.Length==0){await identity.SaveChangesAsync(ct);await transaction.CommitAsync(ct);return new(0,preserved,0,0,0,true,DatasetSha256){RamOptionsAdded=ramOptionsAdded};}
            var categoryId=services.GetRequiredService<PhoneDiscoveryOptions>().CategoryId;
            if(models.Any(model=>Text(model,"categoryId")!=categoryId))throw new InvalidOperationException("The reviewed dataset does not match the configured phone category.");
            var category=await catalog.Categories.AsNoTracking().Include(row=>row.Translations).Include(row=>row.Attributes).SingleOrDefaultAsync(row=>row.Id==categoryId,ct)
                ??throw new InvalidOperationException("Create the configured phone category through the explicit local development seed or admin before importing phone samples.");
            if(!category.IsActive)throw new InvalidOperationException("The phone category is inactive. The sample import preserves this admin decision.");
            var slugs=pending.Select(model=>Text(model,"slug")).ToArray();
            if(await catalog.Products.AnyAsync(product=>slugs.Contains(product.Slug),ct))throw new InvalidOperationException("A reviewed phone slug already belongs to an existing model. Link or edit it explicitly in the admin; this seed does not overwrite it.");
            var brands=await catalog.Brands.AsNoTracking().Where(brand=>brand.Id=="samsung"||brand.Slug=="samsung").Take(2).ToArrayAsync(ct);
            if(brands.Length>1||brands.Any(brand=>!brand.IsActive))throw new InvalidOperationException("The Samsung brand is ambiguous or inactive. Resolve it in the admin; the sample import preserves existing brands.");
            var brandId=brands.Length==1?brands[0].Id:await catalogService.SaveBrandAsync(null,new("Samsung","samsung","",true,null),ct);
            var definitionsCreated=0;var ids=new Dictionary<string,string>(StringComparer.Ordinal);
            foreach(var spec in Specs){
                var definition=await catalog.AttributeDefinitions.AsNoTracking().SingleOrDefaultAsync(row=>row.Key==spec.Key,ct);
                if(definition is null){ids[spec.Key]=await catalogService.SaveAttributeAsync(null,new(spec.Key,spec.Type,spec.Unit,[new("fa",spec.Fa),new("en",spec.En)],[],null),ct);definitionsCreated++;}
                else{if(definition.DataType!=spec.Type||definition.Unit!=spec.Unit)throw new InvalidOperationException("An existing phone specification has an incompatible type or unit: "+spec.Key+". Preserve the admin definition and resolve it explicitly.");ids[spec.Key]=definition.Id;}
            }
            var rules=category.Attributes.Select(rule=>new CategoryAttributeInput(rule.AttributeId,rule.IsRequired,rule.IsFilterable,rule.IsComparable,rule.ShowInSpecs,rule.IsVariantAxis,rule.SortOrder,rule.GroupName)).ToList();
            var attributesAdded=0;var nextOrder=rules.Count==0?0:rules.Max(rule=>rule.SortOrder)+1;
            foreach(var spec in Specs)if(rules.All(rule=>rule.AttributeId!=ids[spec.Key])){rules.Add(new(ids[spec.Key],false,spec.Filterable,true,true,false,nextOrder++,"phone-specifications"));attributesAdded++;}
            if(category.Attributes.Any(rule=>rule.IsRequired&&!ids.Values.Contains(rule.AttributeId,StringComparer.Ordinal)))throw new InvalidOperationException("The phone category requires additional base attributes. This seed will not guess values or use one RAM/storage choice as the model's only specification.");
            if(attributesAdded>0)await catalogService.SaveCategoryAsync(category.Id,new(category.Slug,category.ParentId,category.ImageUrl,category.SortOrder,category.IsActive,category.Translations.Select(row=>new TranslationInput(row.Locale,row.Name,row.Description)).ToArray(),rules.ToArray(),Convert.ToBase64String(category.Version)),ct);
            var marketService=services.GetRequiredService<MarketService>();var phones=services.GetRequiredService<PhoneDiscoveryService>();var created=0;var configurationsCreated=0;
            foreach(var model in pending){
                var values=Specs.Select(spec=>Value(model,spec,ids[spec.Key])).ToArray();
                var input=new CatalogModelInput(categoryId,brandId,Text(model,"slug"),[
                    new("fa",Text(model,"nameFa"),Text(model,"descriptionFa")+" این ردیف نمونهٔ توسعه است؛ موجودی، قیمت یا امکان تأمین قطعی را تضمین نمی‌کند."),
                    new("en",Text(model,"nameEn"),Text(model,"descriptionEn")+" This is a development sample; stock, price and supply are not guaranteed.")],values,model.GetProperty("imageUrls").EnumerateArray().Select(item=>item.GetString()!).ToArray(),null);
                var details=new MarketDetailsInput("Published",SourceKey,Text(model,"key"),"نمونهٔ توسعهٔ گوشی","Development phone samples",null,"unknown",null,null,null,true);
                var listingId=await marketService.CreateModelAsync(new(input,details),Actor,ct);
                foreach(var configuration in model.GetProperty("configurations").EnumerateArray()){
                    var current=await phones.AdminAsync(listingId,ct);
                    var choice=new PhoneConfigurationInput(true,configuration.GetProperty("ramGb").GetInt32(),configuration.GetProperty("storageGb").GetInt32(),Text(configuration,"colorKey"),Text(configuration,"colorNameFa"),Text(configuration,"colorNameEn"),Text(configuration,"colorHex"),Text(configuration,"imageUrl"),null);
                    var commandId=Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("development-phone-configuration:v1:"+listingId+":"+Text(configuration,"id"))))[..32];
                    await phones.SaveAsync(Actor,listingId,Text(configuration,"id"),commandId,new(current.ListingVersion,null,choice),ct);configurationsCreated++;
                }
                identity.Audit.Add(new(){ActorId=Actor,Action="DEVELOPMENT_PHONE_SAMPLE_CREATED",Resource="/development/phone-discovery/"+Text(model,"key"),TraceId=Guid.NewGuid().ToString("N")});created++;
            }
            await identity.SaveChangesAsync(ct);await transaction.CommitAsync(ct);
            return new(created,preserved,configurationsCreated,definitionsCreated,attributesAdded,true,DatasetSha256){RamOptionsAdded=ramOptionsAdded};
        }finally{
            foreach(var module in enlisted){try{await module.Database.UseTransactionAsync(null,CancellationToken.None);}catch(Exception error)when(error is not OutOfMemoryException){services.GetRequiredService<ILoggerFactory>().CreateLogger("DevelopmentPhoneDiscoverySeed").LogWarning("Could not detach {Module} after {ExceptionType}",module.GetType().Name,error.GetType().Name);}}
        }
    }

    private static async Task<int> EnsureRamOptionsAsync(CatalogDbContext catalog,ICatalogService service,JsonElement[] models,CancellationToken ct)
    {
        var definition=await catalog.AttributeDefinitions.AsNoTracking().Include(row=>row.Translations).Include(row=>row.Options).SingleOrDefaultAsync(row=>row.Key=="ram",ct);
        // Number/Text axes can already express these capacities. Do not turn an
        // existing admin definition into a Select or change its category policy.
        if(definition is null||definition.DataType is not(AttributeDataType.Select or AttributeDataType.MultiSelect))return 0;
        var verified=models.SelectMany(model=>model.GetProperty("configurations").EnumerateArray()).Select(choice=>choice.GetProperty("ramGb").GetInt32()).Where(value=>value is 4 or 6).Distinct().Order().ToArray();
        int? Capacity(AttributeOption option)=>PhoneDiscoveryRules.MemoryGb(new(definition.Id,"ram",definition.DataType.ToString().ToLowerInvariant(),"","",definition.Unit,null,null,null,null,null,null,[new(option.Id,option.LabelFa,option.LabelEn)]));
        var missing=verified.Where(value=>!definition.Options.Any(option=>Capacity(option)==value)).ToArray();
        if(missing.Length==0)return 0;
        var options=definition.Options.Select(option=>new OptionInput(option.Id,option.Value,option.LabelFa,option.LabelEn,option.SortOrder)).ToList();
        var order=options.Count==0?0:options.Max(option=>option.SortOrder)+1;
        foreach(var value in missing){var key="development-phone-ram-"+value.ToString(CultureInfo.InvariantCulture)+"gb";if(options.Any(option=>option.Value==key))throw new InvalidOperationException("A development RAM option key is already used with different labels. Preserve and resolve that admin option explicitly.");options.Add(new(null,key,value.ToString(CultureInfo.InvariantCulture)+" گیگابایت",value.ToString(CultureInfo.InvariantCulture)+" GB",order++));}
        await service.SaveAttributeAsync(definition.Id,new(definition.Key,definition.DataType,definition.Unit,definition.Translations.Select(row=>new TranslationInput(row.Locale,row.Name)).ToArray(),options.ToArray(),Convert.ToBase64String(definition.Version)),ct);
        // The general editor writes the shared unit to each translation. This
        // additive import must retain any independently configured locale unit.
        var tracked=catalog.ChangeTracker.Entries<AttributeDefinition>().Single(entry=>entry.Entity.Id==definition.Id).Entity;
        foreach(var translation in tracked.Translations)translation.Unit=definition.Translations.Single(original=>original.Locale==translation.Locale).Unit;
        await catalog.SaveChangesAsync(ct);
        return missing.Length;
    }

    private static ModelAttributeInput Value(JsonElement model,Spec spec,string attributeId)
    {
        var value=spec.Source=="modelCode"?model.GetProperty(spec.Source):model.GetProperty("specifications").GetProperty(spec.Source);
        if(spec.Type==AttributeDataType.Number){var raw=value.GetString()!;if(!decimal.TryParse(raw,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var number)||number<=0)throw new InvalidOperationException("A reviewed phone numeric specification is invalid.");return new(attributeId,Number:number);}
        var text=value.ValueKind==JsonValueKind.Array?string.Join(" + ",value.EnumerateArray().Select(item=>item.GetString()))+" MP":value.GetString()!;
        if(spec.Unit is not null)text+=" "+spec.Unit;
        return new(attributeId,text,text);
    }
    private static string Text(JsonElement value,string property)=>value.GetProperty(property).GetString()??throw new InvalidOperationException("The reviewed phone dataset has a missing text value.");
    private static async Task<JsonElement> ReadDatasetAsync(string contentRoot,CancellationToken ct)
    {
        var path=Path.Combine(contentRoot,DatasetRelativePath);if(!File.Exists(path))path=Path.GetFullPath(Path.Combine(contentRoot,"../..",DatasetRelativePath));
        var data=await File.ReadAllBytesAsync(path,ct);
        if(data.Length>500000||Convert.ToHexStringLower(SHA256.HashData(data))!=DatasetSha256)throw new InvalidOperationException("The development phone dataset does not match the reviewed version and hash.");
        using var document=JsonDocument.Parse(data,new(){MaxDepth=24});var root=document.RootElement;
        if(root.GetProperty("schemaVersion").GetInt32()!=1||Text(root,"datasetId")!="samsung-iran-market-2026-10-28-v1"||!root.GetProperty("isDemo").GetBoolean()||root.GetProperty("stockAndSupplyGuarantee").GetBoolean()||root.GetProperty("referencePricesIncluded").GetBoolean()||root.GetProperty("publicProvenanceAllowed").GetBoolean()||root.GetProperty("allowedEnvironments").EnumerateArray().Select(value=>value.GetString()).Single()!="Development")throw new InvalidOperationException("Only the reviewed Development phone dataset may be imported.");
        foreach(var model in root.GetProperty("models").EnumerateArray()){
            if(!model.GetProperty("isDemo").GetBoolean()||Text(model,"brandId")!="samsung"||Text(model,"availability")!="unknown"||model.GetProperty("referencePriceRial").ValueKind!=JsonValueKind.Null)throw new InvalidOperationException("Phone sample supply or price claims are not permitted.");
            var images=model.GetProperty("imageUrls").EnumerateArray().Select(value=>value.GetString()!).ToArray();
            if(images.Length is<1 or>24||images.Any(value=>!Uri.TryCreate(value,UriKind.Absolute,out var url)||url.Scheme!="https"||url.Host!="images.samsung.com"||url.UserInfo.Length>0||url.Query.Length>0||url.Fragment.Length>0))throw new InvalidOperationException("Use the reviewed official phone photos.");
            var configurations=model.GetProperty("configurations").EnumerateArray().ToArray();
            if(configurations.Length is<1 or>PhoneDiscoveryRules.MaximumConfigurations)throw new InvalidOperationException("The reviewed phone configuration count is invalid.");
            foreach(var configuration in configurations){
                var expected=Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("market-phone-config:v1:"+Text(model,"key")+":"+Text(configuration,"key"))))[..32];
                if(Text(configuration,"id")!=expected||!configuration.GetProperty("isDemo").GetBoolean()||Text(configuration,"availability")!="unknown"||configuration.GetProperty("linkedStoreVariantId").ValueKind!=JsonValueKind.Null||!images.Contains(Text(configuration,"imageUrl"),StringComparer.Ordinal))throw new InvalidOperationException("Phone samples must preserve the reviewed choice identities and may not link a sellable SKU.");
            }
        }
        return root.Clone();
    }
    private static async Task LockAsync(MarketDbContext db,CancellationToken ct)
    {
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=15;
        command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource='sayman:development-phone-discovery-seed:v1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new InvalidOperationException("Another development phone import is in progress. Retry after it completes.");
    }
}
