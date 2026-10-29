using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingAllocationPlanTests
{
    private const string Version="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact] public async Task EveryPlanEntryRequiresTheRootSerializableTransactionBeforeReadingAnyModule()
    {
        using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer("Server=localhost;Database=NeverConnectedAllocationPlan;Integrated Security=true;TrustServerCertificate=true").Options);
        var service=new SourcingAllocationPlanService(db,new NoCatalog(),new NoPurchasing(),TimeProvider.System,true);var request=Id();var task=Id();var acceptance=Id();var offer=Id();var command=Id();var now=DateTimeOffset.UtcNow;
        var input=new SourcingAllocationInput(command,Version,Version,Version,acceptance,Hash,now.AddMinutes(5),"Explicit QA hold",[new(Id(),Version,"None",[])]);
        var plan=new AcceptedSourcingPurchasePlan(request,task,offer,1,acceptance,"owner",Hash,Version,Version,Version,now.AddHours(1),"شرایط","Terms",false,[]);
        var result=new SourcingAllocationMutation(1,Id(),request,task,offer,acceptance,"allocate","Active",Version,command,now,now.AddMinutes(5),false);
        foreach(var action in new Func<Task>[] {()=>service.AcquireLocksAsync("actor",request,task,command,default),()=>service.PrepareAsync(request,task,input,default),()=>service.CompleteAsync("actor",plan,result,default)})
        {
            var error=await Assert.ThrowsAsync<InvalidOperationException>(action);Assert.Contains("root Serializable",error.Message);
        }
        Assert.Empty(db.ChangeTracker.Entries());
    }
    [Fact] public void BrowserAllocationInputCannotOverpostFinancialOrCustomerAuthority()
    {
        var json="{\"requestId\":\""+Id()+"\",\"requestVersion\":\""+Version+"\",\"taskVersion\":\""+Version+"\",\"offerVersion\":\""+Version+"\",\"acceptanceId\":\""+Id()+"\",\"termsHash\":\""+Hash+"\",\"expiresAt\":\"2030-01-01T00:05:00Z\",\"reason\":\"Explicit QA hold\",\"lines\":[]";
        foreach(var field in new[]{"\"ownerId\":\"other-owner\"","\"unitPriceRial\":\"1\"","\"quantity\":1","\"purchaseUntil\":\"2099-01-01T00:00:00Z\""})Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SourcingAllocationInput>(json+","+field+"}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        var line="{\"offerLineId\":\""+Id()+"\",\"stockVersion\":null,\"trackingMode\":\"None\",\"units\":[],\"variantId\":\"replacement\"}";
        Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SourcingAllocationLineInput>(line,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    private sealed class NoCatalog:ICatalogOfferReader
    {
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)=>throw new InvalidOperationException("Catalog must not be read before the root transaction assertion.");
        public Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class NoPurchasing:IPurchaseConfiguration
    {
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Purchasing must not be read before the root transaction assertion.");
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new NotSupportedException();
    }
}
