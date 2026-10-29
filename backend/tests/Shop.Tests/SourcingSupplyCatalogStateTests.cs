using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingSupplyCatalogStateTests
{
    [Fact] public async Task SnapshotRepresentabilityFailureRequiresNewConsentRatherThanLosingPhysicalReceiving()
    {
        var reader=new Reader(new BusinessException("catalog_unavailable","A valid snapshot exceeds its supported budget."));
        Assert.Null(await SourcingSupplyCatalogState.ReadAsync(reader,["variant"],CancellationToken.None));
    }
    [Fact] public async Task DatabaseConnectivityConcurrencyInputAndCancellationFailuresStillPropagate()
    {
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();
        Exception[] errors=[new BusinessException("version_conflict","Changed."),new BusinessException("invalid_offer_catalog","Invalid input."),new BusinessException("forbidden","Forbidden."),new InvalidOperationException("Database unavailable."),new OperationCanceledException(cancelled.Token)];
        foreach(var expected in errors){var actual=await Record.ExceptionAsync(()=>SourcingSupplyCatalogState.ReadAsync(new Reader(expected),["variant"],cancelled.Token));Assert.Same(expected,actual);}
    }
    [Fact] public async Task AvailableButMissingSkuIsNotReportedAsAReaderCapacityFailure()
    {
        var reader=new Reader(null);var result=await SourcingSupplyCatalogState.ReadAsync(reader,["missing"],CancellationToken.None);Assert.NotNull(result);Assert.Empty(result);
    }
    private sealed class Reader(Exception? error):ICatalogOfferReader
    {
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)=>error is null?Task.FromResult<IReadOnlyDictionary<string,OfferSkuSnapshot>>(new Dictionary<string,OfferSkuSnapshot>()):Task.FromException<IReadOnlyDictionary<string,OfferSkuSnapshot>>(error);
        public Task<OfferSkuPage> LookupAsync(string model,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
}
