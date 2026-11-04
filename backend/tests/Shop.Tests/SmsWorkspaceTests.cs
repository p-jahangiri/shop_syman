using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Shop.Api;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SmsWorkspaceTests
{
    private const string Connection = "d6900000000000000000000000000001", Template = "d6900000000000000000000000000002";
    private static SmsWorkspaceInput Input(string provider = "smsIr") => new(null, Guid.NewGuid().ToString("N"), new(),
        [new(Connection, "Synthetic", provider, "live", true, "replace", "synthetic-not-real-key")],
        [new(Template, "OTP", "otp", Connection, provider == "smsIr" ? "170274" : "SaymanOtp", true, "", [new(provider == "smsIr" ? "CODE" : "token", "code")])],
        SmsWorkspaceRules.Events.Select(k => new SmsRouteInput(k, k == "otp", k == "otp" ? Template : null)).ToArray());
    [Theory]
    [InlineData("smsIr")][InlineData("kavenegar")]
    public void BothDocumentedProvidersSupportNamedTemplatesAndBindings(string provider)
    {
        var input = Input(provider); var valid = SmsWorkspaceRules.Validate(input, false);
        Assert.Equal(provider, valid.Connections.Single().Provider);
        Assert.DoesNotContain("synthetic-not-real-key", valid.ToString());
        Assert.DoesNotContain("synthetic-not-real-key", valid.Connections.Single().ToString());
    }
    [Theory]
    [InlineData(60,30,1)][InlineData(600,300,10)][InlineData(300,60,5)]
    public void OtpRulesAcceptTheirSupportedExtremes(int lifetime,int resend,int attempts) => SmsWorkspaceRules.Policy(new SmsOtpPolicy(lifetime,resend,attempts));
    [Theory]
    [InlineData(59,30,1)][InlineData(601,30,1)][InlineData(60,60,1)][InlineData(300,29,5)][InlineData(300,60,11)][InlineData(300,60,0)]
    public void OtpRulesRejectInvalidWindowsOrAttemptBudgets(int lifetime,int resend,int attempts) => Assert.Throws<BusinessException>(() => SmsWorkspaceRules.Policy(new SmsOtpPolicy(lifetime,resend,attempts)));
    [Theory]
    [InlineData("otp","customerName")][InlineData("otp","orderNumber")][InlineData("orderPaid","code")][InlineData("orderPaid","trackingCode")][InlineData("orderCreated","dueDate")][InlineData("chequeReminder","orderStatus")]
    public void VariablesMustBelongToTheirActualBusinessEvent(string kind,string source)
    {
        var input = Input(); var t = input.Templates[0] with { Kind=kind, Parameters=[new("CODE",source)] };
        input = input with { Templates=[t], Routes=SmsWorkspaceRules.Events.Select(k=>new SmsRouteInput(k,false,k==kind?Template:null)).ToArray() };
        Assert.Throws<BusinessException>(()=>SmsWorkspaceRules.Validate(input,true));
    }
    [Fact]
    public void DisabledEmptyWorkspaceCanBePreparedButCannotEnableAnUnconfiguredRoute()
    {
        var input=Input() with { Connections=[],Templates=[],Routes=SmsWorkspaceRules.Events.Select(k=>new SmsRouteInput(k,false,null)).ToArray() };
        SmsWorkspaceRules.Validate(input,false);
        Assert.Throws<BusinessException>(()=>SmsWorkspaceRules.Validate(input with { Routes=input.Routes.Select(r=>r.Event=="otp"?r with{Enabled=true}:r).ToArray() },false));
    }
    [Theory]
    [InlineData("token","two words",false)][InlineData("token10","two words",true)][InlineData("token20","a b c d e f g h i",true)][InlineData("token10","a b c d e f g",false)][InlineData("Token","123456",false)]
    public void KavenegarTokenNamesAndSpaceBudgetsFollowItsDocumentedContract(string name,string value,bool valid)
    {
        if(valid)SmsProviderRules.Value("kavenegar",name,value);
        else Assert.Throws<ArgumentException>(()=>SmsProviderRules.Value("kavenegar",name,value));
    }
    [Fact]
    public void PrivateTransportCannotBeSerializedAndCannotEnumerateAnUnboundedParameterStream()
    {
        var request=new TransactionalSmsRequest("kavenegar","synthetic-key","+989120000000","SaymanOtp",[new("token","001234")]);
        Assert.Throws<NotSupportedException>(()=>JsonSerializer.Serialize(request));
        Assert.DoesNotContain("001234",request.ToString());
        IEnumerable<SmsValue> Endless(){while(true)yield return new("token","001234");}
        Assert.Throws<ArgumentException>(()=>new TransactionalSmsRequest("kavenegar","synthetic-key","+989120000000","SaymanOtp",Endless()));
    }
    [Fact]
    public async Task SmsIrWorkspaceTransportUsesItsFixedVerifyContractAndPrivateHeader()
    {
        var calls=0;
        using var gateway=new TransactionalSmsGateway(new Handler(async(request,ct)=>{
            calls++;Assert.Equal(HttpMethod.Post,request.Method);Assert.Equal("https://api.sms.ir/v1/send/verify",request.RequestUri!.AbsoluteUri);
            Assert.Equal("synthetic-key",Assert.Single(request.Headers.GetValues("x-api-key")));
            using var body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));var root=body.RootElement;
            Assert.Equal("09120000000",root.GetProperty("mobile").GetString());Assert.Equal(170274,root.GetProperty("templateId").GetInt32());
            var parameter=Assert.Single(root.GetProperty("parameters").EnumerateArray());Assert.Equal("CODE",parameter.GetProperty("name").GetString());Assert.Equal("001234",parameter.GetProperty("value").GetString());
            return new(HttpStatusCode.OK){Content=new StringContent("{\"status\":1,\"data\":{\"messageId\":12}}",Encoding.UTF8,"application/json")};
        }),TimeSpan.FromSeconds(1));
        var result=await gateway.SendAsync(new("smsIr","synthetic-key","+989120000000","170274",[new("CODE","001234")]),default);
        Assert.Equal(new(CustomerOtpSmsDisposition.Accepted,CustomerOtpSmsReason.None,"12"),result);Assert.Equal(1,calls);
    }
    [Fact]
    public void ChequeSmsUsesTheSameCivilDayInThePersianCalendar()
    {
        Assert.Equal("1405/08/10", SmsWorkspaceRules.PersianDueDate("2026-11-01"));
        Assert.Throws<BusinessException>(() => SmsWorkspaceRules.PersianDueDate("2026-02-30"));
    }
    [Fact]
    public void PersianWordJoinersAreAllowedButBidiOverridesAndControlsAreNotSmsValues()
    {
        SmsProviderRules.Value("smsIr","STATUS","پرداخت‌شده");Assert.True(SmsWorkspaceRules.Text("قالب تأیید‌شده",100));
        Assert.Throws<ArgumentException>(()=>SmsProviderRules.Value("smsIr","STATUS","bad\u202etext"));
        Assert.Throws<ArgumentException>(()=>SmsProviderRules.Value("smsIr","STATUS","bad\ntext"));
    }
    [Fact]
    public async Task KavenegarUsesOneFixedHostPostFormAndReturnsOnlyAcceptedMessageId()
    {
        var calls=0;
        using var gateway=new TransactionalSmsGateway(new Handler(async(request,ct)=>{
            calls++;Assert.Equal(HttpMethod.Post,request.Method);
            Assert.Equal("https://api.kavenegar.com/v1/synthetic-key/verify/lookup.json",request.RequestUri!.AbsoluteUri);
            Assert.Empty(request.RequestUri.Query); Assert.False(request.Headers.Contains("x-api-key"));
            Assert.Equal("application/x-www-form-urlencoded",request.Content!.Headers.ContentType!.MediaType);
            var body=await request.Content.ReadAsStringAsync(ct);
            Assert.Contains("receptor=09120000000",body);Assert.Contains("token=001234",body);Assert.Contains("type=sms",body);
            return new(HttpStatusCode.OK){Content=new StringContent("{\"return\":{\"status\":200},\"entries\":[{\"messageid\":9223372036854775807,\"message\":\"private\",\"receptor\":\"private\"}]}",Encoding.UTF8,"application/json")};
        }),TimeSpan.FromSeconds(1));
        var result=await gateway.SendAsync(new("kavenegar","synthetic-key","+989120000000","SaymanOtp",[new("token","001234")]),default);
        Assert.Equal(new(CustomerOtpSmsDisposition.Accepted,CustomerOtpSmsReason.None,"9223372036854775807"),result);Assert.Equal(1,calls);
        Assert.DoesNotContain("private",JsonSerializer.Serialize(result));
    }
    [Theory]
    [InlineData("{\"return\":{\"status\":200},\"entries\":[]}")]
    [InlineData("{\"return\":{\"status\":200,\"status\":200},\"entries\":[{\"messageid\":12}]}")]
    [InlineData("{\"return\":{\"status\":\"200\"},\"entries\":[{\"messageid\":12}]}")]
    [InlineData("{\"return\":{\"status\":200},\"entries\":[{\"messageid\":\"12\"}]}")]
    [InlineData("{\"return\":{\"status\":200},\"entries\":[{\"messageid\":0}]}")]
    public void HostileOrAmbiguousKavenegarSuccessDoesNotBecomeAccepted(string raw) => Assert.Equal(CustomerOtpSmsDisposition.Unknown,TransactionalSmsGateway.KavenegarResponse(Encoding.UTF8.GetBytes(raw)).Disposition);
    [Fact]
    public async Task TransportFailureNeverRetriesOrExposesItsCredentialUri()
    {
        var calls=0;using var gateway=new TransactionalSmsGateway(new Handler((request,_)=>{calls++;throw new HttpRequestException(request.RequestUri!.AbsoluteUri);}),TimeSpan.FromMilliseconds(50));
        var value=await gateway.SendAsync(new("kavenegar","synthetic-key","+989120000000","SaymanOtp",[new("token","123456")]),default);
        Assert.Equal(CustomerOtpSmsDisposition.Unknown,value.Disposition);Assert.Equal(1,calls);Assert.DoesNotContain("synthetic-key",value.ToString());
    }
    [Fact]
    public void WorkspaceSecretsAreBoundToPurposeAndRevision()
    {
        var protection=new DataProtectionSmsWorkspaceProtection(new EphemeralDataProtectionProvider());
        var cipher=protection.Protect("key","revision","synthetic-private-key");
        Assert.Equal("synthetic-private-key",protection.Unprotect("key","revision",cipher));
        Assert.Throws<System.Security.Cryptography.CryptographicException>(()=>protection.Unprotect("message","revision",cipher));
        Assert.Throws<System.Security.Cryptography.CryptographicException>(()=>protection.Unprotect("key","other",cipher));
        Assert.DoesNotContain("synthetic-private-key",Convert.ToBase64String(cipher));
    }
    private sealed class Handler(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> run):HttpMessageHandler
    {protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>run(request,ct);}
}
