using System.Security.Cryptography;
using SkiaSharp;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public static class ImageEnvelope
{
    public static SKEncodedImageFormat Validate(byte[] input,string filename,string contentType)
    {
        if(input.Length is 0 or >ImageLimits.MaxInputBytes)throw new BusinessException("image_too_large","Choose an image up to eight MiB.");
        if(filename.Length>200||filename.Any(char.IsControl)||filename.Contains('/')||filename.Contains('\\'))throw Invalid();
        var ext=Path.GetExtension(filename).ToLowerInvariant();SKEncodedImageFormat format;
        if(input.AsSpan().StartsWith(new byte[]{0xff,0xd8,0xff})&&ext is ".jpg" or ".jpeg"&&contentType.Equals("image/jpeg",StringComparison.OrdinalIgnoreCase))format=SKEncodedImageFormat.Jpeg;
        else if(input.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})&&ext==".png"&&contentType.Equals("image/png",StringComparison.OrdinalIgnoreCase))format=SKEncodedImageFormat.Png;
        else if(input.Length>=12&&input.AsSpan(0,4).SequenceEqual("RIFF"u8)&&input.AsSpan(8,4).SequenceEqual("WEBP"u8)&&ext==".webp"&&contentType.Equals("image/webp",StringComparison.OrdinalIgnoreCase))format=SKEncodedImageFormat.Webp;
        else throw Invalid();
        return format;
    }
    public static BusinessException Invalid()=>new("invalid_image","Choose a valid static JPEG, PNG or WebP image. The file type, extension and declared type must agree.");
}
public sealed class SkiaImageSanitizer:IImageSanitizer
{
    public SanitizedImage Sanitize(byte[] input,string filename,string contentType,CancellationToken ct)
    {
        var format=ImageEnvelope.Validate(input,filename,contentType);ct.ThrowIfCancellationRequested();
        using var data=SKData.CreateCopy(input);using var codec=SKCodec.Create(data);
        if(codec is null||codec.EncodedFormat!=format||codec.FrameCount>1)throw ImageEnvelope.Invalid();
        var size=codec.Info;if(size.Width<16||size.Height<16||size.Width>ImageLimits.MaxEdge||size.Height>ImageLimits.MaxEdge||(long)size.Width*size.Height>ImageLimits.MaxPixels)throw new BusinessException("image_dimensions","Image dimensions must be at least 16×16, at most 8192 per edge and 12 million pixels.");
        using var color=SKColorSpace.CreateSrgb();var decodedInfo=new SKImageInfo(size.Width,size.Height,SKColorType.Rgba8888,SKAlphaType.Premul,color);
        using var decoded=new SKBitmap(decodedInfo);
        if(codec.GetPixels(decodedInfo,decoded.GetPixels())!=SKCodecResult.Success)throw ImageEnvelope.Invalid();
        var origin=codec.EncodedOrigin;var swap=origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var width=swap?size.Height:size.Width;var height=swap?size.Width:size.Height;var matrix=Orientation(origin,size.Width,size.Height);
        var variants=new List<SanitizedVariant>();var names=PublicImagePaths.Names;int[] limits=[320,960,1920];
        using var source=SKImage.FromBitmap(decoded);
        for(var i=0;i<limits.Length;i++){
            ct.ThrowIfCancellationRequested();var scale=Math.Min(1d,(double)limits[i]/Math.Max(width,height));var w=Math.Max(1,(int)Math.Round(width*scale));var h=Math.Max(1,(int)Math.Round(height*scale));
            using var bitmap=new SKBitmap(new SKImageInfo(w,h,SKColorType.Rgba8888,SKAlphaType.Premul,color));
            using(var canvas=new SKCanvas(bitmap)){canvas.Clear(SKColors.Transparent);canvas.Scale((float)w/width,(float)h/height);canvas.Concat(in matrix);canvas.DrawImage(source,0,0,new SKSamplingOptions(SKFilterMode.Linear,SKMipmapMode.None));canvas.Flush();}
            using var image=SKImage.FromBitmap(bitmap);using var encoded=image.Encode(SKEncodedImageFormat.Webp,86);if(encoded is null||encoded.Size>ImageLimits.MaxOutputBytes)throw ImageEnvelope.Invalid();
            var bytes=encoded.ToArray();variants.Add(new(names[i],w,h,bytes,Convert.ToHexStringLower(SHA256.HashData(bytes))));
        }
        return new(width,height,Convert.ToHexStringLower(SHA256.HashData(input)),variants.ToArray());
    }
    private static SKMatrix Orientation(SKEncodedOrigin origin,int w,int h)=>origin switch {
        SKEncodedOrigin.TopRight=>Matrix(-1,0,w,0,1,0),
        SKEncodedOrigin.BottomRight=>Matrix(-1,0,w,0,-1,h),
        SKEncodedOrigin.BottomLeft=>Matrix(1,0,0,0,-1,h),
        SKEncodedOrigin.LeftTop=>Matrix(0,1,0,1,0,0),
        SKEncodedOrigin.RightTop=>Matrix(0,-1,h,1,0,0),
        SKEncodedOrigin.RightBottom=>Matrix(0,-1,h,-1,0,w),
        SKEncodedOrigin.LeftBottom=>Matrix(0,1,0,-1,0,w),
        _=>SKMatrix.Identity
    };
    private static SKMatrix Matrix(float a,float b,float c,float d,float e,float f)=>new(){ScaleX=a,SkewX=b,TransX=c,SkewY=d,ScaleY=e,TransY=f,Persp0=0,Persp1=0,Persp2=1};
}
