using Shop.Modules.Catalog.Media;

public sealed class PublicImageCleanupWorker(IServiceScopeFactory scopes,TimeProvider clock,ILogger<PublicImageCleanupWorker> logger,IConfiguration configuration):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!configuration.GetValue("Media:CleanupEnabled",false))return;
        try{
            await Task.Delay(TimeSpan.FromMinutes(5),clock,stoppingToken);
            using var timer=new PeriodicTimer(TimeSpan.FromHours(1),clock);
            do{
                try{
                    await using var scope=scopes.CreateAsyncScope();var result=await scope.ServiceProvider.GetRequiredService<PublicImageReconciler>().RunAsync(25,stoppingToken);
                    logger.LogInformation("Public image reconciliation examined {Examined}, purged {Purged}, failed {Failed}",result.Examined,result.Purged,result.Failed);
                }catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){throw;}
                catch(Exception e){logger.LogWarning("Public image reconciliation unavailable: {ExceptionType}",e.GetType().Name);}
            }while(await timer.WaitForNextTickAsync(stoppingToken));
        }catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){}
    }
}
