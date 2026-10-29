using System.Collections.Concurrent;
using System.Data;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;

// Store/scanner captures below exist only in this test assembly. SQL, EF,
// Data Protection, encryption, transaction and migration execution are real.
public sealed class PrivateFileSqlTests(SqlFixture sql):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static PrivateFileScope Scope()=>new("support",Id(),"OWNER"+Id().ToUpperInvariant());
    private static PrivateFileInput Input()=>new("ACTOR"+Id().ToUpperInvariant(),Id(),"AAAAAAAAAAA=","مدرک نمونه.pdf","application/pdf",Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic isolated SQL QA document.\n%%EOF\n"),new string('A',64));
    internal sealed class Scan:IPrivateFileScanner{public bool Configured{get;set;}=true;public int Calls;public Task ScanAsync(ReadOnlyMemory<byte> bytes,CancellationToken ct){Interlocked.Increment(ref Calls);Assert.True(bytes.Span.StartsWith("%PDF-"u8));return Task.CompletedTask;}}
    internal sealed class Store:IPrivateFileStore
    {
        public bool Configured{get;set;}=true;public ConcurrentDictionary<string,byte[]> Objects=[];public int LoseNextAcknowledgement;
        public Task<bool> CreateAsync(string id,byte[] bytes,CancellationToken ct){ct.ThrowIfCancellationRequested();var created=Objects.TryAdd(id,bytes.ToArray());if(Interlocked.Exchange(ref LoseNextAcknowledgement,0)==1)throw new IOException("Synthetic acknowledgement loss after conditional object create.");return Task.FromResult(created);}
        public Task<byte[]?> ReadAsync(string id,int expectedBytes,CancellationToken ct)=>Task.FromResult(Objects.TryGetValue(id,out var raw)?raw.ToArray():null);
    }
    private WebApplicationFactory<Program> Factory(Store store,Scan scan)=>sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IPrivateFileStore>();s.AddSingleton<IPrivateFileStore>(store);s.RemoveAll<IPrivateFileScanner>();s.AddSingleton<IPrivateFileScanner>(scan);}));
    private static async Task<PreparedPrivateFile> Prepare(WebApplicationFactory<Program> factory,PrivateFileScope scope,PrivateFileInput input){await using var service=factory.Services.CreateAsyncScope();return await service.ServiceProvider.GetRequiredService<IPrivateFileVault>().PrepareAsync(scope,input,default);}
    private static async Task Attach(WebApplicationFactory<Program> factory,PrivateFileScope binding,PrivateFileInput input,string id){await using var scope=factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<FilesDbContext>();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await scope.ServiceProvider.GetRequiredService<IPrivateFileVault>().AttachAsync(binding,id,input.ActorId,input.CommandId,input.IntentHash,default);await transaction.CommitAsync();}
    [Fact]public async Task StoredObjectsStayPrivateUntilCommittedAttachmentAndRetryPreservesOriginalKeysAndReceiptFacts()
    {
        var store=new Store();var scanner=new Scan();using var factory=Factory(store,scanner);var binding=Scope();var input=Input();var prepared=await Prepare(factory,binding,input);byte[] key,version;DateTimeOffset? attachedAt;
        await using(var scope=factory.Services.CreateAsyncScope()){
            var vault=scope.ServiceProvider.GetRequiredService<IPrivateFileVault>();var db=scope.ServiceProvider.GetRequiredService<FilesDbContext>();var row=await db.Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id);Assert.Equal("Stored",row.State);Assert.Equal(input.Bytes.Length,row.Bytes);Assert.NotEmpty(row.ProtectedKey);Assert.True(row.ProtectedFilename.AsSpan().IndexOf(Encoding.UTF8.GetBytes(input.Filename))<0);Assert.True(store.Objects[prepared.Id].AsSpan().IndexOf(input.Bytes)<0);key=row.ProtectedKey;
            Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>vault.ReadAsync(binding,prepared.Id,default))).Code);await Assert.ThrowsAsync<InvalidOperationException>(()=>vault.AttachAsync(binding,prepared.Id,input.ActorId,input.CommandId,input.IntentHash,default));
            await using(var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable)){await vault.AttachAsync(binding,prepared.Id,input.ActorId,input.CommandId,input.IntentHash,default);await transaction.RollbackAsync();}
        }
        await using(var scope=factory.Services.CreateAsyncScope()){Assert.Equal("Stored",(await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id)).State);}
        await Attach(factory,binding,input,prepared.Id);
        await using(var scope=factory.Services.CreateAsyncScope()){var vault=scope.ServiceProvider.GetRequiredService<IPrivateFileVault>();var download=await vault.ReadAsync(binding,prepared.Id,default);Assert.Equal(input.Bytes,download.Bytes);Assert.Equal(input.Filename,download.Filename);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>vault.ReadAsync(binding with{OwnerId="FOREIGN"},prepared.Id,default))).Code);var row=await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id);attachedAt=row.AttachedAt;version=row.Version;}
        Assert.Equal(prepared,await Prepare(factory,binding,input));await Attach(factory,binding,input,prepared.Id);
        await using(var scope=factory.Services.CreateAsyncScope()){var row=await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id);Assert.Equal(key,row.ProtectedKey);Assert.Equal(version,row.Version);Assert.Equal(attachedAt,row.AttachedAt);}
        Assert.Equal(1,scanner.Calls);Assert.Single(store.Objects);
    }
    [Fact]public async Task LostObjectAcknowledgementRecoversExactCiphertextWithSameCommandAndRejectsChangedInputOrCorruptObject()
    {
        var store=new Store{LoseNextAcknowledgement=1};var scanner=new Scan();using var factory=Factory(store,scanner);var binding=Scope();var input=Input();Assert.Equal("private_file_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Prepare(factory,binding,input))).Code);var objectBefore=Assert.Single(store.Objects);byte[] key;
        await using(var scope=factory.Services.CreateAsyncScope()){var row=await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.ActorId==input.ActorId&&x.CommandId==input.CommandId);Assert.Equal("Staged",row.State);Assert.Null(row.StoredAt);key=row.ProtectedKey;}
        var recovered=await Prepare(factory,binding,input);Assert.Equal(objectBefore.Key,recovered.Id);Assert.Equal(objectBefore.Value,store.Objects[recovered.Id]);Assert.Equal(1,scanner.Calls);
        foreach(var changed in new[]{input with{IntentHash=new string('B',64)},input with{Filename="other.pdf"},input with{ResourceVersion="AAAAAAAAAAE="},input with{Bytes=Encoding.UTF8.GetBytes("%PDF-1.7\nDifferent synthetic content.\n%%EOF\n")}})Assert.Equal("private_file_command_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Prepare(factory,binding,changed))).Code);
        Assert.Equal("private_file_command_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Prepare(factory,binding with{ResourceId=Id()},input))).Code);
        await Attach(factory,binding,input,recovered.Id);store.Objects[recovered.Id][^1]^=1;await using(var scope=factory.Services.CreateAsyncScope()){Assert.Equal("private_file_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>scope.ServiceProvider.GetRequiredService<IPrivateFileVault>().ReadAsync(binding,recovered.Id,default))).Code);var row=await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.Id==recovered.Id);Assert.Equal(key,row.ProtectedKey);Assert.Equal("Attached",row.State);}
    }
    [Fact]public async Task ConcurrentPreparationConvergesOnOneSqlIntentAndOneConditionalObject()
    {
        var store=new Store();var scanner=new Scan();using var factory=Factory(store,scanner);var binding=Scope();var input=Input();
        async Task<PreparedPrivateFile?> Attempt(){try{return await Prepare(factory,binding,input);}catch(BusinessException e)when(e.Code=="private_file_busy"){return null;}}
        var results=await Task.WhenAll(Attempt(),Attempt());Assert.Contains(results,x=>x is not null);var final=await Prepare(factory,binding,input);Assert.All(results.Where(x=>x is not null),x=>Assert.Equal(final,x));Assert.Single(store.Objects);await using var scope=factory.Services.CreateAsyncScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.CountAsync(x=>x.ActorId==input.ActorId&&x.CommandId==input.CommandId));
    }
    [Fact]public async Task AuditFailureRollsBackAttachedStateAndDownCannotDestroyPersistedKeyHistory()
    {
        var store=new Store();using var factory=Factory(store,new Scan());var binding=Scope();var input=Input();var prepared=await Prepare(factory,binding,input);
        await using(var scope=factory.Services.CreateAsyncScope()){
            var identity=scope.ServiceProvider.GetRequiredService<IdentityContext>();var files=scope.ServiceProvider.GetRequiredService<FilesDbContext>();await using var transaction=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable);files.Database.SetDbConnection(identity.Database.GetDbConnection(),false);await files.Database.UseTransactionAsync(transaction.GetDbTransaction());
            await scope.ServiceProvider.GetRequiredService<IPrivateFileVault>().AttachAsync(binding,prepared.Id,input.ActorId,input.CommandId,input.IntentHash,default);identity.Audit.Add(new AuditEvent{ActorId=input.ActorId,Action="PRIVATE_FILE_QA",Resource=new string('x',501),TraceId=Id()});await Assert.ThrowsAsync<DbUpdateException>(()=>identity.SaveChangesAsync());await transaction.RollbackAsync();await files.Database.UseTransactionAsync(null);
        }
        await using(var scope=factory.Services.CreateAsyncScope()){
            var files=scope.ServiceProvider.GetRequiredService<FilesDbContext>();Assert.Equal("Stored",(await files.Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id)).State);Assert.Empty(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.Where(x=>x.ActorId==input.ActorId).ToArrayAsync());var history=(await files.Database.GetAppliedMigrationsAsync()).ToArray();var exception=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>files.GetService<IMigrator>().MigrateAsync("0"));Assert.Equal(51000,exception.Number);Assert.Equal(history,(await files.Database.GetAppliedMigrationsAsync()).ToArray());Assert.Equal("Stored",(await files.Objects.AsNoTracking().SingleAsync(x=>x.Id==prepared.Id)).State);
        }
    }
}
