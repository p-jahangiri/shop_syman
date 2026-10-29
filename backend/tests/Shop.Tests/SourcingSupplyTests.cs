using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingSupplyTests
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SourcingSupplySourceInput Source()=>new(Guid.NewGuid().ToString("D"),V,V,"manual","Holoo-000A","منبع خصوصی","Private supplier","INV-00042",At,"پیام عمومی","Public message",null,"یادداشت خصوصی");
    private static SourcingSupplySummary Summary()=>new(Id(),Id(),Id(),"PendingSupply","None","PendingSupply",V,1,2,0,2,At,At,null,At.AddDays(1),true,false,true);
    [Fact] public void StartBindsExactAcceptedVersionsAndIndependentCommandIdentifier()
    {
        var command=Guid.NewGuid().ToString("D");var result=SourcingSupplyRules.Normalize(new SourcingSupplyStartInput(command,V,V,Hash));Assert.Equal(Guid.Parse(command).ToString("N"),result.RequestId);Assert.Equal(V,result.RequestVersion);Assert.Equal(V,result.OfferVersion);Assert.Equal(Hash,result.TermsHash);
        Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(result with{TermsHash=new string('a',64)}));Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(result with{OfferVersion="bad"}));
    }
    [Fact] public void SourceIdentityRetainsCaseAndLeadingZerosWhileHumanTextIsNormalized()
    {
        var input=Source() with{SourceNameFa="  نام\r\nمنبع  ",InternalNote="  متن  "};var result=SourcingSupplyRules.Normalize(input,true);Assert.Equal("Holoo-000A",result.SourceKey);Assert.Equal("INV-00042",result.Reference);Assert.Equal("نام\nمنبع",result.SourceNameFa);Assert.Equal("متن",result.InternalNote);Assert.Null(result.ExpectedAt);
        Assert.NotEqual(SourcingRules.Payload(result),SourcingRules.Payload(result with{SourceKey="holoo-000a"}));Assert.NotEqual(SourcingRules.Payload(result),SourcingRules.Payload(result with{Reference="INV-42"}));
    }
    [Fact] public void OrderedRequiresActualReferenceRequestedCanExplicitlyHaveNone()
    {
        var input=Source() with{Reference=null};Assert.Null(SourcingSupplyRules.Normalize(input,false).Reference);Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(input,true));
        foreach(var value in new[]{"","  INV","INV  ","INV\n42",new string('x',201)})Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(Source() with{Reference=value},true));
    }
    [Fact] public void SupplierActionsRequireBothLanguagesAndRealUtcFields()
    {
        foreach(var input in new[]{Source() with{SourceKind="api"},Source() with{SourceKey=" "},Source() with{SourceNameEn=""},Source() with{PublicMessageFa=" "},Source() with{PublicMessageEn=new string('x',501)},Source() with{InternalNote=new string('x',2001)},Source() with{ActionAt=At.ToOffset(TimeSpan.FromHours(1))},Source() with{ExpectedAt=At.ToOffset(TimeSpan.FromHours(1))}})Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(input,true));
    }
    [Fact] public void UnknownEtaStaysNullAndNeverCopiesPurchaseDeadline()
    {
        var input=new SourcingSupplyProgressInput(Id(),V,V,At,"پیگیری","Follow-up",null);var result=SourcingSupplyRules.Normalize(input);Assert.Null(result.ExpectedAt);Assert.Equal("",result.InternalNote);Assert.Equal(At,result.ActionAt);
        Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(input with{TaskVersion="bad"}));
    }
    [Fact] public void TerminalReasonAndMessagesRemainExplicit()
    {
        var input=new SourcingSupplyCloseInput(Id(),V,V,"supplier_unavailable","عدم امکان تأمین","Supply unavailable",null);Assert.Equal("supplier_unavailable",SourcingSupplyRules.Normalize(input).ReasonCode);
        Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(input with{ReasonCode="Cancelled By Staff"}));Assert.Throws<BusinessException>(()=>SourcingSupplyRules.Normalize(input with{PublicMessageEn=""}));
    }
    [Theory][InlineData(0,0,"None")][InlineData(1,0,"Partial")][InlineData(2,3,"Complete")][InlineData(2,0,"Partial")]
    public void ReceivingProgressUsesAllAcceptedLines(int first,int second,string expected)=>Assert.Equal(expected,SourcingSupplyRules.ReceiptProgress([(2,first),(3,second)]));
    [Theory][InlineData(0,0)][InlineData(1,-1)][InlineData(1,2)][InlineData(1000001,0)]
    public void ReceivingProgressRejectsInvalidCounts(int required,int received)=>Assert.Throws<BusinessException>(()=>SourcingSupplyRules.ReceiptProgress([(required,received)]));
    [Fact] public void ReceivingProgressRejectsMissingOrOversizedAcceptedLineSets()
    {
        Assert.Throws<BusinessException>(()=>SourcingSupplyRules.ReceiptProgress([]));Assert.Throws<BusinessException>(()=>SourcingSupplyRules.ReceiptProgress(Enumerable.Repeat((1,0),65)));
    }
    [Theory][InlineData("PendingSupply",true)][InlineData("SupplierRequested",true)][InlineData("SupplierOrderRecorded",true)][InlineData("Cancelled",false)][InlineData("Failed",false)]
    public void ReceiptCompletionDoesNotCloseWorkflowOrProduceCheckout(string state,bool open)
    {
        Assert.Equal(open,SourcingSupplyRules.Open(state));Assert.Equal(open?"Received":state,SourcingSupplyRules.EffectiveState(state,"Complete"));Assert.Equal(open?"PartiallyReceived":state,SourcingSupplyRules.EffectiveState(state,"Partial"));Assert.DoesNotContain("Ready",SourcingSupplyRules.EffectiveState(state,"Complete"));
    }
    [Fact] public void UnknownStatesOrProgressCannotEscapeAsPublicEnums()
    {
        Assert.Throws<BusinessException>(()=>SourcingSupplyRules.EffectiveState("ReadyForCheckout","Complete"));Assert.Throws<BusinessException>(()=>SourcingSupplyRules.EffectiveState("PendingSupply","Paid"));
    }
    [Fact] public void CustomerAndInventoryWireHaveNoOwnerSupplierPriceNotesOrSerialsAndNullsStayExplicit()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var summary=Summary();var customer=JsonSerializer.Serialize(new SourcingSupplyCustomerDetail(1,Id(),"SR-1",V,summary,[new(Id(),"variant","SKU-REAL","نام","Name","نسخه","Variant",2,0,2)],"پیام","Message"),options);var inventory=JsonSerializer.Serialize(new SourcingSupplyInventoryDetail(1,Id(),"SR-1",V,summary,[new(Id(),"variant","model","SKU-REAL","نام","Name","نسخه","Variant",2,0,2)],true,false),options);
        foreach(var value in new[]{customer,inventory}){Assert.Contains("\"expectedAt\":null",value);Assert.Contains("\"reservedForRequest\":false",value);Assert.Contains("\"canCheckout\":false",value);Assert.Contains("\"canPay\":false",value);foreach(var forbidden in new[]{"ownerId","actorId","sourceKind","sourceKey","sourceNameFa","sourceNameEn","reference","internalNote","protectedNote","priceRial","imei1","imei2","serial"})Assert.DoesNotContain("\""+forbidden+"\":",value,StringComparison.OrdinalIgnoreCase);}
        var admin=JsonSerializer.Serialize(new SourcingSupplyAdminDetail(1,Id(),"SR-1",V,summary,[],"پیام","Message",null,null,null,null,null,null,"",true,true,true,true),options);foreach(var field in new[]{"sourceKind","sourceKey","sourceNameFa","sourceNameEn","reference","actionAt"})Assert.Contains("\""+field+"\":null",admin);
    }
    [Fact] public void EventIdentifiersRemainStringsBeyondJavascriptIntegerPrecision()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var entry=new SourcingSupplyEventData("9007199254740993",null,"PendingSupply","None","staff","supply_started","","",null,null,At);var json=JsonSerializer.Serialize(new SourcingSupplyEventPage(1,20,[entry],null),options);Assert.Contains("\"id\":\"9007199254740993\"",json);Assert.Contains("\"stateBefore\":null",json);Assert.Contains("\"actionAt\":null",json);Assert.Contains("\"expectedAt\":null",json);Assert.Contains("\"nextCursor\":null",json);Assert.DoesNotContain("actorId",json);
    }
    [Fact] public void LargeValidUnicodeHistoryIsPageableWithinWireBudgetWithoutDroppingEntries()
    {
        var text=new string('ف',2000);var found=Enumerable.Range(1,51).Select(n=>new SourcingSupplyAdminEventData(new(n.ToString(System.Globalization.CultureInfo.InvariantCulture),"SupplierRequested","SupplierOrderRecorded","None","staff","supplier_ordered",new string('پ',500),new string('م',500),At,null,At),"staff","manual","000A","منبع","Supplier","00042",text)).ToArray();
        var result=SourcingSupplyWireBudget.Page(found,50,(items,next)=>new SourcingSupplyAdminEventPage(1,50,items,next),e=>e.Event.Id);Assert.NotEmpty(result.Items);Assert.True(result.Items.Length<50);Assert.Equal(result.Items[^1].Event.Id,result.NextCursor);Assert.Equal(found.Take(result.Items.Length),result.Items);Assert.True(JsonSerializer.SerializeToUtf8Bytes(result,new JsonSerializerOptions(JsonSerializerDefaults.Web)).Length<=SourcingSupplyWireBudget.MaximumBytes);
        var remaining=found.Skip(result.Items.Length).ToArray();var next=SourcingSupplyWireBudget.Page(remaining,50,(items,cursor)=>new SourcingSupplyAdminEventPage(1,50,items,cursor),e=>e.Event.Id);Assert.Equal((result.Items.Length+1).ToString(System.Globalization.CultureInfo.InvariantCulture),next.Items[0].Event.Id);
    }
    [Fact] public void ModelOwnsTaskAcceptanceOpenUniquenessCountsConcurrencyAndNoForeignSchemaFks()
    {
        using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedSupplyModel;Integrated Security=true;TrustServerCertificate=true").Options);var model=db.GetService<IDesignTimeModel>().Model;var task=model.FindEntityType(typeof(SourcingSupplyTask))!;Assert.True(task.FindProperty(nameof(SourcingSupplyTask.Version))!.IsConcurrencyToken);Assert.Contains(task.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual([nameof(SourcingSupplyTask.AcceptanceId)]));Assert.Contains(task.GetIndexes(),i=>i.IsUnique&&i.Properties.Select(p=>p.Name).SequenceEqual([nameof(SourcingSupplyTask.RequestId)])&&i.GetFilter()=="[IsOpen] = 1");Assert.Equal(65536,task.FindProperty(nameof(SourcingSupplyTask.ProtectedNote))!.GetMaxLength());Assert.Equal("Latin1_General_100_BIN2",task.FindProperty(nameof(SourcingSupplyTask.SourceKey))!.GetCollation());Assert.All(model.GetEntityTypes().Where(t=>t.ClrType.Name.StartsWith("SourcingSupply",StringComparison.Ordinal)).SelectMany(t=>t.GetForeignKeys()),fk=>Assert.Equal("market",fk.PrincipalEntityType.GetSchema()));var application=model.FindEntityType(typeof(SourcingSupplyReceiptApplication))!;Assert.Equal(nameof(SourcingSupplyReceiptApplication.ReceiptId),Assert.Single(application.FindPrimaryKey()!.Properties).Name);
    }
    [Fact] public async Task EveryCommandRejectsMissingRootTransactionBeforeAnyDatabaseOrCatalogRead()
    {
        using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedSupplyTransaction;Integrated Security=true;TrustServerCertificate=true").Options);var service=new SourcingSupplyService(db,new NoReader(),new NoNotes(),TimeProvider.System,true);var request=Id();var task=Id();var offer=Id();var start=new SourcingSupplyStartInput(Id(),V,V,Hash);var progress=new SourcingSupplyProgressInput(Id(),V,V,At,"پیام","Message",null);var close=new SourcingSupplyCloseInput(Id(),V,V,"supplier_unavailable","پیام","Message");var receipt=new SourcingReceiptInput(Id(),V,V,"manual","holoo","0001","0001","00042",At,"Actual QA receipt",false,[]);var plan=new SourcingReceivingPlan(request,task,offer,Id(),"owner",Hash,true,false,V,V,[]);var result=new SourcingReceivingResult(1,Id(),request,task,offer,plan.AcceptanceId,false,At,At,false,[]);
        foreach(var action in new Func<Task>[] {()=>service.StartAsync("actor",request,offer,task,start,CancellationToken.None),()=>service.RequestedAsync("actor",request,task,Source(),CancellationToken.None),()=>service.OrderedAsync("actor",request,task,Source(),CancellationToken.None),()=>service.ProgressAsync("actor",request,task,progress,CancellationToken.None),()=>service.CancelAsync("actor",request,task,close,CancellationToken.None),()=>service.FailAsync("actor",request,task,close,CancellationToken.None),()=>service.AcquireReceivingLocksAsync("actor",request,task,Id(),CancellationToken.None),()=>service.PrepareReceiveAsync("actor",request,task,receipt,CancellationToken.None),()=>service.CompleteReceiveAsync("actor",plan,result,CancellationToken.None)}){var error=await Assert.ThrowsAsync<InvalidOperationException>(action);Assert.Contains("root Serializable",error.Message);}Assert.Empty(db.ChangeTracker.Entries());
    }
    private sealed class NoReader:ICatalogOfferReader
    {
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)=>throw new InvalidOperationException("Catalog must not run before root transaction assertion.");
        public Task<OfferSkuPage> LookupAsync(string model,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class NoNotes:ISourcingSupplyNoteProtection
    {
        public string Protect(string owner,string task,string note)=>throw new InvalidOperationException("Protection must not run before root transaction assertion.");
        public string Unprotect(string owner,string task,string value)=>throw new NotSupportedException();
    }
}
