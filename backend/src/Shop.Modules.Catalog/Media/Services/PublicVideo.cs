using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public static partial class PublicVideoPaths
{
    public static string Url(string id, string extension)
    {
        Validate(id, extension);
        return $"/media/videos/{id}/clip.{extension}";
    }
    public static string Key(string id, string extension)
    {
        Validate(id, extension);
        return $"catalog-videos/{id}/clip.{extension}";
    }
    public static void Validate(string id, string extension)
    {
        if (!Id().IsMatch(id) || extension is not ("mp4" or "webm"))
            throw new BusinessException("invalid_video_path", "Use an issued video path.");
    }
    public static bool TryParse(string path, out string id, out string extension)
    {
        var match = Path().Match(path);
        id = match.Groups[1].Value;
        extension = match.Groups[2].Value;
        return match.Success;
    }
    public static bool ValidUrl(string url) => url is { Length: > 0 and <= 1500 } && !url.Any(c => char.IsControl(c) || char.IsWhiteSpace(c)) && !url.Contains('\\') && (TryParse(url, out _, out _) || Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.UserInfo.Length == 0 && uri.Fragment.Length == 0 && !uri.IsLoopback && (uri.AbsolutePath.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath.EndsWith(".webm", StringComparison.OrdinalIgnoreCase)));
    [GeneratedRegex("\\A[a-f0-9]{32}\\z", RegexOptions.CultureInvariant)] private static partial Regex Id();
    [GeneratedRegex("\\A/media/videos/([a-f0-9]{32})/clip\\.(mp4|webm)\\z", RegexOptions.CultureInvariant)] private static partial Regex Path();
}
public static class VideoLimits
{
    public const int MaxInputBytes = 32 * 1024 * 1024, MaxOutputBytes = 40 * 1024 * 1024, MaxRequestBytes = MaxInputBytes + 65536, MaxSeconds = 600;
    public static readonly string[] ContentTypes = ["video/mp4", "video/webm"];
    public static string Extension(byte[] bytes, string filename, string contentType)
    {
        if (bytes.Length is < 12 or > MaxInputBytes)
            throw new BusinessException("video_too_large", "Choose a video up to32MiB.");
        var extension = System.IO.Path.GetExtension(filename).ToLowerInvariant();
        var mp4 = bytes.AsSpan(4, 4).SequenceEqual("ftyp"u8);
        var webm = bytes.AsSpan(0, 4).SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 });
        if (extension == ".mp4" && contentType == "video/mp4" && mp4)
            return "mp4";
        if (extension == ".webm" && contentType == "video/webm" && webm)
            return "webm";
        throw new BusinessException("invalid_video", "Choose an MP4 or WebM with its matching type.");
    }
}
public sealed class PublicVideoAsset
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N"); public string CreatedBy { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; public string Status { get; set; } = "Staged"; public string Extension { get; set; } = ""; public string Sha256 { get; set; } = ""; public int Bytes
    {
        get; set;
    }
    public int InputBytes
    {
        get; set;
    }
    public int Width
    {
        get; set;
    }
    public int Height
    {
        get; set;
    }
    public int DurationMilliseconds
    {
        get; set;
    }
    public byte[] Version { get; set; } = [];
}
public record PublicVideoDto(string Id, string Url, string ContentType, int Bytes, int Width, int Height, int DurationMilliseconds);
public record SanitizedVideo(byte[] Bytes, string Extension, string Sha256, int Width, int Height, int DurationMilliseconds);
public interface IVideoSanitizer
{
    bool Configured
    {
        get;
    }
    Task<SanitizedVideo> SanitizeAsync(byte[] bytes, string extension, CancellationToken ct);
}
public interface IPublicVideoStore
{
    bool Configured
    {
        get;
    }
    Task PutAsync(string id, SanitizedVideo video, CancellationToken ct); Task<byte[]?> ReadAsync(string id, string extension, int bytes, CancellationToken ct); Task DeleteAsync(string id, string extension, CancellationToken ct);
}
public static class PublicVideoModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<PublicVideoAsset>(e => { e.ToTable("PublicVideos", t => { t.HasCheckConstraint("CK_PublicVideo_Status", "[Status] IN ('Staged','Ready','Failed')"); t.HasCheckConstraint("CK_PublicVideo_Extension", "[Extension] IN ('mp4','webm')"); t.HasCheckConstraint("CK_PublicVideo_Size", "[InputBytes] > 0 AND [InputBytes] <= 33554432 AND [Bytes] > 0 AND [Bytes] <= 41943040 AND [Width] > 0 AND [Width] <= 4096 AND [Height] > 0 AND [Height] <= 4096 AND [DurationMilliseconds] > 0 AND [DurationMilliseconds] <= 600000"); }); e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32); e.Property(x => x.CreatedBy).HasMaxLength(64); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Extension).HasMaxLength(4); e.Property(x => x.Sha256).HasMaxLength(64); e.Property(x => x.Version).IsRowVersion(); e.HasIndex(x => new { x.Status, x.CreatedAt }); });
    }
}
public sealed class PublicVideoService(CatalogDbContext db, IPublicVideoStore store, IImageScanner scanner, IVideoSanitizer sanitizer)
{
    public bool Configured => store.Configured && scanner.Configured && sanitizer.Configured;
    public async Task<PublicVideoDto> UploadAsync(byte[] input, string filename, string contentType, string actor, CancellationToken ct)
    {
        var extension = VideoLimits.Extension(input, filename, contentType);
        if (!Configured)
            throw new BusinessException("media_unavailable", "Video storage, scanning and processing must be configured.");
        await scanner.ScanAsync(input, ct);
        var video = await sanitizer.SanitizeAsync(input, extension, ct);
        await scanner.ScanAsync(video.Bytes, ct);
        var asset = new PublicVideoAsset { CreatedBy = actor, Extension = extension, Sha256 = video.Sha256, InputBytes = input.Length, Bytes = video.Bytes.Length, Width = video.Width, Height = video.Height, DurationMilliseconds = video.DurationMilliseconds };
        db.Add(asset);
        await db.SaveChangesAsync(ct);
        var readyAttempted = false;
        try
        {
            await store.PutAsync(asset.Id, video, ct);
            asset.Status = "Ready";
            readyAttempted = true;
            await db.SaveChangesAsync(ct);
            return new(asset.Id, PublicVideoPaths.Url(asset.Id, extension), extension == "mp4" ? "video/mp4" : "video/webm", asset.Bytes, asset.Width, asset.Height, asset.DurationMilliseconds);
        }
        catch { if (!readyAttempted) { using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(8)); try { await store.DeleteAsync(asset.Id, extension, cleanup.Token); asset.Status = "Failed"; await db.SaveChangesAsync(cleanup.Token); } catch (Exception e) when (e is IOException or OperationCanceledException or BusinessException) {/* Staged rows are never public. */} } throw; }
    }
    public async Task<(byte[] Bytes, string Sha256, string ContentType)?> ReadAsync(string id, string extension, CancellationToken ct)
    {
        PublicVideoPaths.Validate(id, extension);
        var asset = await db.Set<PublicVideoAsset>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == id && a.Extension == extension && a.Status == "Ready", ct);
        if (asset is null)
            return null;
        var bytes = await store.ReadAsync(id, extension, asset.Bytes, ct);
        if (bytes is null)
            return null;
        if (bytes.Length != asset.Bytes || Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes)) != asset.Sha256)
            throw new BusinessException("media_unavailable", "Video integrity could not be verified.");
        return (bytes, asset.Sha256, extension == "mp4" ? "video/mp4" : "video/webm");
    }
}

// Keep whole-object integrity verification bounded even when clients request ranges.
public sealed class VideoDownloadSlots
{
    private readonly SemaphoreSlim slots = new(4, 4);
    public async Task<IDisposable?> TryEnterAsync(CancellationToken ct) => await slots.WaitAsync(0, ct) ? new Lease(slots) : null;
    private sealed class Lease(SemaphoreSlim slots) : IDisposable
    {
        private int disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0)
                slots.Release();
        }
    }
}
