using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditDocumentTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact]public async Task Attachment_and_command_history_are_immutable_through_all_save_entry_points()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);
        var file=new CreditDocumentAttachment{Id=Id(),ApplicationId=Id(),ConsentId=Id(),RequirementsRevisionId=Id(),DocumentKey="synthetic"};db.Attach(file);file.ActorId="CHANGED";
        Assert.Throws<BusinessException>(()=>db.SaveChanges());Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));
        db.ChangeTracker.Clear();var command=new CreditDocumentCommand{ActorId="SYNTHETIC",CommandId=Id()};db.Attach(command);db.Remove(command);await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());
    }
    [Fact]public void File_intent_binds_the_case_consent_revision_definition_and_explicit_replacement()
    {
        var input=new CreditDocumentInput("AAAAAAAAAAA=",Id(),Id(),"synthetic",null,"synthetic.pdf","application/pdf",32,new string('A',64));var app=Id();var expected=CreditDocumentService.Intent(app,input);
        foreach(var changed in new[]{input with{ConsentId=Id()},input with{RequirementsRevisionId=Id()},input with{DocumentKey="other"},input with{ReplacesFileId=Id()},input with{Version="AAAAAAAAAAE="},input with{Filename="other.pdf"},input with{Bytes=33},input with{FileSha256=new string('B',64)}})Assert.NotEqual(expected,CreditDocumentService.Intent(app,changed));
        Assert.NotEqual(expected,CreditDocumentService.Intent(Id(),input));Assert.Throws<BusinessException>(()=>CreditDocumentService.Normalize(input with{ConsentId=new string('0',32)}));Assert.Throws<BusinessException>(()=>CreditDocumentService.Normalize(input with{ContentType="text/html"}));
    }
    [Fact]public void Protected_file_receipts_cannot_be_read_as_a_plan_consent_or_other_case_receipt()
    {
        var p=new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider());var id=Id();var bytes=p.Protect(id,"document-receipt","command","synthetic receipt");Assert.Equal("synthetic receipt",p.Unprotect(id,"document-receipt","command",bytes));foreach(var kind in new[]{"receipt","plan","consent-receipt","requirements-receipt"})Assert.Throws<BusinessException>(()=>p.Unprotect(id,kind,"command",bytes));Assert.Throws<BusinessException>(()=>p.Unprotect(Id(),"document-receipt","command",bytes));
    }
    [Fact]public async Task Multipart_credit_metadata_requires_every_exact_field_and_streams_without_form_file_buffering()
    {
        var fields=new Dictionary<string,int>(StringComparer.Ordinal){["version"]=12,["consentId"]=32,["requirementsRevisionId"]=32,["documentKey"]=64,["replacesFileId"]=32,["sha256"]=64};var bytes=Encoding.UTF8.GetBytes("%PDF-1.7\nSynthetic credit parser.\n%%EOF\n");
        async Task<HttpRequest> Request(bool oversized=false,bool extra=false){using var form=new MultipartFormDataContent();foreach(var key in fields.Keys)form.Add(new StringContent(key switch{"version"=>"AAAAAAAAAAA=","sha256"=>PrivateFileRules.Hash(bytes),"replacesFileId"=>"","documentKey"=>oversized?new string('a',65):"synthetic",_=>Id()}),key);if(extra)form.Add(new StringContent("forged"),"ownerId");var file=new ByteArrayContent(bytes);file.Headers.ContentType=new("application/pdf");form.Add(file,"file","نمونه.pdf");var h=new DefaultHttpContext();h.Request.ContentType=form.Headers.ContentType!.ToString();h.Request.Body=new MemoryStream(await form.ReadAsByteArrayAsync());return h.Request;}
        var request=await Request();var result=await PrivateMultipartFileReader.ReadAsync(request,fields,default);Assert.Equal(bytes,result.Bytes);Assert.Equal("",result.Fields["replacesFileId"]);Assert.Equal("نمونه.pdf",result.Filename);Assert.Null(request.HttpContext.Features.Get<Microsoft.AspNetCore.Http.Features.IFormFeature>());
        await Assert.ThrowsAsync<BusinessException>(async()=>await PrivateMultipartFileReader.ReadAsync(await Request(true),fields,default));await Assert.ThrowsAsync<BusinessException>(async()=>await PrivateMultipartFileReader.ReadAsync(await Request(extra:true),fields,default));
    }
    [Fact]public void Only_the_exact_customer_upload_route_bypasses_the_small_json_body_buffer()
    {
        var r=new DefaultHttpContext().Request;r.Method="POST";r.Path="/api/credit/applications/"+Id()+"/documents/commands/"+Id();Assert.True(CreditDocumentEndpoints.IsUpload(r));foreach(var path in new[]{r.Path+"/extra",r.Path.Value!.Replace("/api/credit/","/api/admin/credit/"),"/api/credit/applications/"+new string('0',32)+"/documents/commands/"+Id()}){r.Path=path;Assert.False(CreditDocumentEndpoints.IsUpload(r));}
    }
}
