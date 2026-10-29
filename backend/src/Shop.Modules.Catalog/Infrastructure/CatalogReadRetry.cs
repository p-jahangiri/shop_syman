using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;
// Only retries read-only materialization failures caused by catalogue version drift.
public static class CatalogReadRetry
{
    public const int Attempts=2;
    public static async Task<T> RunAsync<T>(Func<CancellationToken,Task<T>> read,CancellationToken ct)
    {
        for(var attempt=0;attempt<Attempts;attempt++){
            ct.ThrowIfCancellationRequested();
            try{return await read(ct);}
            catch(BusinessException e)when(e.Code=="version_conflict"){
                ct.ThrowIfCancellationRequested();
                if(attempt==Attempts-1)throw new BusinessException("catalog_unavailable","Catalogue data is changing. Retry this read shortly.");
            }
        }
        throw new InvalidOperationException("Catalogue read retry budget was exhausted.");
    }
}
