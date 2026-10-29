using System.Data;
using System.Security.Cryptography;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Files;

public sealed class PrivateFileSlots
{
    private readonly SemaphoreSlim slots=new(2,2);
    public async Task<IDisposable> EnterAsync(CancellationToken ct){if(!await slots.WaitAsync(0,ct))throw new BusinessException("private_file_busy","Private document processing is busy. Retry the same command later.");return new Lease(slots);}
    private sealed class Lease(SemaphoreSlim slots):IDisposable{private int disposed;public void Dispose(){if(Interlocked.Exchange(ref disposed,1)==0)slots.Release();}}
}
public sealed class PrivateFileVault(FilesDbContext db,IPrivateFileStore store,IPrivateFileScanner scanner,PrivateFileCrypto crypto,PrivateFileSlots slots,TimeProvider time):IPrivateFileVault
{
    public bool Configured=>store.Configured&&scanner.Configured;
    public async Task<PreparedPrivateFile> PrepareAsync(PrivateFileScope scope,PrivateFileInput input,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction is not null)throw new InvalidOperationException("Private document scanning and object I/O must precede the root transaction.");
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Input(input);if(!Configured)throw PrivateFileRules.Unavailable();using var slot=await slots.EnterAsync(ct);
        input=input with{ActorId=PrivateFileRules.Actor(input.ActorId),Bytes=input.Bytes.ToArray()};
        try{return await PrepareCore(scope,input,ct);}catch(Exception e)when(IsContention(e)){throw Busy();}catch(IOException){throw PrivateFileRules.Unavailable();}finally{CryptographicOperations.ZeroMemory(input.Bytes);}
    }
    private async Task<PreparedPrivateFile> PrepareCore(PrivateFileScope scope,PrivateFileInput input,CancellationToken ct)
    {
        var hash=PrivateFileRules.Payload(scope,input);var previous=await db.Objects.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==input.ActorId&&x.CommandId==input.CommandId,ct);
        if(previous is null)await scanner.ScanAsync(input.Bytes,ct);
        PrivateFileObject row;
        await using(var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct)){
            row=await db.Objects.SingleOrDefaultAsync(x=>x.ActorId==input.ActorId&&x.CommandId==input.CommandId,ct)??new();
            if(row.PayloadHash.Length==0){
                if(await db.Objects.CountAsync(x=>x.ActorId==input.ActorId&&x.State!="Attached",ct)>=100)throw new BusinessException("private_file_capacity","Too many unfinished document uploads. Recover existing commands first.");
                // This transaction may have raced with the initial read. A new
                // row is created only after this request itself passed scanning.
                if(previous is not null)throw PrivateFileRules.Unavailable();
                var envelope=crypto.Encrypt(scope,row.Id,hash,input.Filename,input.Bytes);
                row.Kind=scope.Kind;row.ResourceId=scope.ResourceId;row.OwnerId=scope.OwnerId;row.ActorId=input.ActorId;row.CommandId=input.CommandId;row.ResourceVersion=input.ResourceVersion;row.PayloadHash=hash;row.IntentHash=input.IntentHash;row.PlaintextHash=PrivateFileRules.Hash(input.Bytes);row.CiphertextHash=PrivateFileRules.Hash(envelope.Bytes);row.ContentType=input.ContentType;row.Bytes=input.Bytes.Length;row.Nonce=envelope.Bytes.AsSpan(4,12).ToArray();row.ProtectedKey=envelope.ProtectedKey;row.ProtectedFilename=envelope.ProtectedFilename;row.CreatedAt=time.GetUtcNow().ToUniversalTime();db.Objects.Add(row);await db.SaveChangesAsync(ct);
            }else if(row.PayloadHash!=hash||!Matches(row,scope))throw new BusinessException("private_file_command_conflict","The document command already belongs to different input.");
            await transaction.CommitAsync(ct);
        }
        db.ChangeTracker.Clear();
        if(row.State is "Stored"or"Attached")await VerifyStored(row,ct);
        else{
            if(row.State!="Staged")throw PrivateFileRules.Unavailable();
            var encrypted=crypto.Recreate(scope,row.Id,hash,row.ProtectedKey,row.Nonce,input.Bytes);
            if(PrivateFileRules.Hash(encrypted)!=row.CiphertextHash)throw PrivateFileRules.Unavailable();
            if(!await store.CreateAsync(row.Id,encrypted,ct))await VerifyStored(row,ct);
            await using var stored=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
            row=await db.Objects.SingleAsync(x=>x.Id==row.Id,ct);
            if(row.State=="Staged"){row.State="Stored";row.StoredAt=Later(time.GetUtcNow(),row.CreatedAt);await db.SaveChangesAsync(ct);}else if(row.State is not("Stored"or"Attached"))throw PrivateFileRules.Unavailable();
            await stored.CommitAsync(ct);db.ChangeTracker.Clear();
        }
        return new(row.Id,row.PayloadHash,row.Bytes,row.ContentType);
    }
    public async Task AttachAsync(PrivateFileScope scope,string fileId,string actorId,string commandId,string intentHash,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("File attachment requires the root shared Serializable transaction.");
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(fileId);PrivateFileRules.Id(commandId);actorId=PrivateFileRules.Actor(actorId);if(!PrivateFileRules.IsHash(intentHash))throw PrivateFileRules.Invalid();
        var row=await db.Objects.SingleOrDefaultAsync(x=>x.Id==fileId&&x.Kind==scope.Kind&&x.ResourceId==scope.ResourceId&&x.OwnerId==scope.OwnerId&&x.ActorId==actorId&&x.CommandId==commandId,ct)??throw Missing();
        if(row.IntentHash!=intentHash)throw new BusinessException("private_file_command_conflict","The prepared document belongs to a different command intent.");if(row.State=="Attached")return;if(row.State!="Stored"||row.StoredAt is null)throw PrivateFileRules.Unavailable();row.State="Attached";row.AttachedAt=Later(time.GetUtcNow(),row.StoredAt.Value);await db.SaveChangesAsync(ct);
    }
    public async Task<PrivateFileDownload> ReadAsync(PrivateFileScope scope,string fileId,CancellationToken ct)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(fileId);
        var row=await db.Objects.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==fileId&&x.Kind==scope.Kind&&x.ResourceId==scope.ResourceId&&x.OwnerId==scope.OwnerId&&x.State=="Attached",ct)??throw Missing();
        var bytes=await VerifyStored(row,ct);var document=crypto.Decrypt(scope,row.Id,row.PayloadHash,row.ProtectedKey,row.ProtectedFilename,row.ContentType,bytes,row.Bytes);
        if(PrivateFileRules.Hash(document.Bytes)!=row.PlaintextHash){CryptographicOperations.ZeroMemory(document.Bytes);throw PrivateFileRules.Unavailable();}return document;
    }
    public async Task<PrivateFileDescriptor> DescribeAsync(PrivateFileScope scope,string fileId,CancellationToken ct)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(fileId);var row=await db.Objects.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==fileId&&x.Kind==scope.Kind&&x.ResourceId==scope.ResourceId&&x.OwnerId==scope.OwnerId&&x.State=="Attached",ct)??throw Missing();
        if(row.Bytes is <16 or >PrivateFileRules.MaxBytes||!PrivateFileRules.ContentTypes.Contains(row.ContentType,StringComparer.Ordinal))throw PrivateFileRules.Unavailable();return new(crypto.Filename(scope,fileId,row.ProtectedFilename),row.ContentType,row.Bytes);
    }
    private async Task<byte[]> VerifyStored(PrivateFileObject row,CancellationToken ct){if(!store.Configured)throw PrivateFileRules.Unavailable();var bytes=await store.ReadAsync(row.Id,checked(row.Bytes+PrivateFileRules.EnvelopeOverhead),ct)??throw PrivateFileRules.Unavailable();if(PrivateFileRules.Hash(bytes)!=row.CiphertextHash)throw PrivateFileRules.Unavailable();return bytes;}
    private static bool Matches(PrivateFileObject row,PrivateFileScope scope)=>row.Kind==scope.Kind&&row.ResourceId==scope.ResourceId&&row.OwnerId==scope.OwnerId;
    private static DateTimeOffset Later(DateTimeOffset now,DateTimeOffset baseline)=>now<baseline?baseline:now.ToUniversalTime();
    private static bool IsContention(Exception error){for(Exception? current=error;current is not null;current=current.InnerException)if(current is DbUpdateConcurrencyException||current is SqlException{Number:1205 or 2601 or 2627})return true;return false;}
    private static BusinessException Busy()=>new("private_file_busy","The document is being processed. Recover or retry the same command.");
    private static BusinessException Missing()=>new("not_found","Private document was not found.");
}
