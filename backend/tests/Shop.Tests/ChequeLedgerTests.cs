using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ChequeLedgerTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Theory]
    [InlineData("Received","Deposit","Deposited")]
    [InlineData("Received","ReturnToCustomer","ReturnedToCustomer")]
    [InlineData("Deposited","ReportCollection","CollectedReported")]
    [InlineData("Deposited","ReportBounce","BouncedReported")]
    [InlineData("Deposited","Withdraw","Withdrawn")]
    [InlineData("BouncedReported","Deposit","Deposited")]
    [InlineData("Withdrawn","ReturnToCustomer","ReturnedToCustomer")]
    [InlineData("CollectedReported","CorrectCollectionReport","Deposited")]
    public void OnlyExplicitCustodyTransitionsAreAccepted(string before,string action,string after)=>Assert.Equal(after,ChequeLedgerRules.Next(before,action));
    [Fact]public void CollectionCannotBeReportedBeforeDepositAndReturnedChequesCannotReopen()
    {
        Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Next("Received","ReportCollection"));Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Next("CollectedReported","ReportCollection"));Assert.Empty(ChequeLedgerRules.Actions("ReturnedToCustomer"));Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Next("ReturnedToCustomer","Deposit"));Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Actions("Paid"));
    }
    [Fact]public void OccurrenceIsExplicitUtcWithinItsRecordedChronologyAndSensitiveTextIsBounded()
    {
        var at=new DateTimeOffset(2026,10,27,10,0,0,TimeSpan.Zero);ChequeLedgerRules.Time(at,at.AddSeconds(-1),at);Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Time(at.AddTicks(1),at,at));Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Time(at.AddSeconds(-2),at,at));Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Time(at.ToOffset(TimeSpan.FromHours(3.5)),at.AddHours(-1),at.AddHours(1)));
        Assert.Equal("شناسه ۱۲۳",ChequeLedgerRules.Text("شناسه ۱۲۳",128,true));foreach(var bad in new[]{" "," leading","trailing ","new\nline",new string('x',129)})Assert.Throws<BusinessException>(()=>ChequeLedgerRules.Text(bad,128,true));Assert.Equal("",ChequeLedgerRules.Text("",500));
    }
    [Fact]public void PrivateRegistrationEventAndReceiptHaveSeparatePurposesAndIdentityOrderRecordBinding()
    {
        var p=new DataProtectionChequeLedgerProtection(new EphemeralDataProtectionProvider());var order=Id();var id=Id();var bytes=p.Protect("registration","qa-owner",order,id,"Synthetic private instrument only");Assert.Equal("Synthetic private instrument only",p.Unprotect("registration","QA-OWNER",order,id,bytes));
        foreach(var kind in new[]{"event","receipt","other"})Assert.Throws<BusinessException>(()=>p.Unprotect(kind,"qa-owner",order,id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("registration","foreign",order,id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("registration","qa-owner",Id(),id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("registration","qa-owner",order,Id(),bytes));bytes[^1]^=1;Assert.Throws<BusinessException>(()=>p.Unprotect("registration","qa-owner",order,id,bytes));
    }
    [Fact]public async Task AllSaveEntryPointsRejectHistoryMutationBeforeOpeningAnySqlConnection()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);
        var cheque=new ReceivedCheque{Id=Id()};db.Attach(cheque);cheque.AmountRial=1;Assert.Equal("cheque_ledger_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));db.ChangeTracker.Clear();var e=new ChequeLedgerEvent{Id=Id()};db.Attach(e);db.Remove(e);Assert.Throws<BusinessException>(()=>db.SaveChanges());db.ChangeTracker.Clear();var command=new ChequeLedgerCommand{ActorId="QA",CommandId=Id()};db.Attach(command);command.ResultHash=new string('F',64);Assert.Throws<BusinessException>(()=>db.SaveChanges());
    }
    [Fact]public void LedgerMoneyRemainsExactDecimalRialAboveJavascriptIntegerPrecision()=>Assert.Equal("9007199254740993",ChequeLedgerRules.Rial(9007199254740993));
}
