namespace Shop.SharedKernel;

// Catalog owns and migrates these versioned, read-only SQL contracts. Market
// composes only SELECT queries; no DbContext or write ownership crosses modules.
public sealed class CatalogMarketFilterV1
{
    public string CategoryId {get;set;}="";
    public string AttributeId {get;set;}="";
    public string Key {get;set;}="";
    public string DataType {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public string? Unit {get;set;}
    public byte[] CategoryVersion {get;set;}=[];
    public byte[] DefinitionVersion {get;set;}=[];
}
public sealed class CatalogMarketAttributeV1
{
    public string ModelId {get;set;}="";
    public string CategoryId {get;set;}="";
    public string AttributeId {get;set;}="";
    public string DataType {get;set;}="";
    public string? TextFa {get;set;}
    public string? TextEn {get;set;}
    public string? Search {get;set;}
    [System.ComponentModel.DataAnnotations.Schema.Column(TypeName="decimal(28,8)")]
    public decimal? Number {get;set;}
    public bool? Bool {get;set;}
    public string? OptionId {get;set;}
}
public sealed class CatalogMarketOptionV1
{
    public string AttributeId {get;set;}="";
    public string Id {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
    public string Search {get;set;}="";
    public int SortOrder {get;set;}
}
