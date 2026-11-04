using System.Data;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
using static CreditApplicationEndpoints;

public sealed class CreditDocumentCoordinator(CreditDocumentService documents,IPrivateFileVault vault,IdentityContext identity,CreditDbContext credit,FilesDbContext files)
{
    public async Task<CreditDocumentResult> UploadAsync(string actor,string applicationId,string commandId,PrivateMultipartFile upload,string path,string trace,CancellationToken ct)
    {
        var f=upload.Fields;var input=CreditDocumentService.Normalize(new(f["version"],f["consentId"],f["requirementsRevisionId"],f["documentKey"],f["replacesFileId"].Length==0?null:f["replacesFileId"],upload.Filename,upload.ContentType,upload.Bytes.Length,PrivateFileRules.Hash(upload.Bytes)));
        var file=new PrivateFileInput(actor,commandId,input.Version,input.Filename,input.ContentType,upload.Bytes,CreditDocumentService.Intent(applicationId,input));PrivateFileRules.Input(file);if(f["sha256"]!=input.FileSha256)throw PrivateFileRules.Invalid();
        var inspection=await documents.InspectAsync(actor,applicationId,commandId,input,ct);if(inspection.Replay is{}replay)return replay;
        var prepared=await vault.PrepareAsync(inspection.Scope,file,ct);
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);DbContext[] participants=[credit,files];var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();foreach(var db in participants){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Credit documents require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}
            var result=await documents.AttachAsync(actor,applicationId,commandId,input,prepared.Id,vault,ct);
            if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_DOCUMENT_ATTACH",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public async Task<PrivateFileDownload> DownloadAsync(string actor,bool staff,string applicationId,string fileId,string path,string trace,CancellationToken ct)
    {
        var scope=await documents.ScopeAsync(actor,staff,applicationId,fileId,ct);var file=await vault.ReadAsync(scope,fileId,ct);
        try{identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_DOCUMENT_READ",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);return file;}catch{CryptographicOperations.ZeroMemory(file.Bytes);throw;}
    }
}
public static class CreditDocumentEndpoints
{
    public static bool IsUpload(HttpRequest request)
    {
        if(!HttpMethods.IsPost(request.Method))return false;var parts=request.Path.Value?.Split('/')??[];
        return parts.Length==8&&parts[1]=="api"&&parts[2]=="credit"&&parts[3]=="applications"&&parts[5]=="documents"&&parts[6]=="commands"&&Id(parts[4])&&Id(parts[7]);
    }
    private static bool Id(string value)=>Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty&&id.ToString("N")==value;
    private static readonly IReadOnlyDictionary<string,int> Fields=new Dictionary<string,int>(StringComparer.Ordinal){["version"]=12,["consentId"]=32,["requirementsRevisionId"]=32,["documentKey"]=64,["replacesFileId"]=32,["sha256"]=64};
    public static void MapCreditDocuments(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit").RequireAuthorization("customer");Configure(customer,origins);MapReads(customer,false);
        customer.MapGet("/applications/{id}/documents/commands/{commandId}",async(string id,string commandId,HttpContext h,CreditDocumentService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(Actor(h),id,commandId,ct))).RequireRateLimiting("private_file_read");
        customer.MapPost("/applications/{id}/documents/commands/{commandId}",async(string id,string commandId,HttpContext h,CreditDocumentCoordinator coordinator,PrivateFileReadSlots slots,CancellationToken ct)=>{
            if(!Query(h))return Results.BadRequest();CreditApplicationRules.Id(id);CreditApplicationRules.Id(commandId);using var slot=await slots.EnterAsync(ct);if(h.Features.Get<IHttpMaxRequestBodySizeFeature>()is{IsReadOnly:false}feature)feature.MaxRequestBodySize=PrivateMultipartFileReader.MaxRequestBytes;
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(40));PrivateMultipartFile? value=null;
            try{value=await PrivateMultipartFileReader.ReadAsync(h.Request,Fields,timeout.Token);return Results.Ok(await coordinator.UploadAsync(Actor(h),id,commandId,value,h.Request.Path,h.TraceIdentifier,timeout.Token));}catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw PrivateFileRules.Unavailable();}finally{if(value is not null)CryptographicOperations.ZeroMemory(value.Bytes);}
        }).RequireRateLimiting("private_file_upload");
        var staff=app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa","credit.read");Configure(staff,adminOrigins);MapReads(staff,true);
    }
    private static void MapReads(RouteGroupBuilder group,bool staff)
    {
        group.MapGet("/applications/{id}/documents",async(string id,HttpContext h,CreditDocumentService service,IPrivateFileVault vault,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.PageAsync(Actor(h),staff,id,vault,ct))).RequireRateLimiting("private_file_read");
        group.MapGet("/applications/{id}/documents/files/{fileId}",async(string id,string fileId,HttpContext h,CreditDocumentCoordinator coordinator,PrivateFileDownloadSlots slots,CancellationToken ct)=>{
            if(!Query(h)||h.Request.Headers.ContainsKey("Range"))return Results.BadRequest();var slot=await slots.EnterAsync(ct);h.Response.RegisterForDispose(slot);try{var file=await coordinator.DownloadAsync(Actor(h),staff,id,fileId,h.Request.Path,h.TraceIdentifier,ct);return (IResult)new PrivateDocumentDownload(file,fileId,slot);}catch{slot.Dispose();throw;}
        }).RequireRateLimiting("private_file_download");
    }
}
