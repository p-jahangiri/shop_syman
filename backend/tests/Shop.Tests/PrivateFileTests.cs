using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Files;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;

public sealed class PrivateFileTests
{
    private static readonly PrivateFileScope Scope=new("support",new string('a',32),"CUSTOMER-1");
    private static readonly string Id=new('b',32);
    private static byte[] Document()=>Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic QA document only.\n%%EOF\n");
    private static PrivateFileCrypto Crypto()=>new(new DataProtectionPrivateFiles(new EphemeralDataProtectionProvider()));
    [Fact]public void EnvelopeRoundTripsWithIndependentKeysAndNoPlaintextObjectOrFilename()
    {
        var plain=Document();var crypto=Crypto();var hash=PrivateFileRules.Hash(plain);var first=crypto.Encrypt(Scope,Id,hash,"مدرک نمونه.pdf",plain);var second=crypto.Encrypt(Scope,Id,hash,"مدرک نمونه.pdf",plain);
        Assert.NotEqual(first.Bytes,second.Bytes);Assert.Equal(plain.Length+32,first.Bytes.Length);Assert.True(first.Bytes.AsSpan().IndexOf(plain)<0);Assert.True(first.ProtectedFilename.AsSpan().IndexOf(Encoding.UTF8.GetBytes("مدرک نمونه.pdf"))<0);
        var result=crypto.Decrypt(Scope,Id,hash,first.ProtectedKey,first.ProtectedFilename,"application/pdf",first.Bytes,plain.Length);Assert.Equal(plain,result.Bytes);Assert.Equal("مدرک نمونه.pdf",result.Filename);Assert.Equal(first.Bytes,crypto.Recreate(Scope,Id,hash,first.ProtectedKey,first.Bytes[4..16],plain));
    }
    [Fact]public void EnvelopeRejectsTamperingTruncationMetadataAndCrossResourceOrOwnerKeys()
    {
        var plain=Document();var crypto=Crypto();var hash=PrivateFileRules.Hash(plain);var envelope=crypto.Encrypt(Scope,Id,hash,"document.pdf",plain);
        foreach(var index in new[]{0,4,16,32,envelope.Bytes.Length-1}){var corrupt=envelope.Bytes.ToArray();corrupt[index]^=1;Assert.Equal("private_file_unavailable",Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,hash,envelope.ProtectedKey,envelope.ProtectedFilename,"application/pdf",corrupt,plain.Length)).Code);}
        foreach(var scope in new[]{Scope with{OwnerId="OTHER"},Scope with{ResourceId=new string('c',32)},Scope with{Kind="credit"}})Assert.Throws<BusinessException>(()=>crypto.Decrypt(scope,Id,hash,envelope.ProtectedKey,envelope.ProtectedFilename,"application/pdf",envelope.Bytes,plain.Length));
        Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,new string('A',64),envelope.ProtectedKey,envelope.ProtectedFilename,"application/pdf",envelope.Bytes,plain.Length));
        Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,hash,envelope.ProtectedKey,envelope.ProtectedFilename,"image/jpeg",envelope.Bytes,plain.Length));
        Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,hash,envelope.ProtectedKey,envelope.ProtectedFilename,"application/pdf",envelope.Bytes[..^1],plain.Length));
        var key=envelope.ProtectedKey.ToArray();key[^1]^=1;Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,hash,key,envelope.ProtectedFilename,"application/pdf",envelope.Bytes,plain.Length));
        var name=envelope.ProtectedFilename.ToArray();name[^1]^=1;Assert.Throws<BusinessException>(()=>crypto.Decrypt(Scope,Id,hash,envelope.ProtectedKey,name,"application/pdf",envelope.Bytes,plain.Length));
    }
    [Fact]public void InputRejectsPathsBidiMimeSpoofsInvalidVersionsAndOverLimitBeforeStorage()
    {
        var input=new PrivateFileInput("CUSTOMER-1",Id,"AAAAAAAAAAA=","document.pdf","application/pdf",Document(),new string('A',64));PrivateFileRules.Input(input);
        foreach(var filename in new[]{"../document.pdf","C:\\document.pdf","bad\r\n.pdf","bad\u202e.pdf","unpaired\ud800.pdf",".hidden.pdf","document.pdf ","script.svg"})Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{Filename=filename}));
        Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{ContentType="text/html"}));Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{Bytes=Encoding.UTF8.GetBytes("<html>synthetic unsafe content</html>")}));
        Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{Bytes=new byte[PrivateFileRules.MaxBytes+1]}));Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{ResourceVersion="AAAAAAAAAAA=\n"}));
        Assert.Throws<BusinessException>(()=>PrivateFileRules.Input(input with{ResourceVersion=null!}));Assert.Throws<BusinessException>(()=>PrivateFileRules.Scope(Scope with{Kind="public"}));Assert.Throws<BusinessException>(()=>PrivateFileRules.Key("../other"));
        Assert.NotEqual(PrivateFileRules.Payload(Scope,input),PrivateFileRules.Payload(Scope,input with{Filename="other.pdf"}));Assert.NotEqual(PrivateFileRules.Payload(Scope,input),PrivateFileRules.Payload(Scope,input with{ResourceVersion="AAAAAAAAAAE="}));
    }
    [Fact]public async Task BoundReaderRejectsTruncationAndOversizeAndDoesNotAcceptArbitraryExpectedLength()
    {
        await Assert.ThrowsAsync<BusinessException>(()=>PrivateFileRead.BoundedAsync(new MemoryStream(new byte[49]),48,default));await Assert.ThrowsAsync<BusinessException>(()=>PrivateFileRead.BoundedAsync(new MemoryStream(new byte[47]),48,default));await Assert.ThrowsAsync<BusinessException>(()=>PrivateFileRead.BoundedAsync(new MemoryStream(),int.MaxValue,default));Assert.Equal(48,(await PrivateFileRead.BoundedAsync(new MemoryStream(new byte[48]),48,default)).Length);
    }
    [Fact]public async Task AllSaveOverloadsRejectRewritingOrDeletingExistingFileFactsBeforeDatabaseAccess()
    {
        for(var kind=0;kind<4;kind++){
            await using var db=new FilesDbContext(new DbContextOptionsBuilder<FilesDbContext>().UseSqlServer("Server=127.0.0.1,1;Database=unused;User Id=unused;Password=unused;Connect Timeout=1").Options);var row=new PrivateFileObject{Id=Id,State="Stored",OwnerId="OWNER"};db.Attach(row);if(kind==3)db.Remove(row);else row.OwnerId="OTHER";
            if(kind==0)Assert.Equal("private_file_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);else if(kind==1)Assert.Throws<BusinessException>(()=>db.SaveChanges(false));else if(kind==2)await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());else await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));
        }
    }
    [Fact]public async Task DevelopmentStoreIsPrivateCreateOnlyAndRejectsProductionUnrelatedDirectoriesAndLinks()
    {
        var root=Path.Combine(Path.GetTempPath(),"SaymanPrivateFileUnit_"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
            Assert.Throws<InvalidOperationException>(()=>new DevelopmentPrivateFileStore(Path.Combine(root,"prod"),false));File.WriteAllText(Path.Combine(root,"unrelated.txt"),"Synthetic test only");Assert.Throws<InvalidOperationException>(()=>new DevelopmentPrivateFileStore(root,true));var directory=Path.Combine(root,"objects");var store=new DevelopmentPrivateFileStore(directory,true);var raw=Enumerable.Range(0,48).Select(i=>(byte)i).ToArray();Assert.True(await store.CreateAsync(Id,raw,default));Assert.False(await store.CreateAsync(Id,new byte[48],default));Assert.Equal(raw,await store.ReadAsync(Id,48,default));Assert.Empty(Directory.EnumerateFiles(directory,".upload-*"));
            if(!OperatingSystem.IsWindows()){Assert.Equal(UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute,File.GetUnixFileMode(directory));Assert.Equal(UnixFileMode.UserRead|UnixFileMode.UserWrite,File.GetUnixFileMode(Path.Combine(directory,Id+".bin")));var link=Path.Combine(directory,new string('c',32)+".bin");File.CreateSymbolicLink(link,Path.Combine(root,"unrelated.txt"));await Assert.ThrowsAsync<BusinessException>(()=>store.ReadAsync(new string('c',32),48,default));File.Delete(link);}
        }finally{Directory.Delete(root,true);}
    }
    [Theory][InlineData("stream: OK",null)][InlineData("stream: Eicar-Test-Signature FOUND","private_file_rejected")][InlineData("stream: INSTREAM size limit exceeded. ERROR","private_file_unavailable")][InlineData("OK","private_file_unavailable")]
    public async Task ActualTcpClamdProtocolFramesExactBytesAndFailsClosed(string reply,string? error)
    {
        using var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();var input=Document();using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(4));
        var server=Task.Run(async()=>{using var client=await listener.AcceptTcpClientAsync(deadline.Token);await using var stream=client.GetStream();var command=new byte[10];await stream.ReadExactlyAsync(command,deadline.Token);Assert.Equal("zINSTREAM\0",Encoding.ASCII.GetString(command));using var received=new MemoryStream();var size=new byte[4];while(true){await stream.ReadExactlyAsync(size,deadline.Token);var length=BinaryPrimitives.ReadInt32BigEndian(size);if(length==0)break;Assert.InRange(length,1,65536);var chunk=new byte[length];await stream.ReadExactlyAsync(chunk,deadline.Token);received.Write(chunk);}Assert.Equal(input,received.ToArray());await stream.WriteAsync(Encoding.UTF8.GetBytes(reply+'\0'),deadline.Token);},deadline.Token);
        var scanner=new ClamAvPrivateFileScanner(new("127.0.0.1",((IPEndPoint)listener.LocalEndpoint).Port));if(error is null)await scanner.ScanAsync(input,deadline.Token);else Assert.Equal(error,(await Assert.ThrowsAsync<BusinessException>(()=>scanner.ScanAsync(input,deadline.Token))).Code);await server;
    }
    [Fact]public async Task MissingScannerAndStorageAreUnavailableAndCallerCancellationIsPreserved()
    {
        var scanner=new ClamAvPrivateFileScanner(new(null));Assert.False(scanner.Configured);await Assert.ThrowsAsync<BusinessException>(()=>scanner.ScanAsync(Document(),default));var store=new DisabledPrivateFileStore();Assert.False(store.Configured);await Assert.ThrowsAsync<BusinessException>(()=>store.CreateAsync(Id,new byte[48],default));
        using var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();using var canceled=new CancellationTokenSource();canceled.Cancel();var configured=new ClamAvPrivateFileScanner(new("127.0.0.1",((IPEndPoint)listener.LocalEndpoint).Port));await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>configured.ScanAsync(Document(),canceled.Token));
    }
    [Fact]public async Task RequestAndDownloadSlotsAreIndependentBoundedAndDoubleDisposalCannotExpandCapacity()
    {
        var uploads=new PrivateFileReadSlots();var downloads=new PrivateFileDownloadSlots();using var first=await uploads.EnterAsync(default);using var second=await uploads.EnterAsync(default);await Assert.ThrowsAsync<BusinessException>(()=>uploads.EnterAsync(default));using var read=await downloads.EnterAsync(default);first.Dispose();first.Dispose();using var third=await uploads.EnterAsync(default);await Assert.ThrowsAsync<BusinessException>(()=>uploads.EnterAsync(default));
    }
    private sealed class CaptureS3():AmazonS3Client(new BasicAWSCredentials("synthetic","synthetic"),new AmazonS3Config{ServiceURL="http://127.0.0.1:1",ForcePathStyle=true})
    {
        public PutObjectRequest? Put;public GetObjectRequest? Get;public byte[] Bytes=[];public bool Existing;public bool WrongLength;
        public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request,CancellationToken ct){Put=request;if(Existing)throw new AmazonS3Exception("Synthetic conditional conflict"){StatusCode=HttpStatusCode.PreconditionFailed};using var output=new MemoryStream();await request.InputStream.CopyToAsync(output,ct);Bytes=output.ToArray();return new(){HttpStatusCode=HttpStatusCode.OK};}
        public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest request,CancellationToken ct){Get=request;return Task.FromResult(new GetObjectResponse{ContentLength=Bytes.Length+(WrongLength?1:0),ResponseStream=new MemoryStream(Bytes)});}
    }
    [Fact]public async Task S3SdkCaptureUsesOpaqueFixedPrivateKeyConditionalCreateAndExactBoundedCiphertext()
    {
        using var capture=new CaptureS3();var store=new S3PrivateFileStore(capture,"private-documents");var bytes=new byte[48];Assert.True(await store.CreateAsync(Id,bytes,default));Assert.Equal("private-documents",capture.Put!.BucketName);Assert.Equal("private-documents/v1/"+Id+".bin",capture.Put.Key);Assert.Equal("*",capture.Put.IfNoneMatch);Assert.Equal("application/octet-stream",capture.Put.ContentType);Assert.Equal(ChecksumAlgorithm.SHA256,capture.Put.ChecksumAlgorithm);Assert.Equal(bytes,await store.ReadAsync(Id,48,default));Assert.Equal(capture.Put.Key,capture.Get!.Key);capture.Existing=true;Assert.False(await store.CreateAsync(Id,new byte[48],default));capture.WrongLength=true;await Assert.ThrowsAsync<BusinessException>(()=>store.ReadAsync(Id,48,default));
    }
}
