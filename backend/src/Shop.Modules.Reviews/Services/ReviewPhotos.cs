using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Reviews;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReviewPhotoInput(string Action, string? Name = null, string? ContentType = null, string? Data = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Slot = null);

public sealed record ReviewOptions(bool IncludeDevelopmentExamples);

public static class ReviewPhotos
{
    public const int MaxBytes = 2 * 1024 * 1024;
    public const int MaxBase64Length = (MaxBytes + 2) / 3 * 4;
    public const int MaxCount = 3;
    public const int MaxRequestBytes = 8_500_000;

    public static bool IsWebp(byte[] value) => value.Length is >= 12 and <= MaxBytes
        && value.AsSpan(0, 4).SequenceEqual("RIFF"u8) && value.AsSpan(8, 4).SequenceEqual("WEBP"u8);

    public static byte[]? Decode(ReviewPhotoInput? photo)
    {
        if (photo is null || photo.Action is "keep" or "remove" && photo is { Name: null, ContentType: null, Data: null })
            return null;
        if (photo.Slot is not null || photo.Action != "replace" || photo.Name is null or "" || photo.Name.Length > 200
            || photo.ContentType is not ("image/jpeg" or "image/png" or "image/webp") || photo.Data is null or "")
            throw ReviewRules.Invalid();
        if (photo.Data.Length > MaxBase64Length)
            throw new BusinessException("image_too_large", "Choose a review photo up to two MiB.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(photo.Data); }
        catch (FormatException) { throw ReviewRules.Invalid(); }
        if (bytes.Length is 0 or > MaxBytes)
            throw new BusinessException("image_too_large", "Choose a review photo up to two MiB.");
        if (Convert.ToBase64String(bytes) != photo.Data)
            throw ReviewRules.Invalid();
        return bytes;
    }
}

public interface IReviewPhotoProcessor
{
    Task<byte[]> ProcessAsync(byte[] input, string name, string contentType, CancellationToken ct);
}
