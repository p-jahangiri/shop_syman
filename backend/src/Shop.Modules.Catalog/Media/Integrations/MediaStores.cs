using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed class DisabledImageStore:IPublicImageStore
{
    public bool Configured=>false;
    public Task PutAsync(string id,SanitizedVariant variant,CancellationToken ct)=>throw new BusinessException("media_unavailable","Image storage is not configured.");
    public Task<byte[]?> ReadAsync(string id,string name,int expectedBytes,CancellationToken ct)=>Task.FromResult<byte[]?>(null);
    public Task DeleteAsync(string id,string name,CancellationToken ct)=>Task.CompletedTask;
}
public sealed class DevelopmentImageStore:IPublicImageStore
{
    private readonly string root;
    public DevelopmentImageStore(string root,bool isDevelopment){if(!isDevelopment)throw new InvalidOperationException("Filesystem image storage is restricted to Development.");this.root=Path.GetFullPath(root);Directory.CreateDirectory(this.root);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(this.root,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);}
    public bool Configured=>true;
    private string PathFor(string id,string name)=>Path.Combine(root,PublicImagePaths.Key(id,name).Replace('/',Path.DirectorySeparatorChar));
    public async Task PutAsync(string id,SanitizedVariant variant,CancellationToken ct){var target=PathFor(id,variant.Name);Directory.CreateDirectory(Path.GetDirectoryName(target)!);await using var file=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,FileOptions.Asynchronous);await file.WriteAsync(variant.Bytes,ct);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(target,UnixFileMode.UserRead|UnixFileMode.UserWrite);}
    public async Task<byte[]?> ReadAsync(string id,string name,int expectedBytes,CancellationToken ct){var path=PathFor(id,name);try{await using var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,65536,FileOptions.Asynchronous);return await BoundedImageRead.ReadAsync(file,expectedBytes,ct);}catch(FileNotFoundException){return null;}catch(DirectoryNotFoundException){return null;}}
    public Task DeleteAsync(string id,string name,CancellationToken ct){ct.ThrowIfCancellationRequested();File.Delete(PathFor(id,name));return Task.CompletedTask;}
}
public sealed class S3ImageStore(IAmazonS3 client,string bucket):IPublicImageStore
{
    public bool Configured=>true;
    public async Task PutAsync(string id,SanitizedVariant variant,CancellationToken ct){
        await using var data=new MemoryStream(variant.Bytes,false);
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try{await client.PutObjectAsync(new PutObjectRequest{BucketName=bucket,Key=PublicImagePaths.Key(id,variant.Name),InputStream=data,ContentType="image/webp",AutoCloseStream=false,ChecksumAlgorithm=ChecksumAlgorithm.SHA256},timeout.Token);}
        catch(AmazonServiceException){throw Unavailable();}catch(HttpRequestException){throw Unavailable();}catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw Unavailable();}
    }
    public async Task<byte[]?> ReadAsync(string id,string name,int expectedBytes,CancellationToken ct){
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try{using var response=await client.GetObjectAsync(new GetObjectRequest{BucketName=bucket,Key=PublicImagePaths.Key(id,name)},timeout.Token);if(response.ContentLength!=expectedBytes)throw Unavailable();return await BoundedImageRead.ReadAsync(response.ResponseStream,expectedBytes,timeout.Token);}
        catch(AmazonS3Exception e)when(e.StatusCode==HttpStatusCode.NotFound){return null;}catch(AmazonServiceException){throw Unavailable();}catch(HttpRequestException){throw Unavailable();}catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw Unavailable();}
    }
    public async Task DeleteAsync(string id,string name,CancellationToken ct){await client.DeleteObjectAsync(new DeleteObjectRequest{BucketName=bucket,Key=PublicImagePaths.Key(id,name)},ct);}
    private static BusinessException Unavailable()=>new("media_unavailable","Image storage is unavailable.");
}
public static class BoundedImageRead
{
    public static async Task<byte[]> ReadAsync(Stream stream,int expectedBytes,CancellationToken ct){if(expectedBytes is <1 or >ImageLimits.MaxOutputBytes)throw new BusinessException("media_unavailable","Unexpected image length.");using var output=new MemoryStream(expectedBytes);var buffer=new byte[65536];while(true){var count=await stream.ReadAsync(buffer,ct);if(count==0)break;if(output.Length+count>expectedBytes)throw new BusinessException("media_unavailable","Unexpected image length.");await output.WriteAsync(buffer.AsMemory(0,count),ct);}if(output.Length!=expectedBytes)throw new BusinessException("media_unavailable","The image was incomplete.");return output.ToArray();}
}
