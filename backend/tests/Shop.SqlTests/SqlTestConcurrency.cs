using Xunit;
// Each fixture owns a real database and a complete application/model graph.
// Bound fixture concurrency on the 16-GiB local host; explicit Task.WhenAll
// races inside inventory/order/file tests remain unchanged.
[assembly:CollectionBehavior(MaxParallelThreads=2)]
