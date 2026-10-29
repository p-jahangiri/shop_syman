using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketAttributeSelection(string Key,string[] Values);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketFiltersInput(string CategoryId);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketValuesInput(MarketSearchInput Search,string Key,string? Query=null,int Page=1,int PageSize=20,string[]? SelectedValues=null);
public sealed record MarketAttributeDefinition(string Key,string Label,string DataType,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Unit);
public sealed record MarketFilters(int SchemaVersion,string Locale,string CategoryId,MarketAttributeDefinition[] Filters,bool MoreFilters,string Version);
public sealed record MarketAttributeValue(string Value,string Label,int Count);
public sealed record MarketValuesPage(int SchemaVersion,string Locale,MarketFacetScope Scope,string Key,string ValueQuery,MarketAttributeValue[] Values,MarketAttributeValue[] SelectedValues,int Total,int Page,int PageSize,int TotalPages);

public static class MarketAttributeRules
{
    public static bool Key(string? key)=>key is {Length:>0 and <=150}&&key.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_');
    public static bool Value(string? value)=>value is {Length:>0 and <=2000}&&!value.Any(c=>char.IsControl(c)&&!char.IsWhiteSpace(c));
    public static void Validate(MarketSearchInput input)
    {
        var attributes=input.Attributes??[];
        if(attributes.Length>8||attributes.Any(a=>a is null||!Key(a.Key)||a.Values is not {Length:>0 and <=20}||a.Values.Any(v=>!Value(v))||a.Values.Distinct(StringComparer.Ordinal).Count()!=a.Values.Length)||attributes.Select(a=>a.Key).Distinct(StringComparer.Ordinal).Count()!=attributes.Length||attributes.Length>0&&input.CategoryId is null)throw Invalid();
    }
    public static decimal Number(string value)
    {
        var normalized=PersianText.Normalize(value);
        if(!decimal.TryParse(normalized,NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var number)||decimal.Abs(number)>=100000000000000000000m||decimal.Round(number,8)!=number)throw Invalid();
        return number;
    }
    public static string[] ValuesQuery(MarketValuesInput input)
    {
        if(input.Search is null||input.Search.CategoryId is null||!Key(input.Key)||input.Query?.Length>100||input.Query?.Any(c=>char.IsControl(c)&&!char.IsWhiteSpace(c))==true||input.Page is <1 or >10000||input.PageSize is <1 or >40||input.SelectedValues is {Length:>20}||input.SelectedValues?.Any(v=>!Value(v))==true||input.SelectedValues?.Distinct(StringComparer.Ordinal).Count()!=input.SelectedValues?.Length)throw Invalid();
        MarketRules.Search(input.Search);var tokens=PersianText.Normalize(input.Query??"").Split(' ',StringSplitOptions.RemoveEmptyEntries);
        if(tokens.Length>8)throw Invalid();return tokens;
    }
    public static BusinessException Invalid()=>new("invalid_market_attribute","Choose a category and supported bounded typed model attributes.");
}

