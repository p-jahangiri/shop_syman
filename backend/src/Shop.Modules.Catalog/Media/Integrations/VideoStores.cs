using Amazon.S3;
using Amazon.S3.Model;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Media;

public sealed class DisabledVideoStore : IPublicVideoStore
{
    public bool Configured => false; public Task PutAsync(string id, SanitizedVideo video, CancellationToken ct) => throw new BusinessException("media_unavailable", "Video storage is unavailable."); public Task<byte[]?> ReadAsync(string id, string extension, int bytes, CancellationToken ct) => Task.FromResult<byte[]?>(null); public Task DeleteAsync(string id, string extension, CancellationToken ct) => Task.CompletedTask;
}
public sealed class DevelopmentVideoStore : IPublicVideoStore
{
    private readonly string root; public DevelopmentVideoStore(string root, bool development)
    {
        if (!development)
            throw new InvalidOperationException("Filesystem videos are restricted to Development.");
        this.root = System.IO.Path.GetFullPath(root);
        Directory.CreateDirectory(this.root);
    }
    public bool Configured => true; private string PathFor(string id, string extension) => System.IO.Path.Combine(root, PublicVideoPaths.Key(id, extension));
    public async Task PutAsync(string id, SanitizedVideo video, CancellationToken ct)
    {
        var path = PathFor(id, video.Extension);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous);
        await file.WriteAsync(video.Bytes, ct);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
    public async Task<byte[]?> ReadAsync(string id, string extension, int bytes, CancellationToken ct)
    {
        try
        {
            await using var file = new FileStream(PathFor(id, extension), FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
            return await BoundedVideoRead.ReadAsync(file, bytes, ct);
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
    public Task DeleteAsync(string id, string extension, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        File.Delete(PathFor(id, extension));
        return Task.CompletedTask;
    }
}
public sealed class S3VideoStore(IAmazonS3 client, string bucket) : IPublicVideoStore
{
    public bool Configured => true;
    public async Task PutAsync(string id, SanitizedVideo video, CancellationToken ct)
    {
        await using var data = new MemoryStream(video.Bytes, false);
        await client.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = PublicVideoPaths.Key(id, video.Extension), InputStream = data, ContentType = video.Extension == "mp4" ? "video/mp4" : "video/webm", AutoCloseStream = false, ChecksumAlgorithm = ChecksumAlgorithm.SHA256 }, ct);
    }
    public async Task<byte[]?> ReadAsync(string id, string extension, int bytes, CancellationToken ct)
    {
        try
        {
            using var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = PublicVideoPaths.Key(id, extension) }, ct);
            if (response.ContentLength != bytes)
                throw new BusinessException("media_unavailable", "Video length changed.");
            return await BoundedVideoRead.ReadAsync(response.ResponseStream, bytes, ct);
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound) { return null; }
    }
    public Task DeleteAsync(string id, string extension, CancellationToken ct) => client.DeleteObjectAsync(new DeleteObjectRequest { BucketName = bucket, Key = PublicVideoPaths.Key(id, extension) }, ct);
}
public static class BoundedVideoRead
{
    public static async Task<byte[]> ReadAsync(Stream stream, int expected, CancellationToken ct)
    {
        if (expected is < 1 or > VideoLimits.MaxOutputBytes)
            throw new BusinessException("media_unavailable", "Invalid video length.");
        using var output = new MemoryStream(expected);
        var buffer = new byte[65536];
        while (true)
        {
            var count = await stream.ReadAsync(buffer, ct);
            if (count == 0)
                break;
            if (output.Length + count > expected)
                throw new BusinessException("media_unavailable", "Invalid video length.");
            await output.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        if (output.Length != expected)
            throw new BusinessException("media_unavailable", "Incomplete video.");
        return output.ToArray();
    }
}
