using System.Data;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Files;
using Shop.Modules.Support;
using Shop.Modules.Notifications;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

public sealed class TicketAttachmentCoordinator(TicketService tickets,IPrivateFileVault vault,IdentityContext identity,SupportDbContext support,FilesDbContext files,NotificationsDbContext notifications)
{
    public async Task<TicketCommandResult> UploadAsync(string actor,bool staff,string ticketId,string commandId,TicketFileUpload upload,string path,string trace,CancellationToken ct)
    {
        var input=TicketService.NormalizeFileInput(new(upload.Version,upload.Body,upload.Locale,upload.Filename,upload.ContentType,upload.Bytes.Length,PrivateFileRules.Hash(upload.Bytes)));
        var file=new PrivateFileInput(actor,commandId,upload.Version,upload.Filename,upload.ContentType,upload.Bytes,TicketService.FileIntentHash(staff,ticketId,input));PrivateFileRules.Input(file);if(upload.Sha256!=PrivateFileRules.Hash(upload.Bytes))throw PrivateFileRules.Invalid();
        var inspection=await tickets.InspectFileReplyAsync(actor,staff,ticketId,commandId,input,ct);if(inspection.Replay is{}replay)return replay;
        // No SQL transaction spans scanner or object storage I/O.
        var prepared=await vault.PrepareAsync(inspection.Scope,file,ct);
        await using var transaction=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);DbContext[] participants=[support,files,notifications];var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();foreach(var db in participants){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Private attachment modules require closed connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(db);}
            var result=await tickets.ReplyWithFileAsync(actor,staff,ticketId,commandId,input,prepared.Id,vault,ct);
            if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="PRIVATE_FILE_ATTACH",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}
            await transaction.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public async Task<PrivateFileDownload> DownloadAsync(string actor,bool staff,string ticketId,string id,string path,string trace,CancellationToken ct)
    {
        var scope=await tickets.AttachmentScopeAsync(actor,staff,ticketId,id,ct);var document=await vault.ReadAsync(scope,id,ct);
        try{identity.Audit.Add(new AuditEvent{ActorId=actor,Action="PRIVATE_FILE_READ",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);return document;}catch{CryptographicOperations.ZeroMemory(document.Bytes);throw;}
    }
}
