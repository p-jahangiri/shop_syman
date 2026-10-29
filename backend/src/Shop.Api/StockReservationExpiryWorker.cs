using Shop.Modules.Inventory;

public sealed class StockReservationExpiryWorker(IServiceScopeFactory scopes, TimeProvider clock, IConfiguration configuration, ILogger<StockReservationExpiryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Inventory:ExpiryEnabled", true)) return;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), clock);
        try {
            while (await timer.WaitForNextTickAsync(stoppingToken)) {
                try {
                    await using var scope = scopes.CreateAsyncScope();
                    var expired = await scope.ServiceProvider.GetRequiredService<StockReservationService>().ExpireBatchAsync(100, stoppingToken);
                    if (expired > 0) logger.LogInformation("Released {Count} expired stock reservations", expired);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception e) when (e is not OutOfMemoryException) { logger.LogError("Stock reservation expiry failed ({ErrorType}); the next bounded batch will retry", e.GetType().Name); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