public sealed partial class MarketService
{
    private IQueryable<CatalogMarketFilterV1> FilterDefinitions=>db.Database.SqlQueryRaw<CatalogMarketFilterV1>("SELECT * FROM [catalog].[MarketFiltersV1]");
    private IQueryable<CatalogMarketAttributeV1> AttributeRows=>db.Database.SqlQueryRaw<CatalogMarketAttributeV1>("SELECT * FROM [catalog].[MarketAttributeValuesV1]");
    private IQueryable<CatalogMarketOptionV1> FilterOptions=>db.Database.SqlQueryRaw<CatalogMarketOptionV1>("SELECT * FROM [catalog].[MarketFilterOptionsV1]");
    private static MarketAttributeSelection[]? Selections(MarketSearchInput input)=>input.Attributes is {Length:>0}?input.Attributes:null;
    private static MarketFacetScope Scope(MarketSearchInput input)=>new(input.Query??"",input.CategoryId,input.BrandId,Selections(input));
    private static string Stamp(CatalogMarketFilterV1[] definitions)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(definitions.OrderBy(d=>d.Key,StringComparer.Ordinal)))));
    private static string Type(string type)=>char.ToLowerInvariant(type[0])+type[1..];
    private async Task<CatalogMarketFilterV1[]> AttributeDefinitionsAsync(MarketSearchInput input,CancellationToken ct,string? extraKey=null)
    {
        var keys=(input.Attributes??[]).Select(a=>a.Key).Concat(extraKey is null?[]:new[]{extraKey}).Distinct(StringComparer.Ordinal).ToArray();
        if(keys.Length==0)return [];
        if(input.CategoryId is null)throw MarketAttributeRules.Invalid();
        var definitions=await FilterDefinitions.Where(d=>d.CategoryId==input.CategoryId&&keys.Contains(d.Key)).OrderBy(d=>d.Key).Take(10).ToArrayAsync(ct);
        if(definitions.Length!=keys.Length||keys.Any(key=>!definitions.Any(d=>d.Key==key)))throw MarketAttributeRules.Invalid();
        foreach(var selection in input.Attributes??[])await ValidateValuesAsync(definitions.Single(d=>d.Key==selection.Key),selection.Values,ct);
        return definitions;
    }
    private async Task ValidateValuesAsync(CatalogMarketFilterV1 definition,string[] values,CancellationToken ct)
    {
        switch(definition.DataType){
            case "Number":foreach(var value in values)MarketAttributeRules.Number(value);break;
            case "Bool":if(values.Any(v=>v is not ("true" or "false")))throw MarketAttributeRules.Invalid();break;
            case "Select":case "MultiSelect":
                if(values.Any(v=>v.Length>64))throw MarketAttributeRules.Invalid();
                var known=await FilterOptions.Where(o=>o.AttributeId==definition.AttributeId&&values.Contains(o.Id)).Select(o=>o.Id).Take(21).ToArrayAsync(ct);
                if(known.Length!=values.Length||values.Any(v=>!known.Contains(v,StringComparer.Ordinal)))throw MarketAttributeRules.Invalid();break;
            case "Text":break;
            default:throw MarketAttributeRules.Invalid();
        }
    }
    private async Task EnsureAttributeDefinitionsAsync(string? categoryId,CatalogMarketFilterV1[] definitions,CancellationToken ct)
    {
        if(definitions.Length==0)return;var keys=definitions.Select(d=>d.Key).ToArray();
        var fresh=await FilterDefinitions.Where(d=>d.CategoryId==categoryId&&keys.Contains(d.Key)).OrderBy(d=>d.Key).ToArrayAsync(ct);
        if(Stamp(fresh)!=Stamp(definitions))throw Changed();
    }
    private IQueryable<CatalogMarketModelV1> ApplyAttributes(IQueryable<CatalogMarketModelV1> models,MarketSearchInput input,CatalogMarketFilterV1[] definitions,string? except=null)
    {
        if(Selections(input) is null)return models;
        models=models.Where(m=>m.CategoryId==input.CategoryId);
        foreach(var selection in input.Attributes!){
            if(selection.Key==except)continue;
            var definition=definitions.Single(d=>d.Key==selection.Key);var id=definition.AttributeId;var type=definition.DataType;var values=selection.Values;
            var rows=AttributeRows.Where(r=>r.CategoryId==input.CategoryId&&r.AttributeId==id&&r.DataType==type);
            switch(type){
                case "Text":rows=rows.Where(r=>values.Contains(r.TextFa!)||values.Contains(r.TextEn!));break;
                case "Number":var numbers=values.Select(MarketAttributeRules.Number).ToArray();rows=rows.Where(r=>r.Number!=null&&numbers.Contains(r.Number.Value));break;
                case "Bool":var flags=values.Select(bool.Parse).ToArray();rows=rows.Where(r=>r.Bool!=null&&flags.Contains(r.Bool.Value));break;
                case "Select":case "MultiSelect":rows=rows.Where(r=>values.Contains(r.OptionId!));break;
                default:throw MarketAttributeRules.Invalid();
            }
            var ids=rows.Select(r=>r.ModelId);models=models.Where(m=>ids.Contains(m.ModelId));
        }
        return models;
    }
    private static async Task<T> AttributeReadAsync<T>(Func<Task<T>> read,CancellationToken ct)
    {
        for(var attempt=0;attempt<2;attempt++)try{return await read();}catch(BusinessException e)when(e.Code is "version_conflict" or "catalog_unavailable"){
            ct.ThrowIfCancellationRequested();if(attempt==1)throw new BusinessException("market_unavailable","Model filter metadata is changing. Retry shortly.");
        }
        throw new InvalidOperationException();
    }
    public Task<MarketFilters> FiltersAsync(string locale,MarketFiltersInput input,CancellationToken ct)=>AttributeReadAsync(async()=>{
        if(locale is not ("fa" or "en"))throw MarketAttributeRules.Invalid();MarketRules.Id(input.CategoryId);
        var definitions=await FilterDefinitions.Where(d=>d.CategoryId==input.CategoryId).OrderBy(d=>d.Key).Take(65).ToArrayAsync(ct);
        await EnsureAttributeDefinitionsAsync(input.CategoryId,definitions,ct);
        return new MarketFilters(1,locale,input.CategoryId,definitions.Take(64).Select(d=>new MarketAttributeDefinition(d.Key,locale=="en"?d.NameEn:d.NameFa,Type(d.DataType),d.Unit)).ToArray(),definitions.Length>64,Stamp(definitions));
    },ct);
    public Task<MarketValuesPage> ValuesAsync(string locale,MarketValuesInput input,CancellationToken ct)=>AttributeReadAsync(async()=>{
        var tokens=MarketAttributeRules.ValuesQuery(input);if(locale is not ("fa" or "en"))throw MarketAttributeRules.Invalid();
        var definitions=await AttributeDefinitionsAsync(input.Search,ct,input.Key);var definition=definitions.Single(d=>d.Key==input.Key);var selected=input.SelectedValues??[];await ValidateValuesAsync(definition,selected,ct);
        var models=ApplyAttributes(SearchableModels(MarketRules.Search(input.Search)),input.Search,definitions,input.Key).Where(m=>m.CategoryId==input.Search.CategoryId&&PublicListings.Any(l=>l.ModelId==m.ModelId));
        if(input.Search.BrandId is not null)models=models.Where(m=>m.BrandId==input.Search.BrandId);
        var modelIds=models.Select(m=>m.ModelId);var rows=AttributeRows.Where(r=>r.CategoryId==input.Search.CategoryId&&r.AttributeId==definition.AttributeId&&r.DataType==definition.DataType&&modelIds.Contains(r.ModelId));
        var values=new List<MarketAttributeValue>();var chosen=new List<MarketAttributeValue>();var offset=(input.Page-1)*input.PageSize;int total;
        string NumberLabel(decimal number)=>number.ToString("0.########",CultureInfo.InvariantCulture)+(definition.Unit is {Length:>0}?" "+definition.Unit:"");
        if(definition.DataType=="Number"){
            var all=rows.Where(r=>r.Number!=null).GroupBy(r=>r.Number).Select(g=>new{Number=g.Key,Count=g.Select(r=>r.ModelId).Distinct().Count()});var matches=all;
            if(tokens.Length>0){var prefix=string.Join(' ',tokens);matches=matches.Where(r=>r.Number!.Value.ToString().StartsWith(prefix));}
            total=await matches.CountAsync(ct);var page=await matches.OrderBy(r=>r.Number).Skip(offset).Take(input.PageSize).ToArrayAsync(ct);
            values.AddRange(page.Select(r=>new MarketAttributeValue(r.Number!.Value.ToString("0.########",CultureInfo.InvariantCulture),NumberLabel(r.Number.Value),r.Count)));
            foreach(var value in selected){var number=MarketAttributeRules.Number(value);var count=await rows.Where(r=>r.Number==number).Select(r=>r.ModelId).Distinct().CountAsync(ct);chosen.Add(new(value,NumberLabel(number),count));}
        }else if(definition.DataType=="Bool"){
            var groups=await rows.Where(r=>r.Bool!=null).GroupBy(r=>r.Bool).Select(g=>new{Flag=g.Key,Count=g.Select(r=>r.ModelId).Distinct().Count()}).ToArrayAsync(ct);
            MarketAttributeValue Item(bool flag,int count)=>new(flag?"true":"false",flag?(locale=="en"?"Yes":"بله"):(locale=="en"?"No":"خیر"),count);
            var all=groups.Select(g=>Item(g.Flag!.Value,g.Count)).OrderBy(v=>v.Value,StringComparer.Ordinal).Where(v=>tokens.All(term=>PersianText.Normalize(v.Value+" "+v.Label+" "+(v.Value=="true"?"Yes بله":"No خیر")).Contains(term,StringComparison.Ordinal))).ToArray();
            total=all.Length;values.AddRange(all.Skip(offset).Take(input.PageSize));chosen.AddRange(selected.Select(v=>Item(bool.Parse(v),groups.FirstOrDefault(g=>g.Flag==bool.Parse(v))?.Count??0)));
        }else if(definition.DataType is "Select" or "MultiSelect"){
            var options=FilterOptions.Where(o=>o.AttributeId==definition.AttributeId);var matches=options.Where(o=>rows.Any(r=>r.OptionId==o.Id));
            foreach(var token in tokens)matches=matches.Where(o=>o.Search.Contains(token));
            total=await matches.CountAsync(ct);var page=await matches.OrderBy(o=>o.SortOrder).ThenBy(o=>o.Id).Skip(offset).Take(input.PageSize).ToArrayAsync(ct);
            var pinned=selected.Length==0?[]:await options.Where(o=>selected.Contains(o.Id)).Take(20).ToArrayAsync(ct);var ids=page.Select(o=>o.Id).Concat(selected).Distinct().ToArray();
            var counts=await rows.Where(r=>ids.Contains(r.OptionId!)).GroupBy(r=>r.OptionId).Select(g=>new{Id=g.Key,Count=g.Select(r=>r.ModelId).Distinct().Count()}).ToDictionaryAsync(g=>g.Id!,g=>g.Count,ct);
            MarketAttributeValue Item(CatalogMarketOptionV1 o)=>new(o.Id,locale=="en"?o.LabelEn:o.LabelFa,counts.GetValueOrDefault(o.Id));
            values.AddRange(page.Select(Item));chosen.AddRange(selected.Select(v=>Item(pinned.Single(o=>o.Id==v))));
        }else{
            var all=rows.Where(r=>(r.TextFa??r.TextEn)!=null&&(r.TextFa??r.TextEn)!="");var matches=all;
            foreach(var token in tokens)matches=matches.Where(r=>r.Search!=null&&r.Search.Contains(token));
            var groups=matches.GroupBy(r=>r.TextFa??r.TextEn).Select(g=>new{Value=g.Key,Label=g.Min(r=>locale=="en"?r.TextEn??r.TextFa:r.TextFa??r.TextEn),Count=g.Select(r=>r.ModelId).Distinct().Count()});
            total=await groups.CountAsync(ct);var page=await groups.OrderBy(g=>g.Value).Skip(offset).Take(input.PageSize).ToArrayAsync(ct);values.AddRange(page.Select(g=>new MarketAttributeValue(g.Value!,g.Label??g.Value!,g.Count)));
            foreach(var value in selected){var matching=all.Where(r=>r.TextFa==value||r.TextEn==value);var count=await matching.Select(r=>r.ModelId).Distinct().CountAsync(ct);var label=await matching.Select(r=>locale=="en"?r.TextEn??r.TextFa:r.TextFa??r.TextEn).OrderBy(v=>v).FirstOrDefaultAsync(ct);chosen.Add(new(value,label??value,count));}
        }
        await EnsureAttributeDefinitionsAsync(input.Search.CategoryId,definitions,ct);
        return new MarketValuesPage(1,locale,Scope(input.Search),input.Key,input.Query??"",values.ToArray(),chosen.ToArray(),total,input.Page,input.PageSize,(int)Math.Ceiling(total/(double)input.PageSize));
    },ct);
}
