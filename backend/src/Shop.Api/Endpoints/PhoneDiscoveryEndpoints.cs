using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Notifications;
using Shop.SharedKernel;

public sealed class PhoneDiscoveryCoordinator(IdentityDbContext identity,CatalogDbContext catalog,InventoryDbContext inventory,MarketDbContext market,NotificationsDbContext notifications,PhoneDiscoveryService service,IPhoneDiscoveryNotificationWriter writer)
{
    private async Task<T> Run<T>(Func<Task<T>> action,Func<T,bool> audited,string actor,string resource,string trace,CancellationToken ct)
    {
        await using var transaction=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{var connection=identity.Database.GetDbConnection();foreach(var db in new DbContext[]{catalog,inventory,market,notifications}){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Phone notification commands require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(db);}var result=await action();if(audited(result)){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="PHONE_DISCOVERY",Resource=resource,TraceId=trace});await identity.SaveChangesAsync(ct);}await transaction.CommitAsync(ct);return result;}
        finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<PhoneInterestResult> InterestAsync(string owner,string listing,string command,PhoneInterestInput input,string trace,CancellationToken ct)=>Run(()=>service.InterestAsync(owner,listing,command,input,ct),result=>!result.Replayed,owner,"/api/phones/interests",trace,ct);
    public Task<int> NotifyOwnerAsync(string owner,CancellationToken ct)=>Run(()=>service.NotifyOwnerAsync(owner,writer,ct),count=>count>0,"system-phone-discovery","/api/phones/interests/availability","phone-availability",ct);
}

