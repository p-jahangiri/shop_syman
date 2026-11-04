using Microsoft.EntityFrameworkCore;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public sealed record OrderProjectionBatchResult(int Delivered,int Failed);
public sealed class OrderProjectionRunner(IServiceScopeFactory scopes,ILogger<OrderProjectionRunner> logger)
{
    public async Task<OrderProjectionBatchResult> RunAsync(CancellationToken ct)
    {
        string[] pending;
        await using(var scope=scopes.CreateAsyncScope())pending=await scope.ServiceProvider.GetRequiredService<OrderOutboxService>().PendingEventIdsAsync(100,ct);
        var delivered=0;var failed=0;
        foreach(var eventId in pending){
            ct.ThrowIfCancellationRequested();
            try{
                SourcingAgreementOrderedEvent message;
                await using(var reader=scopes.CreateAsyncScope())message=await reader.ServiceProvider.GetRequiredService<OrderOutboxService>().ReadAsync(eventId,ct);
                // Market commits first in its own scope. Losing the subsequent
                // acknowledgement only causes an idempotent replay by EventId.
                await using(var consumer=scopes.CreateAsyncScope())await consumer.ServiceProvider.GetRequiredService<IMarketOrderProjection>().ApplyAsync(message,ct);
                await MarkAsync(eventId,true,ct);delivered++;
            }catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}
            catch(Exception e)when(e is not OutOfMemoryException){
                failed++;logger.LogError("An order projection failed ({ErrorType}); its outbox event remains retryable",e.GetType().Name);
                try{await MarkAsync(eventId,false,ct);}catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}catch(Exception mark)when(mark is not OutOfMemoryException){logger.LogError("Could not record projection retry progress ({ErrorType})",mark.GetType().Name);}
            }
        }
        return new(delivered,failed);
    }
    private async Task MarkAsync(string eventId,bool delivered,CancellationToken ct)
    {
        await using var scope=scopes.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        await using var tx=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable,ct);
        var outbox=scope.ServiceProvider.GetRequiredService<OrderOutboxService>();
        if(delivered)await outbox.MarkDeliveredAsync(eventId,ct);else await outbox.MarkFailedAsync(eventId,ct);
        await tx.CommitAsync(ct);
    }
}
public sealed class OrderProjectionWorker(OrderProjectionRunner runner,TimeProvider clock,IConfiguration configuration,ILogger<OrderProjectionWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!configuration.GetValue("Market:OrderProjectionEnabled",true))return;
        using var timer=new PeriodicTimer(TimeSpan.FromMinutes(1),clock);
        try{while(await timer.WaitForNextTickAsync(stoppingToken)){
            try{var result=await runner.RunAsync(stoppingToken);if(result.Delivered>0||result.Failed>0)logger.LogInformation("Order projections delivered {Delivered}; failed {Failed}",result.Delivered,result.Failed);}
            catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}
            catch(Exception e)when(e is not OutOfMemoryException){logger.LogError("Order projection batch failed ({ErrorType})",e.GetType().Name);}
        }}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){}
    }
}
