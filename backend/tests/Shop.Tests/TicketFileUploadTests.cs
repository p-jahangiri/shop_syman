using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Http;
using Shop.Modules.Files;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class TicketFileUploadTests
{
    private static byte[] Document()=>Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic upload parser QA only.\n%%EOF\n");
    private static MultipartFormDataContent Form(byte[]? bytes=null,string filename="مدرک نمونه.pdf")
    {
        bytes??=Document();var form=new MultipartFormDataContent("SaymanSyntheticUploadBoundary");form.Add(new StringContent("AAAAAAAAAAA="),"version");form.Add(new StringContent("متن نمونهٔ همراه فایل"),"body");form.Add(new StringContent("fa"),"locale");form.Add(new StringContent(PrivateFileRules.Hash(bytes)),"sha256");var file=new ByteArrayContent(bytes);file.Headers.ContentType=new MediaTypeHeaderValue("application/pdf");form.Add(file,"file",filename);return form;
    }
    private static async Task<HttpRequest> Request(HttpContent form,bool declared=true){var http=new DefaultHttpContext();http.Request.Method="POST";http.Request.ContentType=form.Headers.ContentType!.ToString();var raw=await form.ReadAsByteArrayAsync();http.Request.Body=new MemoryStream(raw);if(declared)http.Request.ContentLength=raw.Length;return http.Request;}
    [Fact]public async Task StreamsOnlyTheExpectedFieldsAndUnicodeFilenameWithoutBufferedFormFiles()
    {
        using var form=Form();var request=await Request(form,false);var value=await TicketFileUploadReader.ReadAsync(request,default);Assert.Equal("مدرک نمونه.pdf",value.Filename);Assert.Equal(Document(),value.Bytes);Assert.Equal("متن نمونهٔ همراه فایل",value.Body);Assert.Equal("AAAAAAAAAAA=",value.Version);Assert.Equal(PrivateFileRules.Hash(value.Bytes),value.Sha256);Assert.False(request.HttpContext.Features.Get<Microsoft.AspNetCore.Http.Features.IFormFeature>()?.HasFormContentType??false);
    }
    [Fact]public async Task DuplicateUnexpectedOrMissingFieldsAndMismatchedDigestCannotReachTheVault()
    {
        using(var duplicate=Form()){duplicate.Add(new StringContent("en"),"locale");var request=await Request(duplicate);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
        using(var extra=Form()){extra.Add(new StringContent("synthetic"),"ownerId");var request=await Request(extra);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
        using(var missing=new MultipartFormDataContent()){var request=await Request(missing);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
        using(var mismatch=Form()){var raw=await mismatch.ReadAsStringAsync();raw=raw.Replace(PrivateFileRules.Hash(Document()),new string('A',64),StringComparison.Ordinal);var request=new DefaultHttpContext().Request;request.ContentType=mismatch.Headers.ContentType!.ToString();request.Body=new MemoryStream(Encoding.UTF8.GetBytes(raw));await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
    }
    [Fact]public async Task DisguisedPathMimeOrSignatureAndInvalidUtf8AreRejected()
    {
        using(var path=Form(filename:"../private.pdf")){var request=await Request(path);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
        using(var html=Form(Encoding.UTF8.GetBytes("<html>synthetic spoofed private content</html>"))){var request=await Request(html);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
        using(var form=Form()){var request=await Request(form);request.ContentType="application/json";await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));}
    }
    [Fact]public async Task InvalidUtf8FieldIsRejectedRatherThanSilentlyReplaced()
    {
        using var form=Form();var raw=await form.ReadAsByteArrayAsync();var offset=raw.AsSpan().IndexOf(Encoding.UTF8.GetBytes("متن نمونهٔ همراه فایل"));Assert.True(offset>0);raw[offset]=255;var request=new DefaultHttpContext().Request;request.ContentType=form.Headers.ContentType!.ToString();request.Body=new MemoryStream(raw);await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default));
    }
    [Fact]public async Task DeclaredAndChunkedFilesAndLargeMultipartEpiloguesStayWithinTheRequestLimit()
    {
        using(var form=Form()){var request=await Request(form);request.ContentLength=TicketFileUploadReader.MaxRequestBytes+1L;Assert.Equal("private_file_too_large",(await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default))).Code);}
        using(var form=Form(new byte[PrivateFileRules.MaxBytes+1])){var request=await Request(form,false);Assert.Equal("private_file_too_large",(await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default))).Code);}
        using(var form=Form()){var request=await Request(form,false);var normal=await form.ReadAsByteArrayAsync();var all=new byte[normal.Length+TicketFileUploadReader.MaxRequestBytes];normal.CopyTo(all,0);request.Body=new MemoryStream(all);Assert.Equal("invalid_private_file",(await Assert.ThrowsAsync<BusinessException>(()=>TicketFileUploadReader.ReadAsync(request,default))).Code);}
    }
}
