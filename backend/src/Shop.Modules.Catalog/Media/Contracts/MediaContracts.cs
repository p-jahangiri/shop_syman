using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public static partial class PublicImagePaths
{
    public static readonly string[] Names=["thumb","card","zoom"];
    public static string Url(string id,string name){Validate(id,name);return $"/media/catalog/{id}/{name}.webp";}
    public static string Key(string id,string name){Validate(id,name);return $"catalog-images/{id}/{name}.webp";}
    public static void Validate(string id,string name){if(!IdPattern().IsMatch(id)||!Names.Contains(name,StringComparer.Ordinal))throw new BusinessException("invalid_media_path","Use an issued public catalogue image path.");}
    public static bool TryParse(string path,out string id,out string name){var match=PathPattern().Match(path);id=match.Groups[1].Value;name=match.Groups[2].Value;return match.Success;}
    [GeneratedRegex("\\A[a-f0-9]{32}\\z",RegexOptions.CultureInvariant)]private static partial Regex IdPattern();
    [GeneratedRegex("\\A/media/catalog/([a-f0-9]{32})/(thumb|card|zoom)\\.webp\\z",RegexOptions.CultureInvariant)]private static partial Regex PathPattern();
}
public static class ImageLimits
{
    public const int MaxInputBytes=8*1024*1024;
    public const int MaxRequestBytes=MaxInputBytes+65536;
    public const int MaxPixels=12_000_000;
    public const int MaxEdge=8192;
    public const int MaxOutputBytes=8*1024*1024;
    public static readonly string[] ContentTypes=["image/jpeg","image/png","image/webp"];
}
public record SanitizedVariant(string Name,int Width,int Height,byte[] Bytes,string Sha256);
public record SanitizedImage(int Width,int Height,string OriginalSha256,SanitizedVariant[] Variants);
public record PublicImageVariantDto(string Name,string Url,int Width,int Height,int Bytes,string Sha256);
public record PublicImageDto(string Id,string Url,PublicImageVariantDto[] Variants);
public interface IImageSanitizer { SanitizedImage Sanitize(byte[] input,string filename,string contentType,CancellationToken ct); }
public interface IImageScanner {bool Configured{get;} Task ScanAsync(ReadOnlyMemory<byte> input,CancellationToken ct);}
public interface IPublicImageStore
{
    bool Configured{get;}
    Task PutAsync(string id,SanitizedVariant variant,CancellationToken ct);
    Task<byte[]?> ReadAsync(string id,string name,int expectedBytes,CancellationToken ct);
    Task DeleteAsync(string id,string name,CancellationToken ct);
}
public interface IPublicImageRepository
{
    Task StageAsync(PublicImageAsset asset,CancellationToken ct);
    Task ReadyAsync(PublicImageAsset asset,SanitizedImage image,CancellationToken ct);
    Task FailAsync(PublicImageAsset asset,CancellationToken ct);
    Task<PublicImageAsset?> FindReadyAsync(string id,CancellationToken ct);
}
public sealed class PublicImageAsset
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string CreatedBy{get;set;}="";
    public DateTimeOffset CreatedAt{get;set;}=DateTimeOffset.UtcNow;
    public string Status{get;set;}="Staged";
    public string? CleanupLeaseId{get;set;}
    public DateTimeOffset? CleanupLeaseExpiresAt{get;set;}
    public DateTimeOffset? LastCleanupAt{get;set;}
    public string OriginalSha256{get;set;}="";
    public int InputBytes{get;set;}
    public int Width{get;set;}
    public int Height{get;set;}
    public byte[] Version{get;set;}=[];
    public List<PublicImageVariant> Variants{get;set;}=[];
}
public sealed class PublicImageVariant
{
    public string AssetId{get;set;}="";
    public string Name{get;set;}="";
    public int Width{get;set;}
    public int Height{get;set;}
    public int Bytes{get;set;}
    public string Sha256{get;set;}="";
}
public sealed class UploadSlots
{
    private readonly SemaphoreSlim slots=new(2,2);
    public async Task<IDisposable?> TryEnterAsync(CancellationToken ct)=>await slots.WaitAsync(0,ct)?new Lease(slots):null;
    private sealed class Lease(SemaphoreSlim slots):IDisposable{private int disposed;public void Dispose(){if(Interlocked.Exchange(ref disposed,1)==0)slots.Release();}}
}
