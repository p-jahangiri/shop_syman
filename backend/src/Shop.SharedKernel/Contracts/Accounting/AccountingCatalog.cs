using System.Text.Json.Serialization;
namespace Shop.SharedKernel;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AccountingProductLinkInput(string CompanyKey,string ExternalItemId,string? ExternalCode,string VariantId,bool IsActive,string? Version);
public sealed record AccountingProductLinkDto(string Id,string CompanyKey,string ExternalItemId,string? ExternalCode,string VariantId,string Sku,string ProductId,string NameFa,string NameEn,bool IsActive,string Version);
public sealed record AccountingLinkPage(int SchemaVersion,int PageSize,AccountingProductLinkDto[] Items,string? NextCursor);
public sealed record AccountingVariantChoice(string VariantId,string Sku,string ProductId,string NameFa,string NameEn,bool IsActive);
public interface IAccountingCatalogLinks
{
    Task<AccountingLinkPage> PageAsync(string? companyKey,string? query,string? enabled,string? cursor,CancellationToken ct);
    Task<AccountingProductLinkDto> DetailAsync(string id,CancellationToken ct);
    Task<AccountingVariantChoice[]> VariantsAsync(string? query,CancellationToken ct);
    Task<string> SaveAsync(string id,AccountingProductLinkInput input,string actorId,CancellationToken ct);
}
public static class AccountingLinkRules
{
    // Provider identifiers are opaque: preserve case, leading zeroes and digit script.
    public static string Key(string? value,int max)=>value is {Length:>0}&&value.Length<=max&&value.Trim()==value&&!value.Any(char.IsControl)?value:throw Invalid();
    public static string Id(string? value)=>value is {Length:32}&&value.All(char.IsAsciiHexDigit)&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty?id.ToString("N"):throw Invalid();
    public static void Validate(AccountingProductLinkInput input){Key(input.CompanyKey,64);Key(input.ExternalItemId,120);if(input.ExternalCode is not null)Key(input.ExternalCode,120);PurchaseAdminFilter.Id(input.VariantId);if(input.Version is {Length:>24})throw Invalid();}
    private static BusinessException Invalid()=>new("invalid_accounting_link","Use a UUID link id, explicit company and stable item identifiers, an existing SKU variant and the current version. Identifiers preserve case and leading zeroes.");
}
