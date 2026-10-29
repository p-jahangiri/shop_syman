using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditRequirementsTests
{
    private static CreditRequirementsContent Content()=>new("شرایط ساختگی آزمون","Synthetic QA requirements","متن ساختگی آزمون؛ تعهد واقعی نیست.","Synthetic test text; no real agreement.","این متن ساختگی را در آزمون خواندم.","I read this synthetic test text.",true,[new("sample","مدرک ساختگی","Synthetic document","","",true,1000,["application/pdf"])]);
    [Fact]public void Bilingual_definitions_are_explicit_bounded_and_mime_allowlisted()
    {
        var value=Content();CreditRequirementsRules.Validate(value);
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{TermsFa=""}));
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{TermsEn=" "}));
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{TitleFa="عنوان\u202eگمراه‌کننده"}));
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{Documents=[value.Documents[0],value.Documents[0]]}));
        foreach(var mime in new[]{"text/html","image/svg+xml","application/zip","image/jpeg; charset=utf-8"})Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{Documents=[value.Documents[0]with{ContentTypes=[mime]}]}));
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{Documents=[value.Documents[0]with{MaxBytes=8388609}]}));
        Assert.Throws<BusinessException>(()=>CreditRequirementsRules.Validate(value with{TermsFa=new string('ش',4000),TermsEn=new string('ش',4000)}));
        Assert.Equal(new[]{"application/pdf","image/png"},CreditRequirementsRules.ContentTypes(CreditRequirementsRules.TypeMask(["image/png","application/pdf"])));
        // Zero required documents is a deliberate admin policy, not an
        // invented mandatory identity document or a submission capability.
        CreditRequirementsRules.Validate(value with{Documents=[]});
    }
    [Fact]public void Omitted_required_flags_and_expected_version_are_not_silently_inferred()
    {
        var raw=JsonSerializer.SerializeToNode(new PublishCreditRequirementsInput(null,Content()),CreditRequirementsRules.Json)!;
        raw["content"]!.AsObject().Remove("enabled");Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<PublishCreditRequirementsInput>(raw.ToJsonString(),CreditRequirementsRules.Json));
        raw=JsonSerializer.SerializeToNode(new PublishCreditRequirementsInput(null,Content()),CreditRequirementsRules.Json)!;raw.AsObject().Remove("version");Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<PublishCreditRequirementsInput>(raw.ToJsonString(),CreditRequirementsRules.Json));
        raw=JsonSerializer.SerializeToNode(new PublishCreditRequirementsInput(null,Content()),CreditRequirementsRules.Json)!;raw["content"]!["documents"]![0]!.AsObject().Remove("required");Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<PublishCreditRequirementsInput>(raw.ToJsonString(),CreditRequirementsRules.Json));
    }
    [Fact]public async Task All_save_entry_points_preserve_published_terms_and_document_definitions()
    {
        await using var db=Context();var revision=new CreditRequirementsRevision();db.Attach(revision);revision.TermsFa="این تغییر نباید ذخیره شود";
        Assert.Equal("credit_requirements_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));
        db.ChangeTracker.Clear();var doc=new CreditRequirementDocument{RevisionId=Guid.NewGuid().ToString("N"),Key="sample"};db.Attach(doc);db.Remove(doc);Assert.Throws<BusinessException>(()=>db.SaveChanges());
    }
    [Fact]public async Task Consent_and_receipt_history_cannot_be_rewritten_or_deleted()
    {
        await using var db=Context();var consent=new CreditRequirementsConsent{ApplicationId=Guid.NewGuid().ToString("N"),RevisionId=Guid.NewGuid().ToString("N"),Locale="fa"};db.Attach(consent);consent.Locale="en";await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());
        db.ChangeTracker.Clear();var receipt=new CreditRequirementsConsentCommand{ActorId="SYNTHETIC",CommandId=Guid.NewGuid().ToString("N")};db.Attach(receipt);db.Remove(receipt);await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());
    }
    [Fact]public void Protected_requirements_and_consent_receipts_have_separate_purposes()
    {
        var p=new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider());var scope=Guid.NewGuid().ToString("N");var bytes=p.Protect(scope,"requirements-receipt","command","synthetic receipt");Assert.Equal("synthetic receipt",p.Unprotect(scope,"requirements-receipt","command",bytes));
        foreach(var kind in new[]{"receipt","plan","consent-receipt"})Assert.Throws<BusinessException>(()=>p.Unprotect(scope,kind,"command",bytes));
    }
    private static CreditDbContext Context()=>new(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);
}
