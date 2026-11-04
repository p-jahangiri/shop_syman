using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsRedirectWrite(string Action,string? Version=null,string? SourcePath=null,bool? IsDemo=null,string? TargetPath=null,[property:JsonNumberHandling(JsonNumberHandling.Strict)]int? Status=null,string? RestoreRevisionId=null,bool Confirmed=false);
public sealed record CmsRedirectDraft([property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? TargetPath,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? Status);
public sealed record CmsRedirectPublication(string Id,int Publication,string Action,string TargetPath,int Status,DateTimeOffset At);
public sealed record CmsRedirectDetail(string Id,string SourcePath,bool IsDemo,string Version,int Publication,CmsRedirectDraft Draft,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CmsRedirectPublication? Published);
public sealed record CmsRedirectListItem(string Id,string SourcePath,bool IsDemo,string Version,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PublishedRevisionId,DateTimeOffset UpdatedAt);
public sealed record CmsRedirectList(IReadOnlyList<CmsRedirectListItem> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CmsRedirectHistory(IReadOnlyList<CmsRedirectPublication> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record CmsRedirectRevisionDetail(string RedirectId,string SourcePath,bool IsDemo,CmsRedirectPublication Revision);
public sealed record CmsRedirectPreview(string RedirectId,string SourcePath,bool IsDemo,string Version,CmsRedirectDraft Draft,bool CanPublish,IReadOnlyList<string> Blockers,IReadOnlyList<string> Chain);
public sealed record CmsRedirectResult(string CommandId,string RedirectId,string SourcePath,bool IsDemo,string Version,string Action,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? RevisionId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PublishedRevisionId,CmsRedirectDraft Draft,bool Replayed);
public sealed record CmsRedirectResolution(int Version,string DataSource,string SourcePath,bool Found,bool IsDemo,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? TargetPath,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? Status);
public static partial class CmsRedirectRules
{
    public const int MaximumHeads=10000,MaximumRevisions=10000,MaximumHops=5;
    [GeneratedRegex("^/(fa|en)/(product|pages)/[a-z0-9]+(?:-[a-z0-9]+)*\\z",RegexOptions.CultureInvariant)]private static partial Regex SourcePattern();
    [GeneratedRegex("^/(fa|en)(?:/(catalog|moments|support))?\\z",RegexOptions.CultureInvariant)]private static partial Regex LandingPattern();
    public static BusinessException Invalid()=>new("invalid_cms_redirect","Check public paths, status and explicit publication confirmation.");
    public static BusinessException Changed()=>new("cms_redirect_changed_conflict","The saved redirect changed; reload before writing.");
    public static BusinessException Unavailable()=>new("cms_redirect_unavailable","Redirect facts could not be verified.");
    public static BusinessException Missing()=>new("not_found","Redirect or revision was not found.");
    public static string Id(string value){try{return CmsPageRules.Id(value);}catch(BusinessException){throw Invalid();}}
    public static string Actor(string value){try{return CmsPageRules.Actor(value);}catch(BusinessException){throw Invalid();}}
    public static T Read<T>(string json){try{return CmsPageRules.Read<T>(json);}catch(BusinessException){throw Unavailable();}}
    public static string Source(string value)
    {
        if(value is null||value.Length>192||!SourcePattern().IsMatch(value))throw Invalid();var parts=value.Split('/');if(parts[3].Length>(parts[2]=="pages"?80:150))throw Invalid();return value;
    }
    public static string Target(string source,string value)
    {
        Source(source);if(value is null||value.Length>192||!(LandingPattern().IsMatch(value)||SourcePattern().IsMatch(value)))throw Invalid();if(value.Length>=4&&SourcePattern().IsMatch(value))Source(value);if(source.AsSpan(1,2).SequenceEqual(value.AsSpan(1,2))&&value!=source)return value;throw Invalid();
    }
    public static void Draft(string source,string? target,int? status){Source(source);if(target is not null)Target(source,target);if(status is not null and not(301 or 302))throw Invalid();}
    public static string FactsHash(string source,string target,int status){Draft(source,target,status);return CmsPageRules.Digest(CmsPageRules.Serialize(new{sourcePath=source,targetPath=target,status}));}
    public static void Input(CmsRedirectWrite input,bool create)
    {
        if(input is null)throw Invalid();if(create){if(input.Action!="Create"||input.SourcePath is null||input.IsDemo is null||input.Version is not null||input.RestoreRevisionId is not null||input.Confirmed)throw Invalid();Draft(input.SourcePath,input.TargetPath,input.Status);return;}
        if(input.SourcePath is not null||input.IsDemo is not null||input.Version is null)throw Invalid();try{if(Convert.FromBase64String(input.Version).Length!=8||Convert.ToBase64String(Convert.FromBase64String(input.Version))!=input.Version)throw Invalid();}catch(FormatException){throw Invalid();}
        switch(input.Action){case "Save":if(input.RestoreRevisionId is not null||input.Confirmed)throw Invalid();break;
            case "Publish":case "Unpublish":if(!input.Confirmed||input.TargetPath is not null||input.Status is not null||input.RestoreRevisionId is not null)throw Invalid();break;
            case "Restore":if(!input.Confirmed||input.TargetPath is not null||input.Status is not null||input.RestoreRevisionId is null)throw Invalid();Id(input.RestoreRevisionId);break;default:throw Invalid();}
    }
    public static IReadOnlyList<string> Graph(IReadOnlyDictionary<string,string> graph)
    {
        if(graph.Count>MaximumHeads)throw new BusinessException("cms_redirect_capacity_unavailable","Redirect registry exceeds its technical capacity.");
        // Functional graph: memoized path lengths avoid quadratic traversal
        // for long rejected chains and detect cycles of any permitted size.
        var lengths=new Dictionary<string,int>(StringComparer.Ordinal);var cycle=false;var longChain=false;
        foreach(var start in graph.Keys){
            if(lengths.ContainsKey(start))continue;var path=new List<string>();var visited=new HashSet<string>(StringComparer.Ordinal);var node=start;int tail;
            while(true){if(lengths.TryGetValue(node,out tail))break;if(!graph.TryGetValue(node,out var next)){tail=0;break;}if(!visited.Add(node)){cycle=true;tail=-1;break;}path.Add(node);node=next;}
            for(var i=path.Count-1;i>=0;i--){tail=tail<0?-1:Math.Min(MaximumHops+1,tail+1);lengths[path[i]]=tail;if(tail>MaximumHops)longChain=true;}
        }
        return(cycle,longChain)switch{(true,true)=>["cycle","chain_too_long"],(true,false)=>["cycle"],(false,true)=>["chain_too_long"],_=>[]};
    }
    public static IReadOnlyList<string> Chain(string source,IReadOnlyDictionary<string,string> graph)
    {
        var result=new List<string>{source};var seen=new HashSet<string>(StringComparer.Ordinal){source};var node=source;for(var i=0;i<=MaximumHops;i++){if(!graph.TryGetValue(node,out var next))break;result.Add(next);if(!seen.Add(next))break;node=next;}return result;
    }
}
