using System.Security.Claims;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.Http.Features;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;

public static class PublicMediaEndpoints
{
    public static void AddPublicMedia(this WebApplicationBuilder builder)
    {
        builder.Services.AddScoped<PublicImageReconciler>();
        builder.Services.AddHostedService<PublicImageCleanupWorker>();
        // Resolve configuration after the host has applied all configuration sources.
        // In particular, test hosts must never inherit an operator's live media jobs.
        builder.Services.AddSingleton(s=>{var c=s.GetRequiredService<IConfiguration>();return new ClamAvOptions(c["Media:ClamAvHost"],c.GetValue("Media:ClamAvPort",3310),c.GetValue("Media:ScanTimeoutSeconds",10));});
        builder.Services.AddSingleton<IImageScanner,ClamAvScanner>();builder.Services.AddSingleton<IImageSanitizer,SkiaImageSanitizer>();builder.Services.AddSingleton<UploadSlots>();builder.Services.AddScoped<IPublicImageRepository,SqlPublicImageRepository>();builder.Services.AddScoped<PublicImageService>();
        builder.Services.AddSingleton<IAmazonS3>(s=>{var settings=S3Settings(s.GetRequiredService<IConfiguration>(),s.GetRequiredService<IHostEnvironment>());return new AmazonS3Client(new BasicAWSCredentials(settings.Key,settings.Secret),new AmazonS3Config{ServiceURL=settings.Endpoint,ForcePathStyle=true,AuthenticationRegion=settings.Region});});
        builder.Services.AddSingleton<IPublicImageStore>(s=>{
            var config=s.GetRequiredService<IConfiguration>();var environment=s.GetRequiredService<IHostEnvironment>();var mode=config["Media:Storage"]??"Disabled";
            if(mode=="Disabled")return new DisabledImageStore();
            if(mode=="Filesystem"){
                if(!environment.IsDevelopment())throw new InvalidOperationException("Filesystem image storage is unavailable outside Development.");
                var root=config["Media:Directory"]??throw new InvalidOperationException("Media__Directory is required for local storage.");return new DevelopmentImageStore(root,true);
            }
            if(mode=="S3"){var settings=S3Settings(config,environment);return new S3ImageStore(s.GetRequiredService<IAmazonS3>(),settings.Bucket);}
            throw new InvalidOperationException("Media__Storage must be Disabled, Filesystem or S3.");
        });
    }
    public static void ValidatePublicMedia(this WebApplication app)
    {
        var store=app.Services.GetRequiredService<IPublicImageStore>();
        if(app.Configuration.GetValue("Media:CleanupEnabled",false)&&!store.Configured)throw new InvalidOperationException("Configure image storage before enabling cleanup.");
    }
    private static (string Endpoint,string Bucket,string Key,string Secret,string Region) S3Settings(IConfiguration config,IHostEnvironment environment)
    {
        var endpoint=config["Media:S3:Endpoint"];var bucket=config["Media:S3:Bucket"];var key=config["Media:S3:AccessKey"];var secret=config["Media:S3:SecretKey"];var region=config["Media:S3:Region"]??"us-east-1";
        if(string.IsNullOrWhiteSpace(endpoint)||!Uri.TryCreate(endpoint,UriKind.Absolute,out var uri)||uri.UserInfo.Length>0||uri.Query.Length>0||uri.Fragment.Length>0||uri.AbsolutePath!="/"||uri.Scheme!="https"&&!(environment.IsDevelopment()&&uri.Scheme=="http")||string.IsNullOrWhiteSpace(bucket)||!System.Text.RegularExpressions.Regex.IsMatch(bucket,"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")||string.IsNullOrWhiteSpace(key)||string.IsNullOrWhiteSpace(secret)||string.IsNullOrWhiteSpace(region))throw new InvalidOperationException("Configure an S3 endpoint, bucket, region and credentials; production requires HTTPS.");
        return (endpoint,bucket,key,secret,region);
    }
    public static void MapPublicMedia(this WebApplication app,string[] adminOrigins)
    {
        // This group owns its durable upload actor/status trail in Catalog's transaction.
        // It never accepts credit documents or original public-file paths.
        var admin=app.MapGroup("/api/admin/media").RequireAuthorization("staff_mfa","public_media.write");
        admin.MapGet("/capabilities",(PublicImageService service)=>Results.Ok(new{Configured=service.Configured,MaxBytes=ImageLimits.MaxInputBytes,MaxPixels=ImageLimits.MaxPixels,MaxEdge=ImageLimits.MaxEdge,ContentTypes=ImageLimits.ContentTypes,PublicImagesOnly=true}));
        admin.MapPost("/images",async(HttpContext http,PublicImageService service,UploadSlots slots,CancellationToken ct)=>{
            var origin=http.Request.Headers.Origin.ToString();if(origin.Length>0&&!adminOrigins.Contains(origin,StringComparer.Ordinal))throw new BusinessException("invalid_media_origin","Use the approved admin origin.");
            using var slot=await slots.TryEnterAsync(ct);if(slot is null){http.Response.Headers.RetryAfter="2";return Results.Problem(statusCode:429,title:"media_busy",detail:"Image processing is busy. Retry shortly.");}
            var max=http.Features.Get<IHttpMaxRequestBodySizeFeature>();if(max is {IsReadOnly:false})max.MaxRequestBodySize=ImageLimits.MaxRequestBytes;
            if(http.Request.ContentLength>ImageLimits.MaxRequestBytes)throw new BusinessException("image_too_large","Choose an image up to eight MiB.");
            if(!http.Request.HasFormContentType)throw new BusinessException("invalid_image","Send one JPEG, PNG or WebP file as multipart form data.");
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(40));
            try{
            var options=new FormOptions{MemoryBufferThreshold=ImageLimits.MaxRequestBytes,MultipartBodyLengthLimit=ImageLimits.MaxRequestBytes,ValueCountLimit=4,ValueLengthLimit=2048,KeyLengthLimit=64,MultipartHeadersCountLimit=16,MultipartHeadersLengthLimit=4096};
            http.Features.Set<IFormFeature>(new FormFeature(http.Request,options));
            IFormCollection form;try{form=await http.Request.ReadFormAsync(timeout.Token);}catch(BadHttpRequestException e)when(e.StatusCode==413){throw new BusinessException("image_too_large","Choose an image up to eight MiB.");}catch(InvalidDataException){throw new BusinessException("invalid_image","The multipart image request is invalid or too large.");}
            if(form.Files.Count!=1||form.Count!=0||form.Files[0].Name!="file")throw new BusinessException("invalid_image","Send exactly one image file.");
            var file=form.Files[0];if(file.Length is <1 or >ImageLimits.MaxInputBytes)throw new BusinessException("image_too_large","Choose an image up to eight MiB.");
            await using var stream=file.OpenReadStream();var bytes=await BoundedImageRead.ReadAsync(stream,checked((int)file.Length),timeout.Token);
            var result=await service.UploadAsync(bytes,file.FileName,file.ContentType,http.User.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","User identity is missing."),timeout.Token);
            return Results.Ok(result);
            }catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw new BusinessException("media_unavailable","Image processing timed out. Retry shortly.");}
        }).RequireRateLimiting("media-upload");
        app.MapGet("/api/media/catalog/{id}/{file}",async(string id,string file,PublicImageService service,HttpContext http,CancellationToken ct)=>{
            if(!file.EndsWith(".webp",StringComparison.Ordinal))return Results.NotFound();var name=file[..^5];try{PublicImagePaths.Validate(id,name);}catch(BusinessException){return Results.NotFound();}
            var result=await service.ReadAsync(id,name,ct);if(result is null)return Results.NotFound();
            http.Response.Headers.CacheControl="public, max-age=31536000, immutable";http.Response.Headers["X-Shop-Public-Resource"]="catalog-image-v1";http.Response.Headers["Content-Security-Policy"]="default-src 'none'; sandbox";
            return Results.File(result.Value.Bytes,"image/webp",enableRangeProcessing:false,entityTag:new Microsoft.Net.Http.Headers.EntityTagHeaderValue('"'+result.Value.Sha256+'"'));
        }).AllowAnonymous();
    }
}
