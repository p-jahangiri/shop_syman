using Shop.Modules.Catalog.Media;
using Shop.Modules.Reviews;
using Shop.SharedKernel;

public sealed class ReviewPhotoProcessor(IImageSanitizer sanitizer) : IReviewPhotoProcessor
{
    private readonly SemaphoreSlim slots = new(2, 2);

    public async Task<byte[]> ProcessAsync(byte[] input, string name, string contentType, CancellationToken ct)
    {
        ImageEnvelope.Validate(input, name, contentType);
        if (!await slots.WaitAsync(0, ct))
            throw new BusinessException("review_photos_busy", "Review photos are busy. Retry in a moment.");
        try
        {
            var variants = sanitizer.Sanitize(input, name, contentType, ct).Variants;
            return variants.FirstOrDefault(v => v.Name == "card" && v.Bytes.Length <= ReviewPhotos.MaxBytes)?.Bytes
                ?? variants.Single(v => v.Name == "thumb").Bytes;
        }
        finally { slots.Release(); }
    }
}
