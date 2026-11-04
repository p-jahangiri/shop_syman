using Shop.Modules.Sales;

public sealed record OrderExpiryBatchResult(int Expired, int Failed);
public sealed class OrderExpiryRunner(IServiceScopeFactory scopes, ILogger<OrderExpiryRunner> logger)
{
    public async Task<OrderExpiryBatchResult> RunAsync(CancellationToken ct)
    {
        OrderExpiryCandidate[] candidates; await using (var reader = scopes.CreateAsyncScope()) candidates = await reader.ServiceProvider.GetRequiredService<OrderService>().DueAsync(ct);
        var expired = 0; var failed = 0;
        foreach (var candidate in candidates) {
            ct.ThrowIfCancellationRequested();
            try { await using var scope = scopes.CreateAsyncScope(); if (await scope.ServiceProvider.GetRequiredService<SalesTransactionCoordinator>().RunAsync(() => scope.ServiceProvider.GetRequiredService<OrderService>().ExpireAsync(candidate, ct), inventoryOnly: true, ct: ct)) expired++; }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e) when (e is not OutOfMemoryException) { failed++; logger.LogError("An order expiry failed ({ErrorType}); its next bounded batch will retry", e.GetType().Name); }
        }
        return new(expired, failed);
    }
}
public sealed class OrderExpiryWorker(OrderExpiryRunner runner, TimeProvider clock, IConfiguration configuration, ILogger<OrderExpiryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Sales:ExpiryEnabled", true)) return;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), clock);
        try {
            while (await timer.WaitForNextTickAsync(stoppingToken)) {
                try { var result = await runner.RunAsync(stoppingToken); if (result.Expired > 0 || result.Failed > 0) logger.LogInformation("Order expiry batch: {Expired} expired, {Failed} failed", result.Expired, result.Failed); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception e) when (e is not OutOfMemoryException) { logger.LogError("Order expiry batch failed ({ErrorType}); it will retry", e.GetType().Name); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
