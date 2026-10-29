using System.Text.Json.Serialization;

namespace Shop.Modules.Market;
// Dedicated CSV limits are enforced by MarketCsv rather than the generic
// 8000-character form-field filter. Request bodies remain bounded by Kestrel.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketCsvPreviewRequest(string Csv);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketImportExpectedInput(int RowNumber,string? ListingId,string? ListingVersion,string? ModelId,string? ModelVersion,string MetadataFingerprint);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketCsvCommitRequest(string Csv,string RequestId,MarketImportExpectedInput[] Expected);
public sealed record MarketImportIssue(string Code,string Message);
public sealed record MarketImportPreviewRow(int RowNumber,string Operation,string NameFa,string NameEn,string SourceKey,string SourceItemKey,string Status,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReferencePriceRial,bool HasStorefrontOffers,MarketImportExpectedInput? Expected,MarketImportIssue[] Issues);
public sealed record MarketImportPreview(int SchemaVersion,string FileHash,MarketImportPreviewRow[] Rows,int ValidRows,int InvalidRows,bool CanCommit);
public sealed record MarketImportSavedRow(int RowNumber,string ListingId,string ModelId,string Operation);
public sealed record MarketImportResult(int SchemaVersion,string RequestId,string PayloadHash,int Created,int Updated,MarketImportSavedRow[] Rows,bool Replayed);
public sealed class MarketImportReceipt
{
    public string ActorId {get;set;}="";
    public string RequestId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string ResponseJson {get;set;}="";
    public int RowCount {get;set;}
    public bool ContainsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
}
