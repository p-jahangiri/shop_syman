using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditSubmissionTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact]public void Submission_requires_explicit_review_and_exact_versions_and_rejects_invalid_unicode()
    {
        var input=new SubmitCreditApplicationInput("AAAAAAAAAAA=",Id(),Id(),"AAAAAAAAAAE=","en","Synthetic QA 😀",true);
        Assert.Equal(input,CreditSubmissionRules.Validate(input));
        foreach(var invalid in new[]{input with{ReviewRequested=false},input with{Note=" untrimmed"},input with{Note=new string('x',2001)},input with{Note="broken\ud800"},input with{Locale="ar"},input with{ConsentId=new string('0',32)},input with{RequirementsVersion="bad"}})Assert.Throws<BusinessException>(()=>CreditSubmissionRules.Validate(invalid));
        var raw=JsonSerializer.Serialize(input,CreditRequirementsRules.Json);Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SubmitCreditApplicationInput>(raw.Replace(",\"reviewRequested\":true",""),CreditRequirementsRules.Json));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SubmitCreditApplicationInput>(raw.Replace("}",",\"approved\":true}"),CreditRequirementsRules.Json));
    }
    [Fact]public async Task Submission_notes_links_and_receipts_are_append_only_through_every_save_entry_point()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);
        foreach(var entity in new object[]{new CreditSubmission{Id=Id(),ApplicationId=Id(),ConsentId=Id(),RequirementsRevisionId=Id()},new CreditSubmissionDocument{SubmissionId=Id(),DocumentKey="sample",ApplicationId=Id(),ConsentId=Id(),RequirementsRevisionId=Id(),AttachmentId=Id()},new CreditSubmissionCommand{ActorId="QA",CommandId=Id(),ApplicationId=Id(),SubmissionId=Id()}}){db.Attach(entity);db.Remove(entity);Assert.Throws<BusinessException>(()=>db.SaveChanges());Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));db.ChangeTracker.Clear();}
    }
    [Fact]public void Encrypted_note_and_receipt_cannot_be_swapped_between_cases_or_purposes()
    {
        var p=new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider());var app=Id();var id=Id();var bytes=p.Protect(app,"submission-note",id,"synthetic note");Assert.Equal("synthetic note",p.Unprotect(app,"submission-note",id,bytes));foreach(var purpose in new[]{"submission-receipt","document-receipt","plan","receipt"})Assert.Throws<BusinessException>(()=>p.Unprotect(app,purpose,id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect(Id(),"submission-note",id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect(app,"submission-note",Id(),bytes));
    }
}
