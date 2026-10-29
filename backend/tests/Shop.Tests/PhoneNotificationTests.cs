using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class PhoneNotificationTests
{
    private static PhoneDiscoveryNotificationEvent Available()=>new(new string('a',32),"owner-a","phone_available",new string('b',32),new string('c',32),null,null,"galaxy-a56-5g","variant-256-black",DateTimeOffset.Parse("2026-10-28T10:00:00Z"));

    [Fact]public void WriterInputNormalizesTheSameAccountWithoutChangingProductOrEventIdentity()
    {
        var input=Available();var value=PhoneInboxRules.Normalize(input);
        Assert.Equal("OWNER-A",value.OwnerId);Assert.Equal(input with{OwnerId="OWNER-A"},value);
        Assert.Equal(value,PhoneInboxRules.Normalize(value));
    }

    [Fact]public void AvailabilityAndOfferEventsRequireTheirOwnExactActionIdentifiers()
    {
        var valid=PhoneInboxRules.Normalize(Available());PhoneInboxRules.Validate(valid);
        var quote=valid with{Kind="sourcing_offer_published",RequestId=new string('d',32),OfferId=new string('e',32),StoreSlug=null,VariantId=null};PhoneInboxRules.Validate(quote);
        foreach(var invalid in new[]{valid with{Kind="support_reply"},valid with{RequestId=new string('d',32)},valid with{OfferId=new string('d',32)},valid with{StoreSlug=null},valid with{VariantId=null},quote with{RequestId=null},quote with{OfferId=null},quote with{StoreSlug="galaxy-a56"}})
            Assert.Throws<BusinessException>(()=>PhoneInboxRules.Validate(invalid));
    }

    [Fact]public void PhoneEventsRejectNonCanonicalIdsUnsafeLinksAndForeignOffsets()
    {
        var valid=PhoneInboxRules.Normalize(Available());
        foreach(var invalid in new[]{valid with{Id=new string('0',32)},valid with{ListingId="listing"},valid with{ConfigurationId=new string('A',32)},valid with{OwnerId="owner-a"},valid with{OwnerId="OWNER/OTHER"},valid with{StoreSlug="https://foreign.invalid"},valid with{StoreSlug="../account"},valid with{StoreSlug="Phone"},valid with{VariantId="variant/other"},valid with{VariantId=new string('a',65)},valid with{At=valid.At.ToOffset(TimeSpan.FromHours(3.5))}})
            Assert.Throws<BusinessException>(()=>PhoneInboxRules.Validate(invalid));
    }

    [Fact]public void PhoneCursorBindsTheFeedOwnerUnreadFilterAndInt64Sequence()
    {
        const long sequence=9007199254740993;var cursor=PhoneInboxRules.Cursor(sequence,"owner-a",true);
        Assert.Equal(sequence,PhoneInboxRules.Before(cursor,"OWNER-A",true));Assert.Equal(long.MaxValue,PhoneInboxRules.Before(null,"owner-a",false));
        Assert.Equal("9007199254740993",PhoneInboxRules.Sequence(sequence));
        Assert.Throws<BusinessException>(()=>PhoneInboxRules.Before(cursor,"owner-b",true));
        Assert.Throws<BusinessException>(()=>PhoneInboxRules.Before(cursor,"owner-a",false));
        Assert.Throws<BusinessException>(()=>PhoneInboxRules.Before(NotificationRules.Cursor(sequence,"owner-a",true),"owner-a",true));
        Assert.Throws<BusinessException>(()=>NotificationRules.Before(cursor,"owner-a",true));
        Assert.Throws<BusinessException>(()=>PhoneInboxRules.Sequence(0));
    }

    [Fact]public void PhoneInboxProtectionBindsOwnerEventAndFamilyAndRejectsTampering()
    {
        var provider=new EphemeralDataProtectionProvider();var protection=new DataProtectionPhoneInboxProtection(provider);
        var id=new string('a',32);var payload=protection.Protect("owner-a",id,"synthetic phone event");
        Assert.Equal("synthetic phone event",protection.Unprotect("OWNER-A",id,payload));
        Assert.Throws<BusinessException>(()=>protection.Unprotect("owner-b",id,payload));
        Assert.Throws<BusinessException>(()=>protection.Unprotect("owner-a",new string('b',32),payload));
        Assert.Throws<BusinessException>(()=>new DataProtectionCreditInboxProtection(provider).Unprotect("owner-a",id,payload));
        payload[^1]^=1;Assert.Throws<BusinessException>(()=>protection.Unprotect("owner-a",id,payload));
    }

    [Fact]public void PublicPhoneInboxKeepsExplicitNullsAndNeverSerializesOwnerSourcePriceOrContact()
    {
        var value=new PhoneInboxData(new string('a',32),"9007199254740993","phone_available",new string('b',32),new string('c',32),null,null,"galaxy-a56-5g","variant-black",DateTimeOffset.UnixEpoch,null);
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};
        var raw=JsonSerializer.Serialize(new PhoneInboxPage(1,false,[value],null),options);
        foreach(var key in new[]{"requestId","offerId","readAt","nextCursor"})Assert.Contains('"'+key+"\":null",raw);
        Assert.Contains("\"sequence\":\"9007199254740993\"",raw);
        foreach(var field in new[]{"ownerId","source","referencePriceRial","priceRial","phoneNumber","email","protectedPayload","payloadHash"})Assert.DoesNotContain('"'+field+'"',raw,StringComparison.OrdinalIgnoreCase);
    }
}
