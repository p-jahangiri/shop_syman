using System.Security.Cryptography;
using Shop.SharedKernel;
public sealed class PrivateDocumentDownload(PrivateFileDownload value,string id,IDisposable slot):IResult
    {
        public async Task ExecuteAsync(HttpContext http)
        {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);timeout.CancelAfter(TimeSpan.FromSeconds(30));
            try{http.Response.Headers.CacheControl="private, no-store";http.Response.Headers.Vary="Cookie, Authorization";http.Response.Headers["X-Robots-Tag"]="noindex, nofollow";http.Response.Headers["X-Sayman-Private-File"]=id;http.Response.Headers["X-Content-Type-Options"]="nosniff";http.Response.Headers.ContentSecurityPolicy="default-src 'none'; sandbox";var disposition=new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue("attachment");disposition.SetHttpFileName(value.Filename);http.Response.Headers.ContentDisposition=disposition.ToString();http.Response.ContentType=value.ContentType;http.Response.ContentLength=value.Bytes.Length;await http.Response.Body.WriteAsync(value.Bytes,timeout.Token);}finally{CryptographicOperations.ZeroMemory(value.Bytes);slot.Dispose();}
        }
    }
