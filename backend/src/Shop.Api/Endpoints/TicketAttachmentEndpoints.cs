using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Http.Features;
using Shop.Modules.Files;
using Shop.Modules.Support;
using Shop.SharedKernel;

public sealed class PrivateFileReadSlots
{
    private readonly SemaphoreSlim slots=new(2,2);
    public async Task<IDisposable> EnterAsync(CancellationToken ct){if(!await slots.WaitAsync(0,ct))throw new BusinessException("private_file_busy","Private document requests are busy. Retry shortly.");return new Lease(slots);}
    private sealed class Lease(SemaphoreSlim slots):IDisposable{private int disposed;public void Dispose(){if(Interlocked.Exchange(ref disposed,1)==0)slots.Release();}}
}
public sealed class PrivateFileDownloadSlots
{
    private readonly PrivateFileReadSlots slots=new();
    public Task<IDisposable> EnterAsync(CancellationToken ct)=>slots.EnterAsync(ct);
}
public static class TicketAttachmentEndpoints
{
    public static void MapTicketAttachments(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        // This independent group coordinates its own short, audited root
        // transaction after scanning, rather than the general admin filter.
        var customer=app.MapGroup("/api/support").RequireAuthorization("customer");Map(customer,false,origins);
        var staff=app.MapGroup("/api/admin/support").RequireAuthorization("staff_mfa","support.read");Map(staff,true,adminOrigins);
    }
    private static void Map(RouteGroupBuilder group,bool staff,string[] origins)
    {
        group.AddEndpointFilter(async(context,next)=>{var request=context.HttpContext.Request;var origin=request.Headers.Origin.ToString();if((!HttpMethods.IsGet(request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);if(request.Query.Count!=0)return Results.BadRequest();return await next(context);});
        group.MapGet("/files/capabilities",(IPrivateFileVault vault)=>Results.Ok(new{SchemaVersion=1,Configured=vault.Configured,MaxBytes=PrivateFileRules.MaxBytes,ContentTypes=PrivateFileRules.ContentTypes,MaxPerTicket=TicketService.MaxAttachments})).RequireRateLimiting("private_file_read");
        group.MapGet("/tickets/{id}/attachments",async(string id,HttpContext http,TicketService service,IPrivateFileVault vault,CancellationToken ct)=>Results.Ok(await service.AttachmentsAsync(Actor(http),staff,id,vault,ct))).RequireRateLimiting("private_file_read");
        group.MapGet("/tickets/{id}/attachments/{fileId}",async(string id,string fileId,HttpContext http,TicketAttachmentCoordinator coordinator,PrivateFileDownloadSlots slots,CancellationToken ct)=>{
            if(http.Request.Headers.ContainsKey("Range"))return Results.BadRequest();var slot=await slots.EnterAsync(ct);http.Response.RegisterForDispose(slot);try{var value=await coordinator.DownloadAsync(Actor(http),staff,id,fileId,http.Request.Path,http.TraceIdentifier,ct);return (IResult)new PrivateDocumentDownload(value,fileId,slot);}catch{slot.Dispose();throw;}
        }).RequireRateLimiting("private_file_download");
        var upload=group.MapPost("/tickets/{id}/attachments/{commandId}",async(string id,string commandId,HttpContext http,TicketAttachmentCoordinator coordinator,PrivateFileReadSlots slots,CancellationToken ct)=>{
            TicketRules.Id(id);TicketRules.Id(commandId);using var slot=await slots.EnterAsync(ct);if(http.Features.Get<IHttpMaxRequestBodySizeFeature>()is{IsReadOnly:false}feature)feature.MaxRequestBodySize=TicketFileUploadReader.MaxRequestBytes;
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(40));TicketFileUpload? value=null;
            try{value=await TicketFileUploadReader.ReadAsync(http.Request,timeout.Token);return Results.Ok(await coordinator.UploadAsync(Actor(http),staff,id,commandId,value,http.Request.Path,http.TraceIdentifier,timeout.Token));}catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw PrivateFileRules.Unavailable();}finally{if(value is not null)CryptographicOperations.ZeroMemory(value.Bytes);}
        }).RequireRateLimiting("private_file_upload");if(staff)upload.RequireAuthorization("support.write");
    }
    private static string Actor(HttpContext http)=>http.User.FindFirstValue("sub")??throw TicketRules.Invalid();
}
