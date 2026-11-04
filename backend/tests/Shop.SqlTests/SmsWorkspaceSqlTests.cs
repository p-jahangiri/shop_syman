using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class SmsWorkspaceSqlTests : IAsyncLifetime
{
    private readonly Clock clock = new();
    private readonly Invalidator invalidator = new();
    private readonly Gateway gateway = new();
    private readonly Recipient recipient = new();
    private SqlFixture fixture = null!;
    private const string Connection="d6900000000000000000000000000001", OtpTemplate="d6900000000000000000000000000002", OrderTemplate="d6900000000000000000000000000003", Owner="synthetic-customer";
    private static string Id()=>Guid.NewGuid().ToString("N");
    public async Task InitializeAsync(){fixture=new(){TimeProvider=clock};await fixture.InitializeAsync();}
    public Task DisposeAsync()=>fixture.DisposeAsync();
    private SmsWorkspaceService Workspace(IServiceProvider sp)=>new(sp.GetRequiredService<NotificationsDbContext>(),sp.GetRequiredService<ISmsWorkspaceProtection>(),invalidator,clock,true);
    private SmsMessageService Messages(IServiceProvider sp)
    {
        var db=sp.GetRequiredService<NotificationsDbContext>();
        var planner=new SmsDeliveryPlanner(db,sp.GetRequiredService<ISmsWorkspaceProtection>(),sp.GetRequiredService<ICustomerOtpProtection>(),new OutsideTransaction(db,gateway),true);
        return new(db,sp.GetRequiredService<ISmsWorkspaceProtection>(),planner,recipient,clock);
    }
    private static SmsWorkspaceInput Input(string? version=null,string action="replace")=>new(version,Id(),new(),
        [new(Connection,"Synthetic SMS.ir","smsIr","live",true,action,action=="replace"?"synthetic-test-key":null)],
        [new(OtpTemplate,"OTP","otp",Connection,"170274",true,"کد #CODE#",[new("CODE","code")]),
         new(OrderTemplate,"Order","orderCreated",Connection,"170275",true,"سفارش #ORDER#",[new("ORDER","orderNumber")])],
        SmsWorkspaceRules.Events.Select(k=>new SmsRouteInput(k,k is "otp" or "orderCreated",k=="otp"?OtpTemplate:k=="orderCreated"?OrderTemplate:null)).ToArray());
    private async Task<SmsWorkspaceInfo> Save(SmsWorkspaceInput input,bool commit=true)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var result=await Workspace(scope.ServiceProvider).SaveAsync("synthetic-admin",input,"synthetic-trace",default);
        if(commit)await tx.CommitAsync();return result;
    }
    private SmsBusinessEvent Business(DateTimeOffset? at=null,bool demo=false)=>new("sales",Id(),"orderCreated",Owner,at??clock.Now,new Dictionary<string,string>{{"orderNumber","SM-1000"},{"amountRial","1000000"}},demo);
    private async Task<string> Queue(SmsBusinessEvent value)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var service=Messages(scope.ServiceProvider);
        await service.EnqueueAsync(value,default);
        return await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsMessages.Where(x=>x.Source==value.Source&&x.SourceId==value.SourceId).Select(x=>x.Id).SingleAsync();
    }
    private async Task<bool> Process(string id)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();
        return await Messages(scope.ServiceProvider).ProcessAsync(id,default);
    }
    private async Task<SmsMessage> Row(string id){await using var scope=fixture.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsMessages.AsNoTracking().SingleAsync(x=>x.Id==id);}
    [Fact]
    public async Task SaveUsesCasExactReplayAndEncryptedWriteOnlyKeys()
    {
        var command=Input();var saved=await Save(command);Assert.NotNull(saved.Version);Assert.Equal(1,invalidator.Count);
        Assert.Equal(JsonSerializer.Serialize(saved),JsonSerializer.Serialize(await Save(command)));Assert.Equal(1,invalidator.Count);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var row=await db.SmsConnections.SingleAsync();
            Assert.Equal("synthetic-test-key",scope.ServiceProvider.GetRequiredService<ISmsWorkspaceProtection>().Unprotect("key",row.KeyRevision,row.ProtectedApiKey!));
            Assert.DoesNotContain("synthetic-test-key",JsonSerializer.Serialize(saved));Assert.Equal(1,await db.SmsWorkspaceCommands.CountAsync());
        }
        Assert.Equal("sms_workspace_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Save(Input()))).Code);
        var keep=Input(saved.Version,"keep");var next=await Save(keep);Assert.NotEqual(saved.Version,next.Version);Assert.Equal(1,invalidator.Count);
        Assert.Equal("sms_workspace_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Save(command with{Otp=new(240,60)}))).Code);
    }
    [Fact]
    public async Task ConcurrentCasWritersCannotOverwriteEachOther()
    {
        var first=await Save(Input());var version=first.Version;
        async Task<bool> Attempt(string name){try{var input=Input(version,"keep");await Save(input with{Connections=input.Connections.Select(c=>c with{Name=name}).ToArray()});return true;}catch(BusinessException e){Assert.Equal("sms_workspace_conflict",e.Code);return false;}}
        var result=await Task.WhenAll(Attempt("One"),Attempt("Two"));Assert.Single(result,x=>x);
    }
    [Fact]
    public async Task NotificationChangesPreserveOtpGenerationButOtpRulesInvalidateIt()
    {
        var first=await Save(Input());string generation;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())generation=await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsWorkspace.Select(s=>s.OtpGeneration).SingleAsync();
        var input=Input(first.Version,"keep");var second=await Save(input with{Otp=input.Otp with{NotificationHourlyLimit=200},Templates=input.Templates.Select(t=>t with{Name=t.Name+" renamed"}).ToArray()});
        Assert.Equal(1,invalidator.Count);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())Assert.Equal(generation,await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsWorkspace.Select(s=>s.OtpGeneration).SingleAsync());
        await Save(Input(second.Version,"keep") with{Otp=new(120,30,2)});Assert.Equal(2,invalidator.Count);
    }
    [Fact]
    public async Task AuditTransactionRollbackRetainsNoSettingsCommandsOrKeys()
    {
        await Save(Input(),commit:false);await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();
        Assert.Empty(await db.SmsWorkspace.ToArrayAsync());Assert.Empty(await db.SmsConnections.ToArrayAsync());Assert.Empty(await db.SmsWorkspaceCommands.ToArrayAsync());
    }
    [Fact]
    public async Task SourceReplayAndConcurrentDispatchSendExactlyOnceOutsideTheSqlTransaction()
    {
        await Save(Input());var value=Business();var id=await Queue(value);Assert.Equal(id,await Queue(value));
        var results=await Task.WhenAll(Process(id),Process(id));Assert.Single(results,x=>x);Assert.Equal(1,gateway.Attempts);
        var row=await Row(id);Assert.Equal("accepted",row.State);Assert.Equal("9007199254740993",row.ProviderMessageId);
        Assert.False(await Process(id));Assert.Equal(1,gateway.Attempts);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var report=await Messages(scope.ServiceProvider).PageAsync(null,null,null,default);
        var raw=JsonSerializer.Serialize(report);Assert.DoesNotContain("+989",raw);Assert.DoesNotContain("synthetic-test-key",raw);Assert.DoesNotContain("SM-1000",raw);
    }
    [Fact]
    public async Task FutureOnlyRoutesDemoAndUnverifiedRecipientsNeverSend()
    {
        await Save(Input());var old=await Queue(Business(clock.Now.AddSeconds(-1)));var demo=await Queue(Business(demo:true));
        Assert.False(await Process(old));Assert.False(await Process(demo));Assert.Equal("route_unavailable",(await Row(old)).Reason);Assert.Equal("demo_record",(await Row(demo)).Reason);
        recipient.Available=false;var other=await Queue(Business());Assert.False(await Process(other));Assert.Equal("recipient_unavailable",(await Row(other)).Reason);Assert.Equal(0,gateway.Attempts);
    }
    [Fact]
    public async Task UncertainTransportAndInterruptedClaimsNeverRetryOrFallback()
    {
        await Save(Input());gateway.Fail=true;var id=await Queue(Business());Assert.True(await Process(id));Assert.Equal("unknown",(await Row(id)).State);
        clock.Now=clock.Now.AddMinutes(3);Assert.False(await Process(id));Assert.Equal(1,gateway.Attempts);
        var interrupted=await Queue(Business());await using(var scope=fixture.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsMessages.Where(x=>x.Id==interrupted).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.State,"dispatching").SetProperty(x=>x.AttemptedAt,clock.Now.AddMinutes(-3)));
        Assert.False(await Process(interrupted));Assert.Equal("interrupted",(await Row(interrupted)).Reason);Assert.Equal(1,gateway.Attempts);
    }
    [Fact]
    public async Task NotificationBudgetIncludesTestsAndDoesNotBurstPastItsCap()
    {
        await Save(Input() with{Otp=new(NotificationHourlyLimit:1,NotificationDailyLimit:1)});
        var one=await Queue(Business());var two=await Queue(Business());await Process(one);Assert.False(await Process(two));Assert.Equal("notification_limit",(await Row(two)).Reason);Assert.Equal(1,gateway.Attempts);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var service=Messages(scope.ServiceProvider);
        Assert.Equal("invalid_sms_workspace",(await Assert.ThrowsAsync<BusinessException>(()=>service.TestAsync(Owner,new(Id(),OrderTemplate,"+989120000000"),default))).Code);
    }
    [Fact]
    public async Task LegacyMigrationPreservesCiphertextAndGenerationAndDisablesEveryNewNotification()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var db=sp.GetRequiredService<NotificationsDbContext>();
        await db.GetService<IMigrator>().MigrateAsync("20261028175932_PrivatePhoneInbox");
        var identity=sp.GetRequiredService<IdentityDbContext>();var legacy=new CustomerSmsSettings{Enabled=true};legacy.ProtectedApiKey=sp.GetRequiredService<ICustomerOtpProtection>().Protect("key",legacy.KeyRevision,"synthetic-retained-key");identity.CustomerSmsSettings.Add(legacy);await identity.SaveChangesAsync();
        await db.Database.MigrateAsync();var state=await db.SmsWorkspace.SingleAsync();Assert.Equal(legacy.KeyRevision,state.OtpGeneration);
        var c=await db.SmsConnections.SingleAsync();Assert.True(c.LegacyKeyProtection);Assert.Equal(legacy.ProtectedApiKey,c.ProtectedApiKey);Assert.Equal(legacy.KeyRevision,c.KeyRevision);
        var routes=await db.SmsEventRoutes.ToArrayAsync();Assert.Equal(8,routes.Length);Assert.True(routes.Single(r=>r.Event=="otp").Enabled);Assert.All(routes.Where(r=>r.Event!="otp"),r=>Assert.False(r.Enabled));
        var planner=new SmsDeliveryPlanner(db,sp.GetRequiredService<ISmsWorkspaceProtection>(),sp.GetRequiredService<ICustomerOtpProtection>(),gateway,true);
        var config=await planner.ReadAsync(default);Assert.NotNull(config);Assert.True(config.Available);await config.SendAsync("+989120000000","123456",default);Assert.Equal(1,gateway.Attempts);
        var error=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261028175932_PrivatePhoneInbox"));Assert.Equal(51069,error.Number);
        Assert.Equal(legacy.ProtectedApiKey,(await db.SmsConnections.AsNoTracking().SingleAsync()).ProtectedApiKey);
    }
    private sealed class Clock:TimeProvider{public DateTimeOffset Now=new(2026,11,1,0,0,0,TimeSpan.Zero);public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed class Invalidator:ISmsOtpChallengeInvalidator{public int Count;public Task InvalidateAsync(CancellationToken ct){Interlocked.Increment(ref Count);return Task.CompletedTask;}}
    private sealed class Recipient:ISmsVerifiedRecipientReader{public bool Available=true;public Task<SmsVerifiedRecipient?> ReadAsync(string id,CancellationToken ct)=>Task.FromResult<SmsVerifiedRecipient?>(Available?new("+989120000000","مشتری"):null);}
    private sealed class OutsideTransaction(NotificationsDbContext db,Gateway gateway):ITransactionalSmsGateway{public Task<CustomerOtpSmsResult> SendAsync(TransactionalSmsRequest request,CancellationToken ct){Assert.Null(db.Database.CurrentTransaction);return gateway.SendAsync(request,ct);}}
    private sealed class Gateway:ITransactionalSmsGateway{public int Attempts;public bool Fail;public Task<CustomerOtpSmsResult> SendAsync(TransactionalSmsRequest request,CancellationToken ct){Interlocked.Increment(ref Attempts);if(Fail)throw new IOException("synthetic-private-transport-failure");return Task.FromResult(new CustomerOtpSmsResult(CustomerOtpSmsDisposition.Accepted,CustomerOtpSmsReason.None,"9007199254740993"));}}
}
