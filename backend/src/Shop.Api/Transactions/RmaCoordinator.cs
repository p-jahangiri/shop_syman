using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Identity;
using Shop.Modules.Sales;

// Only Identity audit and Sales participate. Return triage never enlists or
// calls a financial/stock writer and cannot change fulfilment rights.
public sealed class RmaCoordinator(IdentityDbContext identity,SalesDbContext sales,RmaService service,ILogger<RmaCoordinator> logger)
{
    public async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        if(identity.Database.CurrentTransaction is not null||sales.Database.CurrentTransaction is not null)throw new InvalidOperationException("RMA coordination requires an independent scope.");
        await using var transaction=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var connection=identity.Database.GetDbConnection();var original=sales.Database.GetDbConnection();
        if(original.State!=ConnectionState.Closed||!string.Equals(original.Database,connection.Database,StringComparison.OrdinalIgnoreCase)
            ||!string.Equals(original.DataSource,connection.DataSource,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("RMA and its audit must share the canonical database and root transaction.");
        sales.Database.SetDbConnection(connection,false);await sales.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);
        try{var value=await work();await transaction.CommitAsync(ct);return value;}
        finally{try{await sales.Database.UseTransactionAsync(null,CancellationToken.None);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Could not detach RMA Sales after {ExceptionType}",e.GetType().Name);}}
    }
    public Task<T> ReadAsync<T>(Func<RmaService,Task<T>> read,CancellationToken ct)=>Atomic(()=>read(service),ct);
    private Task<T> WriteAsync<T>(string actor,string action,string path,string trace,Func<Task<T>> write,Func<T,bool> replayed,CancellationToken ct)
        =>Atomic(async()=>{var result=await write();if(!replayed(result)){identity.Audit.Add(new AuditEvent{ActorId=actor,Action=action,Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}return result;},ct);
    public Task<RmaPolicyResult> PolicyAsync(string actor,string command,RmaPolicyInput input,string path,string trace,CancellationToken ct)
        =>WriteAsync(actor,"RMA_POLICY_WRITE",path,trace,()=>service.WritePolicyAsync(actor,command,input,ct),r=>r.Replayed,ct);
    public Task<RmaCommandResult> CreateAsync(string owner,string order,string command,CreateRmaInput input,string path,string trace,CancellationToken ct)
        =>WriteAsync(owner,"RMA_SUBMIT",path,trace,()=>service.CreateAsync(owner,order,command,input,ct),r=>r.Replayed,ct);
    public Task<RmaCommandResult> WithdrawAsync(string owner,string id,string command,WithdrawRmaInput input,string path,string trace,CancellationToken ct)
        =>WriteAsync(owner,"RMA_WITHDRAW",path,trace,()=>service.WithdrawAsync(owner,id,command,input,ct),r=>r.Replayed,ct);
    public Task<RmaCommandResult> ReviewAsync(string actor,string id,string command,ReviewRmaInput input,string path,string trace,CancellationToken ct)
        =>WriteAsync(actor,input.Action=="startReview"?"RMA_REVIEW_START":"RMA_REVIEW_COMPLETE",path,trace,()=>service.ReviewAsync(actor,id,command,input,ct),r=>r.Replayed,ct);
}
