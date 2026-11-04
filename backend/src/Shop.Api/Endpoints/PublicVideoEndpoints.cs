using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;

public static class PublicVideoEndpoints
{
    public static void AddPublicVideos(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton(s => { var c = s.GetRequiredService<IConfiguration>(); return new VideoToolOptions(c["Media:Video:FfmpegPath"], c["Media:Video:FfprobePath"], c.GetValue("Media:Video:TimeoutSeconds", 90)); });
        builder.Services.AddSingleton<IVideoSanitizer, FfmpegVideoSanitizer>();
        builder.Services.AddScoped<PublicVideoService>();
        builder.Services.AddSingleton<VideoDownloadSlots>();
        builder.Services.AddSingleton<IPublicVideoStore>(s => { var c = s.GetRequiredService<IConfiguration>(); var environment = s.GetRequiredService<IHostEnvironment>(); return (c["Media:Storage"] ?? "Disabled") switch { "Disabled" => new DisabledVideoStore(), "Filesystem" => new DevelopmentVideoStore(c["Media:Directory"] ?? throw new InvalidOperationException("Configure the media directory."), environment.IsDevelopment()), "S3" => new S3VideoStore(s.GetRequiredService<Amazon.S3.IAmazonS3>(), c["Media:S3:Bucket"] ?? throw new InvalidOperationException("Configure the media bucket.")), _ => throw new InvalidOperationException("Configure a supported media store.") }; });
    }
    public static void MapPublicVideos(this WebApplication app, string[] origins)
    {
        var admin = app.MapGroup("/api/admin/media/videos").RequireAuthorization("staff_mfa", "public_media.write");
        admin.MapGet("/capabilities", (PublicVideoService service) => Results.Ok(new { Configured = service.Configured, MaxBytes = VideoLimits.MaxInputBytes, MaxDurationSeconds = VideoLimits.MaxSeconds, ContentTypes = VideoLimits.ContentTypes }));
        admin.MapPost("", async (HttpContext http, PublicVideoService service, UploadSlots slots, CancellationToken ct) =>
        {
            if (!origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal) || http.Request.Headers["X-Sayman-Client"] != "admin")
                return Results.StatusCode(403);
            using var slot = await slots.TryEnterAsync(ct);
            if (slot is null)
            {
                http.Response.Headers.RetryAfter = "2";
                return Results.Problem(statusCode: 429, title: "media_busy");
            }
            var max = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (max is { IsReadOnly: false })
                max.MaxRequestBodySize = VideoLimits.MaxRequestBytes;
            if (http.Request.ContentLength > VideoLimits.MaxRequestBytes)
                throw new BusinessException("video_too_large", "Choose a video up to32MiB.");
            if (!http.Request.HasFormContentType)
                throw new BusinessException("invalid_video", "Send exactly one MP4/WebM file.");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            try
            {
                var options = new FormOptions { MemoryBufferThreshold = 65536, MultipartBodyLengthLimit = VideoLimits.MaxRequestBytes, ValueCountLimit = 1, ValueLengthLimit = 1024, KeyLengthLimit = 64, MultipartHeadersCountLimit = 16, MultipartHeadersLengthLimit = 4096 };
                http.Features.Set<IFormFeature>(new FormFeature(http.Request, options));
                IFormCollection form;
                try
                {
                    form = await http.Request.ReadFormAsync(timeout.Token);
                }
                catch (Exception e) when (e is InvalidDataException or BadHttpRequestException) { throw new BusinessException("invalid_video", "The multipart video is invalid or too large."); }
                if (form.Count != 0 || form.Files.Count != 1 || form.Files[0].Name != "file")
                    throw new BusinessException("invalid_video", "Send exactly one video file.");
                var file = form.Files[0];
                if (file.Length is < 12 or > VideoLimits.MaxInputBytes)
                    throw new BusinessException("video_too_large", "Choose a video up to32MiB.");
                await using var stream = file.OpenReadStream();
                var bytes = await BoundedVideoRead.ReadAsync(stream, checked((int)file.Length), timeout.Token);
                return Results.Ok(await service.UploadAsync(bytes, file.FileName, file.ContentType, http.User.FindFirstValue("sub") ?? throw new BusinessException("invalid_credentials", "Missing actor."), timeout.Token));
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new BusinessException("media_unavailable", "Video processing timed out."); }
        }).RequireRateLimiting("media-upload");
        app.MapGet("/api/media/videos/{id}/{file}", async (string id, string file, PublicVideoService service, VideoDownloadSlots slots, HttpContext http, CancellationToken ct) =>
        {
            var extension = file == "clip.mp4" ? "mp4" : file == "clip.webm" ? "webm" : null;
            if (extension is null)
                return Results.NotFound();
            try
            {
                PublicVideoPaths.Validate(id, extension);
            }
            catch (BusinessException) { return Results.NotFound(); }
            var lease = await slots.TryEnterAsync(ct);
            if (lease is null)
            {
                http.Response.Headers.RetryAfter = "2";
                return Results.Problem(statusCode: 429, title: "media_busy");
            }
            try
            {
                var result = await service.ReadAsync(id, extension, ct);
                if (result is null)
                {
                    lease.Dispose();
                    return Results.NotFound();
                }
                http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
                http.Response.Headers["X-Shop-Public-Resource"] = "catalog-video-v1";
                http.Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
                return new LeasedVideoResult(Results.File(result.Value.Bytes, result.Value.ContentType, enableRangeProcessing: true, entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue('"' + result.Value.Sha256 + '"')), lease);
            }
            catch { lease.Dispose(); throw; }
        }).AllowAnonymous();
    }
    private sealed class LeasedVideoResult(IResult result, IDisposable lease) : IResult
    {
        public async Task ExecuteAsync(HttpContext context)
        {
            try
            {
                await result.ExecuteAsync(context);
            }
            finally { lease.Dispose(); }
        }
    }
}
