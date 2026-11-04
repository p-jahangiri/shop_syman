using Shop.Modules.Notifications;
using Shop.SharedKernel;

public sealed class SmsDeliveryRunner(IServiceScopeFactory scopes, ILogger<SmsDeliveryRunner> logger)
{
    public async Task RunAsync(CancellationToken ct)
    {
        SmsBusinessEvent[] signals;
        await using (var reader = scopes.CreateAsyncScope())
            signals = await reader.ServiceProvider.GetRequiredService<ISalesSmsSignals>().PendingAsync(ct);
        foreach (var value in signals) {
            ct.ThrowIfCancellationRequested();
            try {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ISmsBusinessQueue>().EnqueueAsync(value, ct);
                await scope.ServiceProvider.GetRequiredService<ISalesSmsSignals>().AcknowledgeAsync(value.SourceId, ct);
            } catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e) when (e is not OutOfMemoryException) {
                logger.LogWarning("Could not retain an SMS business signal ({ErrorType})", e.GetType().Name);
            }
        }
        string[] pending;
        await using (var reader = scopes.CreateAsyncScope())
            pending = await reader.ServiceProvider.GetRequiredService<SmsMessageService>().PendingAsync(ct);
        foreach (var id in pending) {
            ct.ThrowIfCancellationRequested();
            try {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<SmsMessageService>().ProcessAsync(id, ct);
            } catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e) when (e is not OutOfMemoryException) {
                logger.LogWarning("Could not complete an SMS queue item ({ErrorType})", e.GetType().Name);
            }
        }
    }
}
public sealed class SmsDeliveryWorker(SmsDeliveryRunner runner, TimeProvider clock, IConfiguration configuration,
    ILogger<SmsDeliveryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Sms:AutomaticProcessingEnabled", true)) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15), clock);
        try {
            while (await timer.WaitForNextTickAsync(stoppingToken)) {
                try { await runner.RunAsync(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception e) when (e is not OutOfMemoryException) {
                    logger.LogWarning("SMS queue processing failed ({ErrorType})", e.GetType().Name);
                }
            }
        } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
