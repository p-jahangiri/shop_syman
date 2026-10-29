using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public record ImageReconciliationResult(int Examined,int Claimed,int Purged,int Failed);

public sealed class PublicImageReconciler(CatalogDbContext db,IPublicImageStore store,TimeProvider clock,ILogger<PublicImageReconciler> logger)
{
    // Ready assets are retained, including unreferenced images from unsaved forms.
    // A missing acknowledgement from Ready is never permission to delete objects.
    public async Task<ImageReconciliationResult> RunAsync(int batchSize,CancellationToken ct)
    {
        if(batchSize is <1 or >100)throw new ArgumentOutOfRangeException(nameof(batchSize));
        if(!store.Configured)throw new BusinessException("media_unavailable","Configure image storage before reconciliation.");
        var now=clock.GetUtcNow();var cutoff=now.AddHours(-24);var retryBefore=now.AddHours(-1);
        var candidates=await db.PublicImages.AsNoTracking().Where(a=>
            ((a.Status=="Staged"||a.Status=="Failed")&&a.CreatedAt<=cutoff&&(a.LastCleanupAt==null||a.LastCleanupAt<=retryBefore))||
            (a.Status=="Cleaning"&&a.CleanupLeaseExpiresAt<=now))
            .OrderBy(a=>a.LastCleanupAt).ThenBy(a=>a.CreatedAt).ThenBy(a=>a.Id)
            .Select(a=>new{a.Id,a.Version}).Take(batchSize).ToArrayAsync(ct);
        var claimed=0;var purged=0;var failed=0;
        foreach(var candidate in candidates){
            ct.ThrowIfCancellationRequested();var lease=Guid.NewGuid().ToString("N");var started=clock.GetUtcNow();
            // The rowversion predicate prevents competing cleanup workers or a
            // concurrent Ready commit from both claiming the same staged row.
            var won=await db.PublicImages.Where(a=>a.Id==candidate.Id&&a.Version==candidate.Version&&a.Status!="Ready"&&a.Status!="Purged")
                .ExecuteUpdateAsync(s=>s.SetProperty(a=>a.Status,"Cleaning").SetProperty(a=>a.CleanupLeaseId,lease)
                    .SetProperty(a=>a.CleanupLeaseExpiresAt,started.AddMinutes(5)).SetProperty(a=>a.LastCleanupAt,started),ct);
            if(won==0)continue;claimed++;
            try{
                using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(30));
                foreach(var name in PublicImagePaths.Names)await store.DeleteAsync(candidate.Id,name,deadline.Token);
                var finished=await FinishAsync(candidate.Id,lease,"Purged",ct);if(finished==1)purged++;
            }catch(Exception e)when(e is not OutOfMemoryException){
                failed++;logger.LogWarning("Public image cleanup {AssetId} failed with {ExceptionType}",candidate.Id,e.GetType().Name);
                using var finalize=new CancellationTokenSource(TimeSpan.FromSeconds(8));
                try{await FinishAsync(candidate.Id,lease,"Failed",finalize.Token);}
                catch(Exception finishError)when(finishError is not OutOfMemoryException){logger.LogWarning("Public image cleanup lease {AssetId} awaits expiry after {ExceptionType}",candidate.Id,finishError.GetType().Name);}
                if(ct.IsCancellationRequested)throw;
            }
        }
        return new(candidates.Length,claimed,purged,failed);
    }
    private Task<int> FinishAsync(string id,string lease,string status,CancellationToken ct)=>db.PublicImages
        .Where(a=>a.Id==id&&a.Status=="Cleaning"&&a.CleanupLeaseId==lease)
        .ExecuteUpdateAsync(s=>s.SetProperty(a=>a.Status,status).SetProperty(a=>a.LastCleanupAt,clock.GetUtcNow())
            .SetProperty(a=>a.CleanupLeaseId,(string?)null).SetProperty(a=>a.CleanupLeaseExpiresAt,(DateTimeOffset?)null),ct);
}