public static class PhoneDiscoveryEndpoints
{
    public static IServiceCollection AddPhoneDiscovery(this IServiceCollection services,IConfiguration configuration,bool allowDemo)
    {
        services.AddSingleton(new PhoneDiscoveryOptions(configuration["PhoneDiscovery:CategoryId"]??"phones",configuration.GetValue("PhoneDiscovery:AutomaticNotificationsEnabled",true)));
        services.AddScoped(sp=>new PhoneDiscoveryService(sp.GetRequiredService<MarketDbContext>(),sp.GetRequiredService<IMarketModelCatalog>(),sp.GetRequiredService<ICatalogSourcingReader>(),sp.GetRequiredService<ICatalogOfferReader>(),sp.GetRequiredService<IInventoryReader>(),sp.GetRequiredService<TimeProvider>(),sp.GetRequiredService<PhoneDiscoveryOptions>(),allowDemo));
        services.AddScoped<IPhoneConfigurationReader>(sp=>sp.GetRequiredService<PhoneDiscoveryService>());services.AddScoped<PhoneDiscoveryCoordinator>();
        // Preserve old constructors and legacy JSON shapes; only configured
        // selections opt into the new reader and notification family.
        services.AddScoped<IMarketSourcingReader>(sp=>new MarketSourcingReader(sp.GetRequiredService<MarketDbContext>(),sp.GetRequiredService<ICatalogSourcingReader>(),sp.GetRequiredService<TimeProvider>(),allowDemo,sp.GetRequiredService<IPhoneConfigurationReader>()));
        services.AddScoped(sp=>new SourcingOfferService(sp.GetRequiredService<MarketDbContext>(),sp.GetRequiredService<ICatalogOfferReader>(),sp.GetRequiredService<IPurchaseConfiguration>(),sp.GetRequiredService<TimeProvider>(),allowDemo,sp.GetRequiredService<IPhoneDiscoveryNotificationWriter>()));
        services.AddHostedService<PhoneAvailabilityWorker>();return services;
    }
    public static void MapPhoneDiscovery(this WebApplication app,string[] origins)
    {
        var publicPhones=app.MapGroup("/api/phones/{locale}").AllowAnonymous().RequireRateLimiting("cart");publicPhones.AddEndpointFilter(InputValidation.Filter);
        publicPhones.MapPost("/search",async(string locale,PhoneSearchInput input,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(locale,input,ct)));
        publicPhones.MapGet("/{id}",async(string locale,string id,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.DetailAsync(locale,id,ct)));
        var interests=app.MapGroup("/api/phones/interests").RequireAuthorization("customer").RequireRateLimiting("addresses");interests.AddEndpointFilter(InputValidation.Filter);
        interests.AddEndpointFilter(async(context,next)=>{var http=context.HttpContext;var origin=http.Request.Headers.Origin.ToString();if((!HttpMethods.IsGet(http.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);if(http.Request.Query.Keys.Any(k=>k!="cursor")||http.Request.Query["cursor"].Count>1)return Results.BadRequest(new{title="invalid_phone_interest"});return await next(context);});
        interests.MapGet("",async(string? cursor,ClaimsPrincipal user,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.InterestsAsync(User(user),cursor,ct)));
        interests.MapGet("/{listingId}/{configurationId}",async(string listingId,string configurationId,HttpContext http,PhoneDiscoveryService service,CancellationToken ct)=>http.Request.QueryString.HasValue?Results.BadRequest(new{title="invalid_phone_interest"}):Results.Ok(await service.ReadInterestAsync(User(http.User),listingId,configurationId,ct)));
        interests.MapPut("/{listingId}/commands/{requestId}",async(string listingId,string requestId,PhoneInterestInput input,HttpContext http,PhoneDiscoveryCoordinator service,CancellationToken ct)=>http.Request.QueryString.HasValue?Results.BadRequest(new{title="invalid_phone_interest"}):Results.Ok(await service.InterestAsync(User(http.User),listingId,requestId,input,http.TraceIdentifier,ct)));
        interests.MapGet("/commands/{requestId}",async(string requestId,HttpContext http,PhoneDiscoveryService service,CancellationToken ct)=>http.Request.QueryString.HasValue?Results.BadRequest(new{title="invalid_phone_interest"}):Results.Ok(await service.InterestReceiptAsync(User(http.User),requestId,ct)));
    }
    public static void MapAdminPhoneDiscovery(this RouteGroupBuilder admin)
    {
        admin.MapGet("/market/{listingId}/phone-configurations",async(string listingId,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.AdminAsync(listingId,ct))).RequireAuthorization("catalog.read");
        admin.MapPut("/market/{listingId}/phone-configurations/{configurationId}/commands/{requestId}",async(string listingId,string configurationId,string requestId,PhoneConfigurationCommand input,ClaimsPrincipal user,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.SaveAsync(User(user),listingId,configurationId,requestId,input,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/phone-configuration-commands/{requestId}",async(string requestId,ClaimsPrincipal user,PhoneDiscoveryService service,CancellationToken ct)=>Results.Ok(await service.ConfigurationReceiptAsync(User(user),requestId,ct))).RequireAuthorization("catalog.write");
    }
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete account session is required.");
}

public sealed class PhoneAvailabilityWorker(IServiceScopeFactory scopes,PhoneDiscoveryOptions options,TimeProvider time,ILogger<PhoneAvailabilityWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!options.AutomaticNotificationsEnabled)return;string? after=null;using var timer=new PeriodicTimer(TimeSpan.FromMinutes(1),time);
        try{while(await timer.WaitForNextTickAsync(stoppingToken)){try{string[] owners;await using(var read=scopes.CreateAsyncScope())owners=await read.ServiceProvider.GetRequiredService<PhoneDiscoveryService>().ActiveOwnersAsync(after,stoppingToken);if(owners.Length==0){after=null;continue;}foreach(var owner in owners){await using var scope=scopes.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<PhoneDiscoveryCoordinator>().NotifyOwnerAsync(owner,stoppingToken);after=owner;var pulses=scope.ServiceProvider.GetRequiredService<PrivateRealtimeQueue>().Drain();if(pulses.Length>0){using var dispatch=CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);dispatch.CancelAfter(TimeSpan.FromSeconds(2));try{await scope.ServiceProvider.GetRequiredService<IPrivateRealtimeDispatcher>().DispatchAsync(pulses,dispatch.Token);}catch(Exception error)when(error is not OutOfMemoryException){logger.LogWarning("Committed phone notices could not be signalled ({ErrorType}); clients recover by reading their SQL inbox",error.GetType().Name);}}}}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}catch(Exception error)when(error is not OutOfMemoryException){logger.LogWarning("Phone availability notification batch failed ({ErrorType}); unchanged interests will be retried",error.GetType().Name);}}}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){}
    }
}
