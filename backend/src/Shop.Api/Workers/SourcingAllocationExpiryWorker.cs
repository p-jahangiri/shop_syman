using Shop.SharedKernel;

public sealed class SourcingAllocationExpiryWorker(IServiceScopeFactory scopes,TimeProvider clock,IConfiguration configuration,ILogger<SourcingAllocationExpiryWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!configuration.GetValue("Inventory:AllocationExpiryEnabled",true))return;
        using var timer=new PeriodicTimer(TimeSpan.FromMinutes(1),clock);
        try{
            while(await timer.WaitForNextTickAsync(stoppingToken)){
                try{
                    await using var scope=scopes.CreateAsyncScope();
                    var count=await scope.ServiceProvider.GetRequiredService<IInventorySourcingAllocations>().ExpireBatchAsync(100,stoppingToken);
                    if(count>0)logger.LogInformation("Released {Count} expired sourcing allocations",count);
                }catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}
                catch(Exception error)when(error is not OutOfMemoryException){logger.LogError("Sourcing allocation expiry failed ({ErrorType}); the next bounded batch will retry",error.GetType().Name);}
            }
        }catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){}
    }
}
