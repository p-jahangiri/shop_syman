using Shop.SharedKernel;
public sealed record TicketFileUpload(string Version,string Body,string Locale,string Sha256,string Filename,string ContentType,byte[] Bytes);
public static class TicketFileUploadReader
{
    public const int MaxRequestBytes=PrivateMultipartFileReader.MaxRequestBytes;
    public static async Task<TicketFileUpload> ReadAsync(HttpRequest request,CancellationToken ct)
    {
        var value=await PrivateMultipartFileReader.ReadAsync(request,new Dictionary<string,int>(StringComparer.Ordinal){["version"]=64,["body"]=16000,["locale"]=64,["sha256"]=64},ct);
        return new(value.Fields["version"],value.Fields["body"],value.Fields["locale"],value.Fields["sha256"],value.Filename,value.ContentType,value.Bytes);
    }
    public static BusinessException TooLarge()=>PrivateMultipartFileReader.TooLarge();
}
