using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Shop.SharedKernel;
namespace Shop.Modules.Files;

public static partial class PrivateFileRules
{
    public const int MaxBytes=8*1024*1024,EnvelopeOverhead=32;
    public static readonly string[] ContentTypes=["image/jpeg","image/png","image/webp","application/pdf"];
    public static BusinessException Invalid()=>new("invalid_private_file","Use a supported private document with a simple filename and valid scope.");
    public static BusinessException Unavailable()=>new("private_file_unavailable","Private document storage is unavailable.");
    public static void Id(string value){if(value is null||!IdPattern().IsMatch(value)||value.All(c=>c=='0'))throw Invalid();}
    public static string Actor(string value){if(string.IsNullOrEmpty(value)||value.Length>64||value.Trim()!=value||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw Invalid();return value.ToUpperInvariant();}
    public static PrivateFileScope Scope(PrivateFileScope value){if(value.Kind is not("support"or"credit"))throw Invalid();Id(value.ResourceId);return value with{OwnerId=Actor(value.OwnerId)};}
    public static string Hash(ReadOnlySpan<byte> value)=>Convert.ToHexString(SHA256.HashData(value));
    public static string Key(string id){Id(id);return "private-documents/v1/"+id+".bin";}
    public static string Filename(string value){if(string.IsNullOrWhiteSpace(value)||value.Length>160||value.Trim()!=value||value.Any(c=>char.IsControl(c)||char.IsSurrogate(c)||c is '/'or'\\'or':'or'"'or'<'or'>'||c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')||value!=value.Normalize(NormalizationForm.FormC)||value.StartsWith('.')||value.EndsWith('.'))throw Invalid();return value;}
    public static void Input(PrivateFileInput input)
    {
        Actor(input.ActorId);Id(input.CommandId);Filename(input.Filename);if(!IsHash(input.IntentHash))throw Invalid();
        Version(input.ResourceVersion);
        Content(input.Filename,input.ContentType,input.Bytes);
    }
    public static void Version(string value){if(value is null)throw Invalid();try{var bytes=Convert.FromBase64String(value);if(bytes.Length!=8||Convert.ToBase64String(bytes)!=value)throw Invalid();}catch(FormatException){throw Invalid();}}
    public static bool IsHash(string value)=>value is{Length:64}&&value.All(char.IsAsciiHexDigitUpper);
    public static void Content(string filename,string contentType,byte[] content)
    {
        Filename(filename);if(content is null||content.Length is <16 or >MaxBytes)throw Invalid();
        var bytes=content.AsSpan();var ext=Path.GetExtension(filename).ToLowerInvariant();var valid=contentType switch{
            "image/jpeg"=>ext is ".jpg"or".jpeg"&&bytes.StartsWith(new byte[]{255,216,255})&&bytes[^2]==255&&bytes[^1]==217,
            "image/png"=>ext==".png"&&bytes.StartsWith(new byte[]{137,80,78,71,13,10,26,10}),
            "image/webp"=>ext==".webp"&&bytes[..4].SequenceEqual("RIFF"u8)&&bytes.Slice(8,4).SequenceEqual("WEBP"u8),
            "application/pdf"=>ext==".pdf"&&bytes.StartsWith("%PDF-"u8)&&bytes[^Math.Min(1024,bytes.Length)..].IndexOf("%%EOF"u8)>=0,
            _=>false};if(!valid)throw Invalid();
    }
    public static string Payload(PrivateFileScope scope,PrivateFileInput input)=>Hash(Encoding.UTF8.GetBytes(string.Join('\n',"1",scope.Kind,scope.ResourceId,scope.OwnerId,Actor(input.ActorId),input.CommandId,input.ResourceVersion,input.IntentHash,input.Filename,input.ContentType,input.Bytes.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),Hash(input.Bytes))));
    [GeneratedRegex("^[a-f0-9]{32}$",RegexOptions.CultureInvariant)]private static partial Regex IdPattern();
}
