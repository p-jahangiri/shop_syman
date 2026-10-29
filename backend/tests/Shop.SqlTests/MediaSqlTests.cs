using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class MediaSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task CleanupLeasePreventsTwoWorkersAndConcurrentReadyFromDeletingReadyImages()
    {
        var clock=new TestClock(DateTimeOffset.UtcNow);var store=new CleanupStore{Hold=true};var staged=Asset(clock.GetUtcNow().AddDays(-2));var ready=Asset(clock.GetUtcNow().AddDays(-2),"Ready");var recent=Asset(clock.GetUtcNow());
        await using var staleScope=fixture.Factory.Services.CreateAsyncScope();var staleDb=staleScope.ServiceProvider.GetRequiredService<CatalogDbContext>();staleDb.PublicImages.AddRange(staged,ready,recent);await staleDb.SaveChangesAsync();
        await using var first=fixture.Factory.Services.CreateAsyncScope();var firstRun=Reconciler(first,store,clock).RunAsync(25,default);await store.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try{
            await using var second=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(0,(await Reconciler(second,store,clock).RunAsync(25,default)).Claimed);
            var bytes=new byte[]{1,2,3};var digest=Convert.ToHexStringLower(SHA256.HashData(bytes));var variants=PublicImagePaths.Names.Select(name=>new SanitizedVariant(name,32,32,bytes,digest)).ToArray();
            await Assert.ThrowsAsync<DbUpdateConcurrencyException>(()=>staleScope.ServiceProvider.GetRequiredService<IPublicImageRepository>().ReadyAsync(staged,new(32,32,digest,variants),default));
        }finally{store.Release.TrySetResult();}
        Assert.Equal(new ImageReconciliationResult(1,1,1,0),await firstRun);
        await using var verification=fixture.Factory.Services.CreateAsyncScope();var db=verification.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.Equal("Purged",(await db.PublicImages.SingleAsync(a=>a.Id==staged.Id)).Status);Assert.Equal("Ready",(await db.PublicImages.SingleAsync(a=>a.Id==ready.Id)).Status);Assert.Equal("Staged",(await db.PublicImages.SingleAsync(a=>a.Id==recent.Id)).Status);
        Assert.Equal(PublicImagePaths.Names.Length,store.Deleted.Count);Assert.All(store.Deleted,key=>Assert.StartsWith(staged.Id+"/",key));
    }
    [Fact] public async Task CleanupRecoversExpiredLeasesAndRetriesFailuresWithoutBusyLooping()
    {
        var clock=new TestClock(DateTimeOffset.UtcNow);var store=new CleanupStore();var abandoned=Asset(clock.GetUtcNow().AddDays(-2),"Failed");var expired=Asset(clock.GetUtcNow().AddDays(-2),"Cleaning");expired.CleanupLeaseId=Guid.NewGuid().ToString("N");expired.CleanupLeaseExpiresAt=clock.GetUtcNow().AddMinutes(-1);var failing=Asset(clock.GetUtcNow().AddDays(-2));store.FailId=failing.Id;
        await using(var setup=fixture.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();db.PublicImages.AddRange(abandoned,expired,failing);await db.SaveChangesAsync();}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var result=await Reconciler(scope,store,clock).RunAsync(25,default);Assert.Equal(3,result.Claimed);Assert.Equal(2,result.Purged);Assert.Equal(1,result.Failed);}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())Assert.Equal(0,(await Reconciler(scope,store,clock).RunAsync(25,default)).Claimed);
        store.FailId=null;clock.Now=clock.Now.AddHours(2);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var result=await Reconciler(scope,store,clock).RunAsync(25,default);Assert.Equal(1,result.Purged);var row=await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().PublicImages.SingleAsync(a=>a.Id==failing.Id);Assert.Equal("Purged",row.Status);Assert.Null(row.CleanupLeaseId);Assert.Null(row.CleanupLeaseExpiresAt);Assert.NotNull(row.LastCleanupAt);}
    }
    private static PublicImageAsset Asset(DateTimeOffset created,string status="Staged")=>new(){CreatedAt=created,CreatedBy="cleanup-sql-test",Status=status,InputBytes=3,Width=32,Height=32,OriginalSha256=new string('a',64)};
    private static PublicImageReconciler Reconciler(AsyncServiceScope scope,IPublicImageStore store,TimeProvider clock)=>new(scope.ServiceProvider.GetRequiredService<CatalogDbContext>(),store,clock,NullLogger<PublicImageReconciler>.Instance);
    private sealed class TestClock(DateTimeOffset now):TimeProvider{public DateTimeOffset Now=now;public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed class CleanupStore:IPublicImageStore
    {
        public bool Configured=>true;public bool Hold;public string? FailId;public List<string> Deleted{get;}=[];
        public TaskCompletionSource Entered{get;}=new(TaskCreationOptions.RunContinuationsAsynchronously);public TaskCompletionSource Release{get;}=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task DeleteAsync(string id,string name,CancellationToken ct){if(Hold){Entered.TrySetResult();await Release.Task.WaitAsync(ct);}if(id==FailId)throw new IOException("test-only storage failure");Deleted.Add(id+"/"+name);}
        public Task PutAsync(string id,SanitizedVariant variant,CancellationToken ct)=>throw new NotSupportedException();
        public Task<byte[]?> ReadAsync(string id,string name,int expectedBytes,CancellationToken ct)=>throw new NotSupportedException();
    }
    // This scenario exercises SQL metadata and catalogue references. Scanner and
    // object transport acceptance are separate; these bytes are not a scan claim.
    [Fact] public async Task OnlyCommittedReadyImagesCanBeUsedByCatalogueWrites()
    {
        var id=Guid.NewGuid().ToString("N");var bytes=new byte[]{1,2,3};var digest=Convert.ToHexStringLower(SHA256.HashData(bytes));
        var asset=new PublicImageAsset{Id=id,CreatedBy="sql-media-test",OriginalSha256=digest,InputBytes=3,Width=32,Height=32};
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var repository=scope.ServiceProvider.GetRequiredService<IPublicImageRepository>();await repository.StageAsync(asset,default);Assert.Null(await repository.FindReadyAsync(id,default));
            var service=scope.ServiceProvider.GetRequiredService<ICatalogService>();var rejected=await Assert.ThrowsAsync<BusinessException>(()=>service.SaveBrandAsync(null,new("Staged image", "staged-"+id,PublicImagePaths.Url(id,"card"),true,null),default));Assert.Equal("image_not_ready",rejected.Code);
            var image=new SanitizedImage(32,32,digest,PublicImagePaths.Names.Select(name=>new SanitizedVariant(name,32,32,bytes,digest)).ToArray());await repository.ReadyAsync(asset,image,default);
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var repository=scope.ServiceProvider.GetRequiredService<IPublicImageRepository>();var ready=await repository.FindReadyAsync(id,default);Assert.NotNull(ready);Assert.Equal(3,ready.Variants.Count);Assert.NotEmpty(ready.Version);
            var service=scope.ServiceProvider.GetRequiredService<ICatalogService>();var brand=await service.SaveBrandAsync(null,new("Ready image", "ready-"+id,PublicImagePaths.Url(id,"card"),true,null),default);
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Equal(PublicImagePaths.Url(id,"card"),(await db.Brands.SingleAsync(b=>b.Id==brand)).LogoUrl);
            var stale=await db.PublicImages.SingleAsync(a=>a.Id==id);await db.PublicImages.Where(a=>a.Id==id).ExecuteUpdateAsync(s=>s.SetProperty(a=>a.Status,"Failed"));
            stale.Status="Failed";await Assert.ThrowsAsync<DbUpdateConcurrencyException>(()=>db.SaveChangesAsync());
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            Assert.Null(await scope.ServiceProvider.GetRequiredService<IPublicImageRepository>().FindReadyAsync(id,default));
            var rejected=await Assert.ThrowsAsync<BusinessException>(()=>scope.ServiceProvider.GetRequiredService<ICatalogService>().SaveBrandAsync(null,new("Failed image","failed-"+id,PublicImagePaths.Url(id,"card"),true,null),default));Assert.Equal("image_not_ready",rejected.Code);
        }
    }
}
