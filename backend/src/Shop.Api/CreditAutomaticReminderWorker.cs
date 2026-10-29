using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Microsoft.Extensions.DependencyInjection;
public sealed record CreditAutomaticReminderBatchResult(int Scanned,int Sent,int Skipped,int Failed);
public sealed class CreditAutomaticReminderRunner(IServiceScopeFactory scopes,TimeProvider clock,CreditReminderDeliveryOptions delivery,ILogger<CreditAutomaticReminderRunner> logger)
{
    private readonly SemaphoreSlim gate=new(1,1);private string? after,policyId,civilDay;
    public async Task<CreditAutomaticReminderBatchResult> RunAsync(CancellationToken ct)
    {
        if(!delivery.WorkerEnabled)return new(0,0,0,0);await gate.WaitAsync(ct);try{return await RunCore(ct);}finally{gate.Release();}
    }
    private async Task<CreditAutomaticReminderBatchResult> RunCore(CancellationToken ct)
    {
        CreditReminderPolicyRevisionData? p;await using(var scope=scopes.CreateAsyncScope())p=(await scope.ServiceProvider.GetRequiredService<CreditReminderPolicyCoordinator>().ReadAsync(s=>s.CurrentAsync(ct),ct)).Current;
        if(p is null||!p.Enabled){after=null;policyId=null;civilDay=null;return new(0,0,0,0);}
        var today=ChequeReportRules.Today(clock.GetUtcNow());if(policyId!=p.Id||civilDay!=today){policyId=p.Id;civilDay=today;after=null;}
        // Before the chosen local time no candidate scans or writes are needed.
        if(!CreditReminderPolicyRules.Ready(p,clock.GetUtcNow()))return new(0,0,0,0);
        CreditAutomaticReminderCandidate[] candidates;await using(var reader=scopes.CreateAsyncScope())candidates=await reader.ServiceProvider.GetRequiredService<CreditAutomaticReminderService>().CandidatesAsync(p.Id,today,after,ct);
        var sent=0;var skipped=0;var failed=0;
        foreach(var c in candidates){ct.ThrowIfCancellationRequested();try{
            await using var scope=scopes.CreateAsyncScope();var services=scope.ServiceProvider;var service=services.GetRequiredService<CreditAutomaticReminderService>();var value=await services.GetRequiredService<CreditReminderCoordinator>().Atomic(async()=>{
                var result=await service.SendAsync(c,p.Id,today,ct);if(result is null)return false;if(!result.Result.Replayed){var identity=services.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=CreditAutomaticReminderService.Actor,Action="CREDIT_CHEQUE_REMINDER_AUTOMATIC",Resource="/internal/credit/reminder-policy/"+result.PolicyRevisionId,TraceId=result.Result.CommandId});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(c,result,today,ct);}return !result.Result.Replayed;
            },ct);
            if(value){sent++;using var stop=CancellationTokenSource.CreateLinkedTokenSource(ct);stop.CancelAfter(TimeSpan.FromSeconds(2));try{await services.GetRequiredService<IPrivateRealtimeDispatcher>().DispatchAsync(services.GetRequiredService<PrivateRealtimeQueue>().Drain(),stop.Token);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("A committed automatic reminder could not be signalled; the SQL inbox remains authoritative.");}}else skipped++;
        }catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}catch(Exception e)when(e is not OutOfMemoryException){failed++;logger.LogWarning("An automatic reminder candidate failed ({ErrorType}); the next bounded sweep will retry.",e.GetType().Name);}after=c.Id;}
        if(candidates.Length<20)after=null;return new(candidates.Length,sent,skipped,failed);
    }
}
public sealed class CreditAutomaticReminderWorker(CreditAutomaticReminderRunner runner,TimeProvider clock,IConfiguration config,ILogger<CreditAutomaticReminderWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!config.GetValue("Credit:AutomaticRemindersEnabled",true))return;using var timer=new PeriodicTimer(TimeSpan.FromMinutes(1),clock);
        try{while(await timer.WaitForNextTickAsync(stoppingToken)){try{var result=await runner.RunAsync(stoppingToken);if(result.Sent>0||result.Failed>0)logger.LogInformation("Private cheque reminder batch: {Scanned} scanned, {Sent} sent, {Skipped} skipped, {Failed} failed.",result.Scanned,result.Sent,result.Skipped,result.Failed);}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Automatic reminder sweep failed ({ErrorType}); the next tick will retry.",e.GetType().Name);}}}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){}
    }
}
