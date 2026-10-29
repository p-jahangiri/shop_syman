using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Market;
public sealed record MarketCsvRow(int Number,Dictionary<string,string> Cells);
public sealed record MarketCsvTable(string[] Headers,MarketCsvRow[] Rows);
public static partial class MarketCsv
{
    public const int MaxBytes=128*1024;
    public const int MaxRows=50;
    private static readonly string[] Required=["source_key","source_item_key","status","source_name_fa","source_name_en","availability","is_demo","category_id","brand_id","slug","name_fa","name_en","image_urls","source_url","observed_at","valid_until","reference_price_rial"];
    public static readonly string[] Columns=[..Required,"model_id","description_fa","description_en"];
    [GeneratedRegex("^attr\\.([a-z0-9]+(?:-[a-z0-9]+)*)\\.(fa|en|number|bool|option_id|option_ids|clear)$",RegexOptions.CultureInvariant)]private static partial Regex AttributeHeader();
    public static (string Key,string Part)? Attribute(string header){var match=AttributeHeader().Match(header);return match.Success?(match.Groups[1].Value,match.Groups[2].Value):null;}
    public static MarketCsvTable Parse(string? csv)=>ParseCore(csv,Required,Columns,true);
    internal static MarketCsvTable ParseFixed(string? csv,string[] columns)=>ParseCore(csv,columns,columns,false);
    private static MarketCsvTable ParseCore(string? csv,string[] required,string[] supported,bool attributes)
    {
        if(string.IsNullOrWhiteSpace(csv)||Encoding.UTF8.GetByteCount(csv)>MaxBytes||csv.Contains('\0')||csv.Contains('\uFFFD'))throw Invalid("Use a nonempty UTF-8 CSV up to 128 KiB.");
        if(csv[0]=='\uFEFF')csv=csv[1..];
        var records=new List<string[]>();var fields=new List<string>();var cell=new StringBuilder();var quoted=false;var closed=false;var atStart=true;
        void Field(){if(cell.Length>8000)throw Invalid("A CSV field exceeds 8000 characters.");fields.Add(cell.ToString());cell.Clear();closed=false;atStart=true;if(fields.Count>160)throw Invalid("Use up to 160 columns.");}
        void Record(){Field();if(fields.Any(f=>!string.IsNullOrWhiteSpace(f)))records.Add(fields.ToArray());fields.Clear();if(records.Count>MaxRows+1)throw Invalid("Use up to 50 data rows.");}
        for(var i=0;i<csv.Length;i++){
            var c=csv[i];
            if(quoted){if(c=='"'){if(i+1<csv.Length&&csv[i+1]=='"'){cell.Append('"');i++;}else{quoted=false;closed=true;}}else cell.Append(c);continue;}
            if(c==','){Field();continue;}
            if(c is '\r' or '\n'){Record();if(c=='\r'&&i+1<csv.Length&&csv[i+1]=='\n')i++;continue;}
            if(closed)throw Invalid("Only a delimiter or line ending may follow a closing quote.");
            if(c=='"'){if(!atStart)throw Invalid("Quotes inside an unquoted field must be escaped.");quoted=true;atStart=false;continue;}
            cell.Append(c);atStart=false;
        }
        if(quoted)throw Invalid("A quoted field is not closed.");if(cell.Length>0||closed||fields.Count>0)Record();
        if(records.Count<2)throw Invalid("Include a header and at least one data row.");
        var headers=records[0].Select(h=>h.Trim().ToLowerInvariant()).ToArray();
        if(headers.Any(h=>h.Length is <1 or >120)||headers.Distinct(StringComparer.Ordinal).Count()!=headers.Length||required.Any(h=>!headers.Contains(h))||headers.Any(h=>!supported.Contains(h)&&(!attributes||Attribute(h) is null)))throw Invalid("Use unique supported headers and include every required column.");
        if(headers.Where(h=>Attribute(h) is not null).Select(h=>Attribute(h)!.Value.Key).Distinct().Count()>64)throw Invalid("Use up to 64 attribute keys.");
        var rows=new List<MarketCsvRow>();
        for(var i=1;i<records.Count;i++){
            if(records[i].Length!=headers.Length)throw Invalid($"Record {i+1} has a different column count.");
            rows.Add(new(i+1,headers.Zip(records[i]).ToDictionary(p=>p.First,p=>p.Second.Trim(),StringComparer.Ordinal)));
        }
        return new(headers,rows.ToArray());
    }
    public static string Digits(string value)=>string.Concat(value.Select(c=>c is >= '\u06F0' and <= '\u06F9'?(char)('0'+c-'\u06F0'):c is >= '\u0660' and <= '\u0669'?(char)('0'+c-'\u0660'):c));
    public static bool Boolean(string value)=>Digits(value).ToLowerInvariant() switch{"true" or "1" or "بله"=>true,"false" or "0" or "خیر"=>false,_=>throw Invalid("Use true/false or 1/0 for boolean fields.")};
    public static decimal Number(string value)=>decimal.TryParse(Digits(value).Replace('٫','.'),NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var number)?number:throw Invalid("Use a decimal number without grouping or exponent notation.");
    public static DateTimeOffset? Date(string value)
    {
        if(value.Length==0)return null;
        if(!Regex.IsMatch(value,@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$",RegexOptions.CultureInvariant)||!DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.None,out var date))throw Invalid("Use an ISO timestamp with Z or an explicit UTC offset.");
        return date.ToUniversalTime();
    }
    public static string[] List(string value)=>value.Length==0?[]:value.Split('|').Select(v=>v.Trim()).ToArray();
    public static string Escape(string value)=>value.IndexOfAny([',','"','\r','\n'])>=0?'"'+value.Replace("\"","\"\"")+'"':value;
    private static BusinessException Invalid(string message)=>new("invalid_market_csv",message);
}
