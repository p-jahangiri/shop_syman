using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
namespace Shop.Modules.Files;

public interface IPrivateFileStore
{
    bool Configured{get;}
    Task<bool> CreateAsync(string id,byte[] encrypted,CancellationToken ct);
    Task<byte[]?> ReadAsync(string id,int expectedBytes,CancellationToken ct);
}
public sealed class DisabledPrivateFileStore:IPrivateFileStore
{
    public bool Configured=>false;
    public Task<bool> CreateAsync(string id,byte[] encrypted,CancellationToken ct)=>throw PrivateFileRules.Unavailable();
    public Task<byte[]?> ReadAsync(string id,int expectedBytes,CancellationToken ct)=>throw PrivateFileRules.Unavailable();
}
public static class PrivateFileRead
{
    public static void Length(int bytes){if(bytes is <48 or >PrivateFileRules.MaxBytes+PrivateFileRules.EnvelopeOverhead)throw PrivateFileRules.Unavailable();}
    public static async Task<byte[]> BoundedAsync(Stream input,int expectedBytes,CancellationToken ct)
    {
        Length(expectedBytes);using var output=new MemoryStream(expectedBytes);var buffer=new byte[65536];while(true){var n=await input.ReadAsync(buffer,ct);if(n==0)break;if(output.Length+n>expectedBytes)throw PrivateFileRules.Unavailable();await output.WriteAsync(buffer.AsMemory(0,n),ct);}if(output.Length!=expectedBytes)throw PrivateFileRules.Unavailable();return output.ToArray();
    }
}
public sealed class DevelopmentPrivateFileStore:IPrivateFileStore
{
    private readonly string root;
    public DevelopmentPrivateFileStore(string directory,bool development)
    {
        if(!development)throw new InvalidOperationException("Filesystem private documents are restricted to Development.");root=Path.GetFullPath(directory);if(root==Path.GetPathRoot(root)||new DirectoryInfo(root).LinkTarget is not null)throw new InvalidOperationException("Use a dedicated private document directory without links.");
        var marker=Path.Combine(root,".sayman-private-files-v1");if(Directory.Exists(root)&&Directory.EnumerateFileSystemEntries(root).Any()&&(!File.Exists(marker)||new FileInfo(marker).LinkTarget is not null||File.ReadAllText(marker)!="Sayman private documents v1"))throw new InvalidOperationException("Existing unrelated directories cannot store private documents.");
        Directory.CreateDirectory(root);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(root,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);if(!File.Exists(marker)){File.WriteAllText(marker,"Sayman private documents v1");if(!OperatingSystem.IsWindows())File.SetUnixFileMode(marker,UnixFileMode.UserRead|UnixFileMode.UserWrite);}
    }
    public bool Configured=>true;
    private string PathFor(string id){PrivateFileRules.Id(id);var path=Path.Combine(root,id+".bin");if(new FileInfo(path).LinkTarget is not null)throw PrivateFileRules.Unavailable();return path;}
    public async Task<bool> CreateAsync(string id,byte[] encrypted,CancellationToken ct)
    {
        PrivateFileRead.Length(encrypted.Length);var path=PathFor(id);var temporary=Path.Combine(root,".upload-"+Guid.NewGuid().ToString("N"));
        try{
            await using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,FileOptions.Asynchronous)){if(!OperatingSystem.IsWindows())File.SetUnixFileMode(temporary,UnixFileMode.UserRead|UnixFileMode.UserWrite);await stream.WriteAsync(encrypted,ct);await stream.FlushAsync(ct);}
            ct.ThrowIfCancellationRequested();try{File.Move(temporary,path,false);return true;}catch(IOException)when(File.Exists(path)){return false;}
        }finally{File.Delete(temporary);}
    }
    public async Task<byte[]?> ReadAsync(string id,int expectedBytes,CancellationToken ct)
    {
        PrivateFileRead.Length(expectedBytes);try{await using var stream=new FileStream(PathFor(id),FileMode.Open,FileAccess.Read,FileShare.Read,65536,FileOptions.Asynchronous);return await PrivateFileRead.BoundedAsync(stream,expectedBytes,ct);}catch(FileNotFoundException){return null;}
    }
}
public sealed class S3PrivateFileStore(IAmazonS3 client,string bucket,bool ownsClient=false):IPrivateFileStore,IDisposable
{
    public bool Configured=>true;
    public void Dispose(){if(ownsClient)client.Dispose();}
    public async Task<bool> CreateAsync(string id,byte[] encrypted,CancellationToken ct)
    {
        PrivateFileRead.Length(encrypted.Length);var key=PrivateFileRules.Key(id);using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try{await using var stream=new MemoryStream(encrypted,false);await client.PutObjectAsync(new PutObjectRequest{BucketName=bucket,Key=key,InputStream=stream,ContentType="application/octet-stream",IfNoneMatch="*",ChecksumAlgorithm=ChecksumAlgorithm.SHA256,AutoCloseStream=false},timeout.Token);return true;}
        catch(AmazonS3Exception e)when(e.StatusCode==HttpStatusCode.PreconditionFailed){return false;}
        catch(Exception e)when(e is AmazonServiceException or HttpRequestException){throw PrivateFileRules.Unavailable();}
        catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw PrivateFileRules.Unavailable();}
    }
    public async Task<byte[]?> ReadAsync(string id,int expectedBytes,CancellationToken ct)
    {
        PrivateFileRead.Length(expectedBytes);var key=PrivateFileRules.Key(id);using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try{using var response=await client.GetObjectAsync(new GetObjectRequest{BucketName=bucket,Key=key},timeout.Token);if(response.ContentLength!=expectedBytes)throw PrivateFileRules.Unavailable();return await PrivateFileRead.BoundedAsync(response.ResponseStream,expectedBytes,timeout.Token);}
        catch(AmazonS3Exception e)when(e.StatusCode==HttpStatusCode.NotFound){return null;}
        catch(Exception e)when(e is AmazonServiceException or HttpRequestException or IOException){throw PrivateFileRules.Unavailable();}
        catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw PrivateFileRules.Unavailable();}
    }
}
