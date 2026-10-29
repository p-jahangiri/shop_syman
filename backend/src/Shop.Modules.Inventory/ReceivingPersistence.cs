using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

internal static class ReceivingPersistence
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=16};
    internal static void RequireTransaction(InventoryDbContext db)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Receiving commands require the root Serializable transaction shared with Market, Catalog and audit.");
    }
    internal static T Read<T>(ReceivingCommand command)=>JsonSerializer.Deserialize<T>(command.ResultJson,Json)??throw new InvalidOperationException("The saved receiving command result is invalid.");
    internal static async Task<ReceivingCommand?> Replay(InventoryDbContext db,string actor,string operation,string key,string target,string? request,string? task,string hash,CancellationToken ct)
    {
        // Missing rows need write-intent range locks too. A shared gap retained
        // while waiting for a later mapping lock can block its owner's INSERT.
        var row=await db.ReceivingCommands.FromSqlInterpolated($"SELECT * FROM [inventory].[ReceivingCommands] WITH (UPDLOCK, HOLDLOCK) WHERE [ActorId]={actor} AND [Operation]={operation} AND [CommandId]={key}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(row is not null&&(row.TargetId!=target||row.RequestId!=request||row.TaskId!=task||row.PayloadHash!=hash))throw new BusinessException("idempotency_conflict","The receiving command belongs to another target or payload.");
        return row;
    }
    internal static async Task Remember<T>(InventoryDbContext db,string actor,string operation,string key,string target,string? request,string? task,bool demo,string hash,T result,DateTimeOffset at,CancellationToken ct)
    {
        var json=JsonSerializer.Serialize(result,Json);if(Encoding.Unicode.GetByteCount(json)>262144)throw new BusinessException("receiving_capacity_unavailable","The receipt exceeds its supported response bound.");
        db.ReceivingCommands.Add(new(){ActorId=actor,Operation=operation,CommandId=key,TargetId=target,RequestId=request,TaskId=task,ContainsDemo=demo,PayloadHash=hash,ResultJson=json,At=at});await db.SaveChangesAsync(ct);
    }
    internal static BusinessException Missing()=>new("not_found","The receiving record was not found.");
}
