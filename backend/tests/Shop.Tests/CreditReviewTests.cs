using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditReviewTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact]public void Human_review_requires_explicit_outcome_reason_and_separate_amount_and_future_utc_expiry()
    {
        var at=DateTimeOffset.Parse("2026-10-27T09:00:00Z");var input=new ReviewCreditApplicationInput("AAAAAAAAAAA=",Id(),"Approved","fa","دلیل ساختگی آزمون 😀","9007199254740993",at.AddMinutes(1),true);Assert.Equal(input,CreditReviewRules.Validate(input));Assert.True(CreditReviewRules.ValidApproval(input.Outcome,9007199254740993,input.ExpiresAt,at));Assert.False(CreditReviewRules.ValidApproval(input.Outcome,null,input.ExpiresAt,at));Assert.False(CreditReviewRules.ValidApproval(input.Outcome,1,null,at));Assert.False(CreditReviewRules.ValidApproval(input.Outcome,1,at,at));
        foreach(var bad in new[]{input with{ReviewConfirmed=false},input with{Note=""},input with{Note="bad\ud800"},input with{Outcome="Automatic"},input with{ApprovedAmountRial="9007199254740993.1"},input with{ApprovedAmountRial=null},input with{ExpiresAt=null},input with{ExpiresAt=at.ToOffset(TimeSpan.FromHours(3))},input with{Outcome="Returned"},input with{Outcome="Declined"}})Assert.Throws<BusinessException>(()=>CreditReviewRules.Validate(bad));Assert.Equal("Returned",CreditReviewRules.Validate(input with{Outcome="Returned",ApprovedAmountRial=null,ExpiresAt=null}).Outcome);
    }
    [Fact]public async Task Review_and_command_records_cannot_be_modified_or_deleted_through_any_save_entry_point()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);foreach(var row in new object[]{new CreditApplicationReview{Id=Id(),ApplicationId=Id(),SubmissionId=Id()},new CreditReviewCommand{ActorId="QA",CommandId=Id(),ApplicationId=Id(),ReviewId=Id()}}){db.Attach(row);db.Remove(row);Assert.Throws<BusinessException>(()=>db.SaveChanges());Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));db.ChangeTracker.Clear();}
    }
    [Fact]public void Encrypted_review_note_and_receipt_are_bound_to_the_exact_case_record_and_purpose()
    {
        var p=new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider());var app=Id();var record=Id();var bytes=p.Protect(app,"review-note",record,"synthetic human reason");Assert.Equal("synthetic human reason",p.Unprotect(app,"review-note",record,bytes));foreach(var purpose in new[]{"review-receipt","submission-note","submission-receipt","plan"})Assert.Throws<BusinessException>(()=>p.Unprotect(app,purpose,record,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect(Id(),"review-note",record,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect(app,"review-note",Id(),bytes));
    }
}
