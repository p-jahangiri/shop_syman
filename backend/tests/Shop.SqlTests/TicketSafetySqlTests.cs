using System.Data;
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Support;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class TicketSqlTests
{
    [Fact]public async Task EverySaveChangesOverloadRejectsRewritingOrDeletingSupportHistoryAndOwnership()
    {
        var owner=await Customer();using var c=owner.Client;var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));var id=Value(created["ticket"]!,"id");
        for(var method=0;method<4;method++)foreach(var kind in new[]{"message-edit","message-delete","event-edit","event-delete","receipt-edit","receipt-delete","owner-edit","subject-edit","ticket-delete"}){
            await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();
            switch(kind){
                case "message-edit":(await db.Messages.SingleAsync(x=>x.TicketId==id)).ProtectedBody=[1,2,3];break;
                case "message-delete":db.Messages.Remove(await db.Messages.SingleAsync(x=>x.TicketId==id));break;
                case "event-edit":(await db.Events.SingleAsync(x=>x.TicketId==id)).Action="Closed";break;
                case "event-delete":db.Events.Remove(await db.Events.SingleAsync(x=>x.TicketId==id));break;
                case "receipt-edit":(await db.Commands.SingleAsync(x=>x.TicketId==id)).ResultHash=new string('A',64);break;
                case "receipt-delete":db.Commands.Remove(await db.Commands.SingleAsync(x=>x.TicketId==id));break;
                case "owner-edit":(await db.Tickets.SingleAsync(x=>x.Id==id)).OwnerId="OTHER";break;
                case "subject-edit":(await db.Tickets.SingleAsync(x=>x.Id==id)).ProtectedSubject=[1,2,3];break;
                case "ticket-delete":db.Tickets.Remove(await db.Tickets.SingleAsync(x=>x.Id==id));break;
            }
            var error=await Assert.ThrowsAsync<BusinessException>(async()=>{switch(method){case 0:db.SaveChanges();break;case 1:db.SaveChanges(false);break;case 2:await db.SaveChangesAsync();break;case 3:await db.SaveChangesAsync(false);break;}});Assert.Equal("ticket_history_immutable",error.Code);
        }
        var fresh=await Body(await c.GetAsync("/api/support/tickets/"+id));Assert.Equal(created["ticket"]!.ToJsonString(),fresh["ticket"]!.ToJsonString());
    }
    [Fact]public async Task TamperedCiphertextAndReceiptFailClosedInsteadOfReturningOtherMessages()
    {
        var owner=await Customer();using var c=owner.Client;var command=Id();var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+command,Input()));var id=Value(created["ticket"]!,"id");
        var second=await Body(await c.PostAsJsonAsync($"/api/support/tickets/{id}/replies/{Id()}",new ReplyTicketInput(Version(created),"Second private text","en")));
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();var rows=await db.Messages.AsNoTracking().Where(x=>x.TicketId==id).OrderBy(x=>x.Sequence).ToArrayAsync();var target=rows[1].Id;var wrong=rows[0].ProtectedBody;await db.Messages.Where(x=>x.Id==target).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.ProtectedBody,wrong));
        }
        using(var unreadable=await c.GetAsync($"/api/support/tickets/{id}/messages"))Assert.Equal(HttpStatusCode.ServiceUnavailable,unreadable.StatusCode);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();await db.Commands.Where(x=>x.CommandId==command).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.ResultHash,new string('F',64)));}
        using(var unreadable=await c.GetAsync("/api/support/commands/"+command))Assert.Equal(HttpStatusCode.ServiceUnavailable,unreadable.StatusCode);using(var replay=await c.PostAsJsonAsync("/api/support/tickets/commands/"+command,Input()))Assert.Equal(HttpStatusCode.ServiceUnavailable,replay.StatusCode);
    }
    [Fact]public async Task CapacityCountsOnlyOpenTicketsAndReopenCannotExceedTheSameOwnerQuota()
    {
        var actor="QA-"+Id();await using var scope=fixture.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var service=new TicketService(sp.GetRequiredService<SupportDbContext>(),sp.GetRequiredService<ITicketProtection>(),TimeProvider.System,new(2),sp.GetRequiredService<Shop.SharedKernel.IPrivateNotificationWriter>(),sp.GetRequiredService<IPrivateRealtimeEvents>());
        var a=await service.CreateAsync(actor,Id(),Input(),default);var b=await service.CreateAsync(actor,Id(),Input(),default);Assert.Equal("ticket_capacity",(await Assert.ThrowsAsync<BusinessException>(()=>service.CreateAsync(actor,Id(),Input(),default))).Code);
        var closed=await service.StateAsync(actor,false,a.Ticket.Id,Id(),new(a.Ticket.Version,"Closed"),default);await service.CreateAsync(actor,Id(),Input(),default);Assert.Equal("ticket_capacity",(await Assert.ThrowsAsync<BusinessException>(()=>service.StateAsync(actor,false,a.Ticket.Id,Id(),new(closed.Ticket.Version,"Open"),default))).Code);
        Assert.Equal(2,(await sp.GetRequiredService<SupportDbContext>().Tickets.CountAsync(x=>x.OwnerId==actor.ToUpperInvariant()&&x.State!="Closed")));Assert.Equal("Open",b.Ticket.State);
    }
    [Fact]public async Task StaffAuditFailureRollsBackMessageStateEventAndReceiptBeforeSameUuidRetry()
    {
        var owner=await Customer();using var c=owner.Client;using var staff=await Staff();var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));var id=Value(created["ticket"]!,"id");var command=Id();var path=$"/api/admin/support/tickets/{id}/replies/{command}";var input=new ReplyTicketInput(Version(created),"Reply that must roll back with audit","en");
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var identity=scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>();Assert.StartsWith("SaymanTest_",identity.Database.GetDbConnection().Database);Assert.Matches("^/api/admin/support/tickets/[a-f0-9]{32}/replies/[a-f0-9]{32}$",path);var guardedSql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_TicketAuditFailure] CHECK ([Resource]<>N'"+path+"')";await identity.Database.ExecuteSqlRawAsync(guardedSql);}
        try{using var failed=await staff.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_TicketAuditFailure]");}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();var row=await db.Tickets.AsNoTracking().SingleAsync(x=>x.Id==id);Assert.Equal("Open",row.State);Assert.Equal(1,row.MessageCount);Assert.Single(await db.Messages.Where(x=>x.TicketId==id).ToArrayAsync());Assert.Single(await db.Events.Where(x=>x.TicketId==id).ToArrayAsync());Assert.False(await db.Commands.AnyAsync(x=>x.CommandId==command));}
        var success=await Body(await staff.PostAsJsonAsync(path,input));Assert.False(success["replayed"]!.GetValue<bool>());Assert.Equal("WaitingCustomer",Value(success["ticket"]!,"state"));
    }
    [Fact]public async Task MessagePaginationAndTicketCursorDoNotAcceptOtherScopesOrLoseLargeSequences()
    {
        var owner="PAGE-"+Id();string id;await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var sp=scope.ServiceProvider;var db=sp.GetRequiredService<SupportDbContext>();var privacy=sp.GetRequiredService<ITicketProtection>();var now=DateTimeOffset.UtcNow;var row=new SupportTicket{OwnerId=owner.ToUpperInvariant(),MessageCount=53,CreatedAt=now,ChangedAt=now};id=row.Id;row.ProtectedSubject=privacy.Protect(id,"subject",id,"Pagination QA");db.Tickets.Add(row);
            for(var n=0;n<53;n++){var message=new TicketMessage{TicketId=id,ActorId=owner.ToUpperInvariant(),At=now};message.ProtectedBody=privacy.Protect(id,"message",message.Id,"Page message "+n);db.Messages.Add(message);}await db.SaveChangesAsync();
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var service=scope.ServiceProvider.GetRequiredService<TicketService>();var first=await service.MessagesAsync(owner,false,id,null,default);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var second=await service.MessagesAsync(owner,false,id,first.NextCursor,default);Assert.Equal(3,second.Items.Length);Assert.Null(second.NextCursor);var all=first.Items.Concat(second.Items).ToArray();Assert.Equal(53,all.Select(x=>x.Id).Distinct().Count());Assert.Equal(all.Select(x=>long.Parse(x.Sequence)).Order(),all.Select(x=>long.Parse(x.Sequence)));
            Assert.Equal("invalid_ticket",(await Assert.ThrowsAsync<BusinessException>(()=>service.MessagesAsync(owner,true,id,first.NextCursor,default))).Code);Assert.Equal("invalid_ticket",(await Assert.ThrowsAsync<BusinessException>(()=>service.PageAsync(owner,false,null,first.NextCursor,default))).Code);
        }
    }
    [Fact]public async Task DowngradeWithPrivateSupportHistoryIsRejectedAndLeavesItsTablesIntact()
    {
        var owner=await Customer();using var c=owner.Client;await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();var count=await db.Messages.CountAsync();
        var error=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("0"));Assert.Equal(51000,error.Number);Assert.Equal(count,await db.Messages.CountAsync());Assert.Single(await db.Database.GetAppliedMigrationsAsync());
    }
}
