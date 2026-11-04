using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Market;

public static class MarketSourceCsv
{
    public static readonly string[] Columns=["listing_id","source_id","source_key","source_item_key","status","source_name_fa","source_name_en","source_url","availability","observed_at","valid_until","reference_price_rial","is_demo"];
    public static MarketCsvTable Parse(string? csv)=>MarketCsv.ParseFixed(csv,Columns);
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourceCsvPreviewRequest(string Csv);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourceCsvExpectedInput(int RowNumber,string ListingId,string ListingVersion,string SourceId,string? SourceVersion,string ModelVersion,string MetadataFingerprint);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourceCsvCommitRequest(string Csv,string RequestId,SourceCsvExpectedInput[] Expected);
public sealed record SourceCsvPreviewRow(int RowNumber,string ListingId,string SourceId,string Operation,string NameFa,string NameEn,string SourceNameFa,string SourceNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReferencePriceRial,SourceCsvExpectedInput? Expected,MarketImportIssue[] Issues);
public sealed record SourceCsvPreview(int SchemaVersion,string FileHash,SourceCsvPreviewRow[] Rows,int ValidRows,int InvalidRows,bool CanCommit);
public sealed record SourceCsvSavedRow(int RowNumber,string ListingId,string SourceId,string Operation,string ListingVersion,string SourceVersion);
public sealed record SourceCsvResult(int SchemaVersion,string RequestId,string PayloadHash,string FileHash,int Created,int Updated,SourceCsvSavedRow[] Rows,bool Replayed);
public sealed class MarketSourceImportReceipt
{
    public string ActorId{get;set;}="";public string RequestId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";
    public int RowCount{get;set;}public bool ContainsDemo{get;set;}public DateTimeOffset RecordedAt{get;set;}
}
public static class MarketSourceCsvModel
{
    public static void Configure(ModelBuilder b)=>b.Entity<MarketSourceImportReceipt>(e=>{
        e.ToTable("SourceImportReceipts",t=>{t.HasCheckConstraint("CK_MarketSourceImport_Json","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=262144");t.HasCheckConstraint("CK_MarketSourceImport_Rows","[RowCount] BETWEEN 1 AND 50");});e.HasKey(x=>new{x.ActorId,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasColumnType("nvarchar(max)");
    });
}
