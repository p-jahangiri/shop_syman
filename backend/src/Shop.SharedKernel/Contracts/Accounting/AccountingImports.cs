using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
namespace Shop.SharedKernel;

// Sayman normalized staging format. This is not a vendor-native Holoo format.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AccountingImportRowInput(string ExternalItemId,string? ExternalCode,string? ExternalName,string ExternalUnitKey,string? QuantityRaw,string? PriceRaw);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AccountingImportInput(int SchemaVersion,string CompanyKey,string ExternalWarehouseKey,string QuantityMeaning,string PriceCurrency,DateTimeOffset ObservedAt,bool IsDemo,AccountingImportRowInput[] Rows);
public sealed record AccountingImportSummary(string Id,string CompanyKey,string ExternalWarehouseKey,string QuantityMeaning,string PriceCurrency,DateTimeOffset ObservedAt,DateTimeOffset CreatedAt,bool IsDemo,int RowCount,string PayloadHash);
public sealed record AccountingImportPage(int SchemaVersion,int PageSize,AccountingImportSummary[] Items,string? NextCursor);
public sealed record AccountingImportMatch(string LinkId,string LinkVersion,string VariantId,string Sku,string NameFa,string NameEn,string PriceRial,bool IsActive,bool IsDigital,string ProductStatus);
public sealed record AccountingImportRowDto(int RowNumber,string ExternalItemId,string? ExternalCode,string? ExternalName,string ExternalUnitKey,string? QuantityRaw,string? PriceRaw,int? Quantity,string? PriceRial,AccountingImportMatch? CurrentMatch,string? PriceDifferenceRial,string[] Issues);
public sealed record AccountingImportDetail(int SchemaVersion,AccountingImportSummary Batch,AccountingImportRowDto[] Rows,bool CanApply,bool CanSyncLive);
public sealed record AccountingImportSaved(int SchemaVersion,string Id,string PayloadHash,bool Replayed,bool Applied);
public interface IAccountingImports
{
    Task<AccountingImportSaved> StageAsync(string id,AccountingImportInput input,string actorId,CancellationToken ct);
    Task<AccountingImportDetail> ReadAsync(string id,CancellationToken ct);
    Task<AccountingImportPage> PageAsync(string? companyKey,string? cursor,CancellationToken ct,string? externalWarehouseKey=null);
}
public static class AccountingImportRules
{
    private static readonly Regex Number=new("^[0-9]{1,20}$",RegexOptions.CultureInvariant|RegexOptions.NonBacktracking);
    public static void Validate(AccountingImportInput input,DateTimeOffset now,bool demoAllowed)
    {
        if(input is null||input.SchemaVersion!=1||input.Rows is not {Length:>=1 and <=200}||input.Rows.Any(r=>r is null))throw Invalid();
        AccountingLinkRules.Key(input.CompanyKey,64);AccountingLinkRules.Key(input.ExternalWarehouseKey,64);
        if(input.QuantityMeaning is not ("physical" or "available" or "unknown")||input.PriceCurrency is not ("IRR" or "IRT" or "unknown")||input.ObservedAt.Offset!=TimeSpan.Zero||input.ObservedAt< DateTimeOffset.UnixEpoch||input.ObservedAt>now||input.IsDemo&&!demoAllowed)throw Invalid();
        var unique=new HashSet<string>(StringComparer.Ordinal);
        foreach(var row in input.Rows){
            AccountingLinkRules.Key(row.ExternalItemId,120);AccountingLinkRules.Key(row.ExternalUnitKey,64);
            if(row.ExternalCode is not null)AccountingLinkRules.Key(row.ExternalCode,120);
            if(row.ExternalName is not null)AccountingLinkRules.Key(row.ExternalName,300);
            if(!unique.Add(row.ExternalItemId))throw Invalid();
            foreach(var value in new[]{row.QuantityRaw,row.PriceRaw})if(value is not null&&(value.Length is <1 or >64||value.Any(char.IsControl)||value.Trim()!=value))throw Invalid();
        }
    }
    public static string Hash(AccountingImportInput input)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
    public static (int? Quantity,string? PriceRial,string[] Issues) Inspect(string? quantity,string? price,string meaning,string currency)
    {
        var issues=new List<string>();int? q=null;string? rial=null;
        if(quantity is null)issues.Add("quantity_missing");
        else if(!Number.IsMatch(quantity)||!int.TryParse(quantity,NumberStyles.None,CultureInfo.InvariantCulture,out var parsed)||parsed>1000000)issues.Add("quantity_not_supported_integer");else q=parsed;
        if(meaning!="physical")issues.Add(meaning=="available"?"available_quantity_requires_reconciliation":"quantity_meaning_unknown");
        if(price is null)issues.Add("price_missing");
        else if(currency=="unknown")issues.Add("price_currency_unknown");
        else if(!Number.IsMatch(price)||!long.TryParse(price,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)||currency=="IRT"&&amount>long.MaxValue/10)issues.Add("price_not_supported_integer");
        else rial=(currency=="IRT"?amount*10:amount).ToString(CultureInfo.InvariantCulture);
        // No unit/warehouse semantics are inferred from an external label.
        issues.Add("unit_mapping_required");issues.Add("warehouse_mapping_required");issues.Add("apply_not_available");return(q,rial,issues.ToArray());
    }
    private static BusinessException Invalid()=>new("invalid_accounting_import","Use normalized Sayman format v1, an explicit company/warehouse/unit, a non-future UTC observation, supported metadata and 1–200 unique stable item identifiers. Demo imports are Development-only.");
}
