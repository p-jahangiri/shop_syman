using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed class PublicImageService(IPublicImageRepository repository,IPublicImageStore store,IImageScanner scanner,IImageSanitizer sanitizer,ILogger<PublicImageService> logger)
{
    public bool Configured=>store.Configured&&scanner.Configured;
    public async Task<PublicImageDto> UploadAsync(byte[] input,string filename,string contentType,string actorId,CancellationToken ct)
    {
        ImageEnvelope.Validate(input,filename,contentType);
        if(!Configured)throw new BusinessException("media_unavailable","Image storage and malware scanning must be configured before upload.");
        if(input.Length is 0 or > ImageLimits.MaxInputBytes)throw new BusinessException("image_too_large","Choose an image up to eight MiB.");
        await scanner.ScanAsync(input,ct);
        var image=sanitizer.Sanitize(input,filename,contentType,ct);
        var asset=new PublicImageAsset{CreatedBy=actorId,OriginalSha256=image.OriginalSha256,InputBytes=input.Length,Width=image.Width,Height=image.Height};
        await repository.StageAsync(asset,ct);
        var readyAttempted=false;
        try{
            foreach(var variant in image.Variants){ct.ThrowIfCancellationRequested();await store.PutAsync(asset.Id,variant,ct);}
            readyAttempted=true;
            await repository.ReadyAsync(asset,image,ct);
            return Dto(asset);
        }catch{
            // A Ready commit may have succeeded even if its acknowledgement failed.
            // Preserve its immutable objects; later reconciliation can inspect the row.
            if(readyAttempted){logger.LogWarning("Image {AssetId} needs reconciliation after an uncertain Ready commit",asset.Id);throw;}
            // A partial upload is never readable: reads require a committed Ready row.
            using var cleanup=new CancellationTokenSource(TimeSpan.FromSeconds(8));
            foreach(var name in PublicImagePaths.Names){try{await store.DeleteAsync(asset.Id,name,cleanup.Token);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Could not remove staged image {AssetId}/{Variant}: {ExceptionType}",asset.Id,name,e.GetType().Name);}}
            try{await repository.FailAsync(asset,cleanup.Token);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Image {AssetId} remains staged after {ExceptionType}",asset.Id,e.GetType().Name);}
            throw;
        }
    }
    public async Task<(byte[] Bytes,string Sha256)?> ReadAsync(string id,string name,CancellationToken ct)
    {
        PublicImagePaths.Validate(id,name);var asset=await repository.FindReadyAsync(id,ct);var variant=asset?.Variants.SingleOrDefault(v=>v.Name==name);if(variant is null)return null;
        var bytes=await store.ReadAsync(id,name,variant.Bytes,ct);if(bytes is null)return null;
        var digest=Convert.ToHexStringLower(SHA256.HashData(bytes));if(bytes.Length!=variant.Bytes||digest!=variant.Sha256)throw new BusinessException("media_unavailable","The public image could not be verified.");
        return (bytes,digest);
    }
    public static PublicImageDto Dto(PublicImageAsset asset)=>new(asset.Id,PublicImagePaths.Url(asset.Id,"card"),asset.Variants.OrderBy(v=>Array.IndexOf(PublicImagePaths.Names,v.Name)).Select(v=>new PublicImageVariantDto(v.Name,PublicImagePaths.Url(asset.Id,v.Name),v.Width,v.Height,v.Bytes,v.Sha256)).ToArray());
}
