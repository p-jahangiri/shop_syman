using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditScheduleProtectionTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact]public void ScheduleReceiptsAreBoundToActorOrderCommandAndTheirOwnPurpose()
    {
        var provider=new EphemeralDataProtectionProvider();var p=new DataProtectionCreditScheduleProtection(provider);var order=Id();var command=Id();var bytes=p.Protect("qa-actor",order,command,"Synthetic QA receipt only");Assert.Equal("Synthetic QA receipt only",p.Unprotect("QA-ACTOR",order,command,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("other-actor",order,command,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("qa-actor",Id(),command,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("qa-actor",order,Id(),bytes));Assert.Throws<BusinessException>(()=>new DataProtectionCreditOrderProtection(provider).Unprotect("QA-ACTOR",order,bytes));bytes[^1]^=1;Assert.Throws<BusinessException>(()=>p.Unprotect("qa-actor",order,command,bytes));
    }
    [Fact]public async Task EverySaveEntryPointRejectsModifiedOrRemovedScheduleHistoryAndNewLinesCannotAppendToAnOldRevision()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);var row=new CreditScheduleRevision{Id=Id()};db.Attach(row);row.PlanName="Mutation";Assert.Throws<BusinessException>(()=>db.SaveChanges());Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));db.ChangeTracker.Clear();var command=new CreditScheduleCommand{ActorId="QA",CommandId=Id()};db.Attach(command);db.Remove(command);Assert.Throws<BusinessException>(()=>db.SaveChanges());db.ChangeTracker.Clear();db.ScheduleLines.Add(new(){RevisionId=Id(),Sequence=1,MonthOffset=1,AmountRial=1,DueDate=new(2027,1,1)});Assert.Throws<BusinessException>(()=>db.SaveChanges());
    }
}
