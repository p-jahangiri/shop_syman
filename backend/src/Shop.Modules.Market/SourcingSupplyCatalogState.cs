using Shop.SharedKernel;

namespace Shop.Modules.Market;

public static class SourcingSupplyCatalogState
{
    // A valid Catalog graph can outgrow the offer snapshot budget. It no longer
    // proves consent to new procurement, but it must not erase a physical arrival.
    // Connectivity, concurrency, authorization and cancellation still fail.
    public static async Task<IReadOnlyDictionary<string,OfferSkuSnapshot>?> ReadAsync(ICatalogOfferReader catalog,string[] ids,CancellationToken ct)
    {
        try{return await catalog.ReadAsync(ids,ct);}
        catch(BusinessException error)when(error.Code=="catalog_unavailable"){return null;}
    }
}
