using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Support;

public sealed record TicketFileReplyInput(string Version,string Body,string Locale,string Filename,string ContentType,int Bytes,string FileSha256);
public sealed record TicketFileInspection(PrivateFileScope Scope,TicketCommandResult? Replay);
public sealed record TicketAttachmentData(string Id,string MessageId,string Author,DateTimeOffset At,PrivateFileDescriptor File);
public sealed record TicketAttachmentPage(int SchemaVersion,string TicketId,TicketAttachmentData[] Items);

public sealed partial class TicketService
{
    public const int MaxAttachments=20;
    public static TicketFileReplyInput NormalizeFileInput(TicketFileReplyInput input)
    {
        TicketRules.Version(input.Version);var filename=TicketRules.Text(input.Filename,1,160,true);if(filename!=input.Filename||input.Bytes is <16 or >8388608||input.FileSha256 is not{Length:64}||input.FileSha256.Any(c=>!char.IsAsciiHexDigitUpper(c))||input.ContentType is not("image/jpeg"or"image/png"or"image/webp"or"application/pdf"))throw TicketRules.Invalid();return input with{Body=TicketRules.Text(input.Body,1,4000),Locale=TicketRules.Locale(input.Locale)};
    }
    public static string FileIntentHash(bool staff,string id,TicketFileReplyInput input)=>TicketRules.Hash(JsonSerializer.Serialize(FileOperation(staff,id,NormalizeFileInput(input)),Json));
    private static object FileOperation(bool staff,string id,TicketFileReplyInput input)=>new{Operation="file_reply",Staff=staff,TicketId=id,Input=input};
    public async Task<TicketFileInspection> InspectFileReplyAsync(string actor,bool staff,string ticketId,string commandId,TicketFileReplyInput input,CancellationToken ct)
    {
        actor=TicketRules.Actor(actor);TicketRules.Id(ticketId);TicketRules.Id(commandId);input=NormalizeFileInput(input);var ticket=await VisibleAsync(actor,staff,ticketId,false,ct);var scope=new PrivateFileScope("support",ticket.Id,ticket.OwnerId);var hash=FileIntentHash(staff,ticketId,input);
        var previous=await db.Commands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(previous is not null){if(previous.PayloadHash!=hash||previous.TicketId!=ticketId||previous.Audience!=(staff?"support":"customer"))throw new BusinessException("ticket_idempotency_conflict","This command id belongs to different details.");return new(scope,Receipt(previous)with{Replayed=true});}
        Match(ticket,input.Version);if(ticket.State=="Closed")throw Conflict();if(await db.Attachments.CountAsync(x=>x.TicketId==ticketId,ct)>=MaxAttachments)throw new BusinessException("ticket_attachment_capacity","This ticket has reached its attachment limit.");return new(scope,null);
    }
    public Task<TicketCommandResult> ReplyWithFileAsync(string actor,bool staff,string ticketId,string commandId,TicketFileReplyInput input,string fileId,IPrivateFileVault vault,CancellationToken ct)
    {
        actor=TicketRules.Actor(actor);TicketRules.Id(ticketId);TicketRules.Id(fileId);input=NormalizeFileInput(input);
        return CommandAsync(actor,staff,commandId,ticketId,FileOperation(staff,ticketId,input),async()=>{
            var row=await VisibleAsync(actor,staff,ticketId,true,ct);Match(row,input.Version);if(row.State=="Closed"||row.MessageCount==int.MaxValue)throw Conflict();if(await db.Attachments.CountAsync(x=>x.TicketId==ticketId,ct)>=MaxAttachments)throw new BusinessException("ticket_attachment_capacity","This ticket has reached its attachment limit.");
            var now=time.GetUtcNow().ToUniversalTime();row.MessageCount++;row.State=staff?"WaitingCustomer":"Open";row.ChangedAt=now;var message=Message(row,actor,staff,input.Body,input.Locale,now);var changed=Event(row,actor,"Replied",now);db.Attachments.Add(new(){Id=fileId,TicketId=row.Id,MessageId=message.Id,ActorId=actor,Author=staff?"support":"customer",At=now});await db.SaveChangesAsync(ct);
            await vault.AttachAsync(new("support",row.Id,row.OwnerId),fileId,actor,commandId,FileIntentHash(staff,ticketId,input),ct);if(staff)await notifications.RecordSupportAsync(new(row.OwnerId,row.Id,changed.Sequence,"support_reply",now),ct);realtime.SupportChanged(row.OwnerId);return new(1,false,commandId,Summary(row),message.Id);
        },ct);
    }
    public async Task<TicketAttachmentPage> AttachmentsAsync(string actor,bool staff,string ticketId,IPrivateFileVault vault,CancellationToken ct)
    {
        var ticket=await VisibleAsync(actor,staff,ticketId,false,ct);var rows=await db.Attachments.AsNoTracking().Where(x=>x.TicketId==ticketId).OrderBy(x=>x.Sequence).Take(MaxAttachments+1).ToArrayAsync(ct);if(rows.Length>MaxAttachments)throw TicketRules.Unavailable();var items=new List<TicketAttachmentData>();foreach(var row in rows){TicketRules.Id(row.Id);TicketRules.Id(row.MessageId);if(row.Author is not("customer"or"support")||row.At.Offset!=TimeSpan.Zero)throw TicketRules.Unavailable();var file=await vault.DescribeAsync(new("support",ticketId,ticket.OwnerId),row.Id,ct);items.Add(new(row.Id,row.MessageId,row.Author,row.At,file));}return new(1,ticketId,items.ToArray());
    }
    public async Task<PrivateFileScope> AttachmentScopeAsync(string actor,bool staff,string ticketId,string fileId,CancellationToken ct)
    {
        TicketRules.Id(fileId);var ticket=await VisibleAsync(actor,staff,ticketId,false,ct);if(!await db.Attachments.AsNoTracking().AnyAsync(x=>x.TicketId==ticketId&&x.Id==fileId,ct))throw Missing();return new("support",ticketId,ticket.OwnerId);
    }
}
