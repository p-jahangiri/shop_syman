using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;
using Shop.Modules.Files;
using Shop.SharedKernel;

public sealed record PrivateMultipartFile(Dictionary<string,string> Fields,string Filename,string ContentType,byte[] Bytes);
public static class PrivateMultipartFileReader
{
    public const int MaxRequestBytes=PrivateFileRules.MaxBytes+65536;
    public static async Task<PrivateMultipartFile> ReadAsync(HttpRequest request,IReadOnlyDictionary<string,int> limits,CancellationToken ct)
    {
        if(request.ContentLength>MaxRequestBytes)throw TooLarge();
        if(!MediaTypeHeaderValue.TryParse(request.ContentType,out var type)||!type.MediaType.Equals("multipart/form-data",StringComparison.OrdinalIgnoreCase)||type.Parameters.Count!=1||!type.Boundary.HasValue)throw PrivateFileRules.Invalid();
        var boundary=HeaderUtilities.RemoveQuotes(type.Boundary).Value!;if(boundary.Length is <1 or >70||boundary.Any(c=>!char.IsAsciiLetterOrDigit(c)&&!"'()+_,-./:=?".Contains(c)))throw PrivateFileRules.Invalid();
        using var stream=new LimitedStream(request.Body,MaxRequestBytes);var reader=new MultipartReader(boundary,stream){HeadersCountLimit=4,HeadersLengthLimit=8192,BodyLengthLimit=MaxRequestBytes};var fields=new Dictionary<string,string>(StringComparer.Ordinal);byte[]? bytes=null;string? filename=null,contentType=null;
        try{
            while(await reader.ReadNextSectionAsync(ct)is{}section){
                if(section.Headers is null||section.Headers.Keys.Any(x=>!x.Equals("Content-Disposition",StringComparison.OrdinalIgnoreCase)&&!x.Equals("Content-Type",StringComparison.OrdinalIgnoreCase))||!ContentDispositionHeaderValue.TryParse(section.ContentDisposition,out var disposition)||!disposition.DispositionType.Equals("form-data",StringComparison.OrdinalIgnoreCase)||disposition.Parameters.Select(x=>x.Name.Value).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=disposition.Parameters.Count||disposition.Parameters.Any(x=>!x.Name.Equals("name",StringComparison.OrdinalIgnoreCase)&&!x.Name.Equals("filename",StringComparison.OrdinalIgnoreCase)&&!x.Name.Equals("filename*",StringComparison.OrdinalIgnoreCase)))throw PrivateFileRules.Invalid();
                var name=HeaderUtilities.RemoveQuotes(disposition.Name).Value;
                if(name=="file"){
                    if(bytes is not null||!disposition.FileName.HasValue&&!disposition.FileNameStar.HasValue)throw PrivateFileRules.Invalid();filename=HeaderUtilities.RemoveQuotes(disposition.FileNameStar.HasValue?disposition.FileNameStar:disposition.FileName).Value;contentType=section.ContentType;
                    using var buffer=new MemoryStream();await CopyBounded(section.Body,buffer,PrivateFileRules.MaxBytes,ct);bytes=buffer.ToArray();
                }else{
                    if(name is null||!limits.ContainsKey(name)||fields.ContainsKey(name)||disposition.FileName.HasValue||disposition.FileNameStar.HasValue)throw PrivateFileRules.Invalid();using var buffer=new MemoryStream();await CopyBounded(section.Body,buffer,limits[name],ct);fields.Add(name,new UTF8Encoding(false,true).GetString(buffer.ToArray()));
                }
            }
            // Consume any epilogue through the same total request bound. The
            // framework's buffered IFormFile path is deliberately never used.
            var tail=new byte[4096];while(await stream.ReadAsync(tail,ct)>0){}
            if(fields.Count!=limits.Count||bytes is null||filename is null||contentType is null||!PrivateFileRules.IsHash(fields["sha256"])||PrivateFileRules.Hash(bytes)!=fields["sha256"])throw PrivateFileRules.Invalid();PrivateFileRules.Content(filename,contentType,bytes);return new(fields,filename,contentType,bytes);
        }catch(Exception e)when(e is InvalidDataException or DecoderFallbackException){if(bytes is not null)System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes);throw PrivateFileRules.Invalid();}
        catch{if(bytes is not null)System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes);throw;}
    }
    private static async Task CopyBounded(Stream source,Stream target,int limit,CancellationToken ct){var buffer=new byte[65536];var count=0;while(true){var n=await source.ReadAsync(buffer,ct);if(n==0)break;count=checked(count+n);if(count>limit)throw TooLarge();await target.WriteAsync(buffer.AsMemory(0,n),ct);}}
    public static BusinessException TooLarge()=>new("private_file_too_large","The private document exceeds the request limit.");
    private sealed class LimitedStream(Stream inner,int maximum):Stream
    {
        private long read;
        private int Count(int n){read+=n;if(read>maximum)throw TooLarge();return n;}
        public override int Read(byte[] buffer,int offset,int count)=>Count(inner.Read(buffer,offset,count));
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken ct=default)=>Count(await inner.ReadAsync(buffer,ct));
        public override Task<int> ReadAsync(byte[] buffer,int offset,int count,CancellationToken ct)=>ReadAsync(buffer.AsMemory(offset,count),ct).AsTask();
        public override bool CanRead=>true;public override bool CanSeek=>false;public override bool CanWrite=>false;public override long Length=>throw new NotSupportedException();public override long Position{get=>read;set=>throw new NotSupportedException();}public override void Flush(){}public override long Seek(long offset,SeekOrigin origin)=>throw new NotSupportedException();public override void SetLength(long value)=>throw new NotSupportedException();public override void Write(byte[] buffer,int offset,int count)=>throw new NotSupportedException();
    }
}
