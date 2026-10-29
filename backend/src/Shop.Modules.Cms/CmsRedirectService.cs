using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed class CmsRedirectService(CmsDbContext db,bool development)
{
    private async Task Gate(string key,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction is null)throw new InvalidOperationException("Redirect commands require a root transaction.");
        await using var q=db.Database.GetDbConnection().CreateCommand();q.Transaction=db.Database.CurrentTransaction.GetDbTransaction();q.CommandTimeout=15;
        q.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
        var p=q.CreateParameter();p.ParameterName="@key";p.Value="sayman:cms:redirects:v1:"+CmsPageRules.Digest(key);q.Parameters.Add(p);
        if(Convert.ToInt32(await q.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cms_redirect_busy","Retry the same redirect command.");
    }
    private IQueryable<CmsRedirect> Heads=>db.Redirects.FromSqlRaw("SELECT * FROM [cms].[Redirects] WITH (READCOMMITTEDLOCK)");
    private IQueryable<CmsRedirectRevision> Revisions=>db.RedirectRevisions.FromSqlRaw("SELECT * FROM [cms].[RedirectRevisions] WITH (READCOMMITTEDLOCK)");
    private sealed record PublishedFacts { public string SourcePath{get;init;}="";public bool IsDemo{get;init;}public int Publication{get;init;}public int RevisionPublication{get;init;}public string Action{get;init;}="";public string TargetPath{get;init;}="";public int Status{get;init;}public string FactsHash{get;init;}=""; }
    private IQueryable<PublishedFacts> Published=>from p in Heads.AsNoTracking() join r in Revisions.AsNoTracking() on new{RedirectId=p.Id,Id=p.PublishedRevisionId, p.SourcePath} equals new{r.RedirectId,Id=(string?)r.Id,r.SourcePath} select new PublishedFacts{SourcePath=p.SourcePath,IsDemo=p.IsDemo,Publication=p.Publication,RevisionPublication=r.Publication,Action=r.Action,TargetPath=r.TargetPath,Status=r.Status,FactsHash=r.FactsHash};
    private static void Facts(string source,string target,int status,string hash)
    {
        try{if(status is not(301 or 302)||CmsRedirectRules.FactsHash(source,target,status)!=hash)throw CmsRedirectRules.Unavailable();}catch(BusinessException){throw CmsRedirectRules.Unavailable();}
    }
    private static void Facts(PublishedFacts r){Facts(r.SourcePath,r.TargetPath,r.Status,r.FactsHash);if(r.Publication!=r.RevisionPublication||r.Publication is<1 or>10000||r.Action is not("Publish"or"Restore"))throw CmsRedirectRules.Unavailable();}
    private static CmsRedirectDraft Draft(CmsRedirect p){try{CmsRedirectRules.Draft(p.SourcePath,p.DraftTargetPath,p.DraftStatus);}catch(BusinessException){throw CmsRedirectRules.Unavailable();}return new(p.DraftTargetPath,p.DraftStatus);}
    private static CmsRedirectPublication Item(CmsRedirectRevision r){Facts(r.SourcePath,r.TargetPath,r.Status,r.FactsHash);if(r.Action is not("Publish"or"Restore"or"Unpublish")||r.Publication is<1 or>10000||r.At.Offset!=TimeSpan.Zero)throw CmsRedirectRules.Unavailable();return new(r.Id,r.Publication,r.Action,r.TargetPath,r.Status,r.At);}
    private static CmsRedirectResult Receipt(CmsRedirectCommand c)
    {
        if(CmsPageRules.Digest(c.ResultJson)!=c.ResultHash)throw CmsRedirectRules.Unavailable();var r=CmsRedirectRules.Read<CmsRedirectResult>(c.ResultJson);
        if(r.RedirectId!=c.RedirectId||r.CommandId!=c.CommandId||r.SourcePath!=c.SourcePath||r.Replayed||r.Action is not("Create"or"Save"or"Publish"or"Restore"or"Unpublish"))throw CmsRedirectRules.Unavailable();return r with{Replayed=true};
    }
    private async Task<Dictionary<string,string>> Graph(CancellationToken ct)
    {
        var rows=await Published.Take(CmsRedirectRules.MaximumHeads+1).ToListAsync(ct);if(rows.Count>CmsRedirectRules.MaximumHeads)throw new BusinessException("cms_redirect_capacity_unavailable","Redirect registry exceeds capacity.");var graph=new Dictionary<string,string>(StringComparer.Ordinal);foreach(var row in rows){Facts(row);graph.Add(row.SourcePath,row.TargetPath);}return graph;
    }
    public async Task<CmsRedirectResult> ReceiptAsync(string actor,string commandId,string? id,CancellationToken ct)
    {
        CmsRedirectRules.Actor(actor);CmsRedirectRules.Id(commandId);if(id is not null)CmsRedirectRules.Id(id);var c=await db.RedirectCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw CmsRedirectRules.Missing();var r=Receipt(c);if(id is null?r.Action!="Create":r.Action=="Create"||r.RedirectId!=id)throw CmsRedirectRules.Missing();return r;
    }
    public async Task<CmsRedirectResult> WriteAsync(string actor,string? id,string commandId,CmsRedirectWrite input,CancellationToken ct)
    {
        CmsRedirectRules.Actor(actor);CmsRedirectRules.Id(commandId);if(id is not null)CmsRedirectRules.Id(id);CmsRedirectRules.Input(input,id is null);
        var hash=CmsPageRules.Digest(CmsPageRules.Serialize(new{redirectId=id,input}));await Gate("command:"+actor+":"+commandId,ct);
        var prior=await db.RedirectCommands.FromSqlRaw("SELECT * FROM [cms].[RedirectCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("cms_redirect_idempotency_conflict","Command belongs to another redirect operation.");return Receipt(prior);}
        // All graph mutations take this lock before a head lock. Draft-only
        // saves never acquire graph after head, avoiding an inverted lock order.
        if(input.Action!="Save")await Gate("graph",ct);CmsRedirect p;var now=DateTimeOffset.UtcNow;
        if(id is null){if(await Heads.AnyAsync(x=>x.SourcePath==input.SourcePath,ct))throw new BusinessException("cms_redirect_source_conflict","Redirect source already exists.");if(await Heads.CountAsync(ct)>=CmsRedirectRules.MaximumHeads)throw new BusinessException("cms_redirect_capacity_conflict","Redirect registry reached capacity.");p=new(){Id=Guid.NewGuid().ToString("N"),SourcePath=input.SourcePath!,IsDemo=input.IsDemo!.Value,DraftTargetPath=input.TargetPath,DraftStatus=input.Status,CreatedBy=actor,CreatedAt=now,UpdatedBy=actor,UpdatedAt=now};db.Redirects.Add(p);await db.SaveChangesAsync(ct);}
        else{await Gate("head:"+id,ct);p=await Heads.SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsRedirectRules.Missing();if(input.Version!=Convert.ToBase64String(p.Version))throw CmsRedirectRules.Changed();_=Draft(p);}
        CmsRedirectRevision? revision=null;
        if(input.Action=="Save"){CmsRedirectRules.Draft(p.SourcePath,input.TargetPath,input.Status);p.DraftTargetPath=input.TargetPath;p.DraftStatus=input.Status;}
        else if(input.Action is "Publish"or"Restore"or"Unpublish"){
            if(p.Publication>=CmsRedirectRules.MaximumRevisions)throw new BusinessException("cms_redirect_capacity_conflict","Redirect publication history reached capacity.");string target;int status;
            if(input.Action=="Publish"){if(p.DraftTargetPath is null||p.DraftStatus is null)throw new BusinessException("cms_redirect_incomplete_conflict","Save an explicit target and status before publishing.");target=p.DraftTargetPath;status=p.DraftStatus.Value;}
            else{var rid=input.Action=="Restore"?input.RestoreRevisionId:p.PublishedRevisionId;if(rid is null)throw CmsRedirectRules.Changed();var old=await Revisions.AsNoTracking().SingleOrDefaultAsync(x=>x.RedirectId==p.Id&&x.SourcePath==p.SourcePath&&x.Id==rid,ct)??throw CmsRedirectRules.Missing();_=Item(old);if(old.Action=="Unpublish")throw CmsRedirectRules.Invalid();target=old.TargetPath;status=old.Status;}
            var graph=await Graph(ct);if(input.Action=="Unpublish")graph.Remove(p.SourcePath);else graph[p.SourcePath]=target;
            var blockers=CmsRedirectRules.Graph(graph);if(blockers.Count!=0)throw new BusinessException("cms_redirect_graph_conflict","Published redirects would form a cycle or exceed five hops.");
            revision=new(){Id=Guid.NewGuid().ToString("N"),RedirectId=p.Id,SourcePath=p.SourcePath,Publication=p.Publication+1,Action=input.Action,TargetPath=target,Status=status,FactsHash=CmsRedirectRules.FactsHash(p.SourcePath,target,status),ActorId=actor,At=now};db.RedirectRevisions.Add(revision);await db.SaveChangesAsync(ct);p.Publication=revision.Publication;p.PublishedRevisionId=input.Action=="Unpublish"?null:revision.Id;
        }
        p.UpdatedBy=actor;p.UpdatedAt=now;await db.SaveChangesAsync(ct);var result=new CmsRedirectResult(commandId,p.Id,p.SourcePath,p.IsDemo,Convert.ToBase64String(p.Version),input.Action,p.Publication,revision?.Id,p.PublishedRevisionId,Draft(p),false);var json=CmsPageRules.Serialize(result);db.RedirectCommands.Add(new(){ActorId=actor,CommandId=commandId,RedirectId=p.Id,SourcePath=p.SourcePath,PayloadHash=hash,ResultJson=json,ResultHash=CmsPageRules.Digest(json),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CmsRedirectPreview> PreviewAsync(string id,CancellationToken ct)
    {
        CmsRedirectRules.Id(id);await Gate("graph",ct);await Gate("head:"+id,ct);var p=await Heads.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsRedirectRules.Missing();var d=Draft(p);var graph=await Graph(ct);var blockers=new List<string>();if(d.TargetPath is null)blockers.Add("target_required");if(d.Status is null)blockers.Add("status_required");if(d.TargetPath is not null)graph[p.SourcePath]=d.TargetPath;else graph.Remove(p.SourcePath);blockers.AddRange(CmsRedirectRules.Graph(graph));if(p.Publication>=CmsRedirectRules.MaximumRevisions)blockers.Add("history_capacity");return new(id,p.SourcePath,p.IsDemo,Convert.ToBase64String(p.Version),d,blockers.Count==0,blockers,CmsRedirectRules.Chain(p.SourcePath,graph));
    }
    public async Task<CmsRedirectList> ListAsync(string? cursor,CancellationToken ct)
    {
        if(cursor is not null)CmsRedirectRules.Source(cursor);var rows=await db.Redirects.AsNoTracking().Where(x=>cursor==null||string.Compare(x.SourcePath,cursor)>0).OrderBy(x=>x.SourcePath).Take(51).Select(x=>new CmsRedirectListItem(x.Id,x.SourcePath,x.IsDemo,Convert.ToBase64String(x.Version),x.Publication,x.PublishedRevisionId,x.UpdatedAt)).ToListAsync(ct);return new(rows.Take(50).ToArray(),rows.Count>50?rows[49].SourcePath:null);
    }
    public async Task<CmsRedirectDetail> DetailAsync(string id,CancellationToken ct)
    {
        CmsRedirectRules.Id(id);var p=await db.Redirects.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsRedirectRules.Missing();CmsRedirectPublication? published=null;if(p.PublishedRevisionId is not null){var r=await db.RedirectRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.RedirectId==p.Id&&x.SourcePath==p.SourcePath&&x.Id==p.PublishedRevisionId,ct)??throw CmsRedirectRules.Unavailable();published=Item(r);if(r.Action=="Unpublish"||r.Publication!=p.Publication)throw CmsRedirectRules.Unavailable();}return new(id,p.SourcePath,p.IsDemo,Convert.ToBase64String(p.Version),p.Publication,Draft(p),published);
    }
    public async Task<CmsRedirectHistory> HistoryAsync(string id,int? before,CancellationToken ct)
    {
        CmsRedirectRules.Id(id);if(before is<1 or>10000)throw CmsRedirectRules.Invalid();if(!await db.Redirects.AnyAsync(x=>x.Id==id,ct))throw CmsRedirectRules.Missing();var rows=await db.RedirectRevisions.AsNoTracking().Where(x=>x.RedirectId==id&&(before==null||x.Publication<before)).OrderByDescending(x=>x.Publication).Take(21).ToListAsync(ct);return new(rows.Take(20).Select(Item).ToArray(),rows.Count>20?rows[19].Publication:null);
    }
    public async Task<CmsRedirectRevisionDetail> RevisionAsync(string id,string revisionId,CancellationToken ct)
    {
        CmsRedirectRules.Id(id);CmsRedirectRules.Id(revisionId);var p=await db.Redirects.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsRedirectRules.Missing();var r=await db.RedirectRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.RedirectId==id&&x.SourcePath==p.SourcePath&&x.Id==revisionId,ct)??throw CmsRedirectRules.Missing();return new(id,p.SourcePath,p.IsDemo,Item(r));
    }
    public async Task<CmsRedirectResolution> ResolveAsync(string source,CancellationToken ct)
    {
        CmsRedirectRules.Source(source);var row=await Published.SingleOrDefaultAsync(x=>x.SourcePath==source&&(!x.IsDemo||development),ct);if(row is null)return new(1,"api",source,false,false,null,null);Facts(row);return new(1,"api",source,true,row.IsDemo,row.TargetPath,row.Status);
    }
}
