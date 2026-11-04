using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Market;
using Shop.SharedKernel;

// Local sample provisioning only. No account is created and no provider is
// invoked. Cross-module coordination belongs to this composition root.
public static class DevelopmentMarketSeed
{
    public static async Task<object> RunAsync(IServiceProvider services,IHostEnvironment environment,CancellationToken ct)
    {
        if(!environment.IsDevelopment())throw new InvalidOperationException("Market samples are unavailable outside Development.");
        var market=services.GetRequiredService<MarketDbContext>();var catalog=services.GetRequiredService<CatalogDbContext>();var identity=services.GetRequiredService<IdentityDbContext>();
        var modules=new DbContext[]{catalog,identity};var enlisted=new List<DbContext>();
        await using var transaction=await market.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        try{
            var connection=market.Database.GetDbConnection();
            foreach(var module in modules){
                var original=module.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Market sample modules must use closed connections to the same local database.");
                module.Database.SetDbConnection(connection,contextOwnsConnection:false);await module.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(module);
            }
            var service=services.GetRequiredService<MarketService>();var created=0;var preserved=0;var now=services.GetRequiredService<TimeProvider>().GetUtcNow();
            foreach(var code in new[]{"a","b","c"}){
                var key="phone-"+code;
                if(await market.Listings.AnyAsync(l=>l.SourceKey=="development-sample"&&l.SourceItemKey==key,ct)){preserved++;continue;}
                var template=await catalog.Products.AsNoTracking().Include(p=>p.Attributes).ThenInclude(a=>a.Selections).SingleOrDefaultAsync(p=>p.Id=="p3",ct)??throw new InvalidOperationException("The explicit development catalogue template p3 is missing. Add real models through the admin instead.");
                var attributes=template.Attributes.Select(a=>new ModelAttributeInput(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Count==0?null:a.Selections.Select(s=>s.OptionId).ToArray())).ToArray();
                var label=code.ToUpperInvariant();
                var model=new CatalogModelInput(template.CategoryId,template.BrandId,"sample-market-phone-"+code,[new("fa","گوشی نمونهٔ بازار "+label,"این مدل و مشخصات فقط دادهٔ نمونهٔ توسعه‌اند؛ موجودی و قیمت واقعی بازار نیستند."),new("en","Sample market phone "+label,"This model and its specifications are development samples, not real market stock or prices.")],attributes,["/products/phone-green.svg"],null);
                var details=new MarketDetailsInput("Published","development-sample",key,"دادهٔ نمونهٔ محلی","Local development samples",null,code=="a"?"unknown":code=="b"?"available":"unavailable",code=="a"?null:code=="b"?now.AddHours(-1):now.AddDays(-3),code=="a"?null:code=="b"?now.AddDays(1):now.AddDays(-2),code=="a"?null:code=="b"?"420000000":"395000000",true);
                await service.CreateModelAsync(new(model,details),"development-seed:market",ct);
                identity.Audit.Add(new(){ActorId="development-seed:market",Action="DEVELOPMENT_MARKET_SAMPLE_CREATED",Resource="/development/market/"+key,TraceId=Guid.NewGuid().ToString("N")});created++;
            }
            await identity.SaveChangesAsync(ct);await transaction.CommitAsync(ct);
            return new{Created=created,Preserved=preserved,IsDemo=true,Scope="Development samples only; no inventory, SKU, order or live market provider"};
        }finally{
            foreach(var module in enlisted){try{await module.Database.UseTransactionAsync(null,CancellationToken.None);}catch(Exception e)when(e is not OutOfMemoryException){services.GetRequiredService<ILoggerFactory>().CreateLogger("DevelopmentMarketSeed").LogWarning("Could not detach {Module} after {ExceptionType}",module.GetType().Name,e.GetType().Name);}}
        }
    }
}
