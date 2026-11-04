using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed class CmsPageService(CmsDbContext db,bool development,IPublicImageReferences images)
{
    private async Task Gate(string key,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction is null)throw new InvalidOperationException("CMS page commands require a root transaction.");
        await using var q=db.Database.GetDbConnection().CreateCommand();q.Transaction=db.Database.CurrentTransaction.GetDbTransaction();q.CommandTimeout=15;
        q.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
        var p=q.CreateParameter();p.ParameterName="@key";p.Value="sayman:cms:pages:v1:"+CmsPageRules.Digest(key);q.Parameters.Add(p);
        if(Convert.ToInt32(await q.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cms_page_busy","Retry the same page command.");
    }
    private IQueryable<CmsPage> Heads=>db.Pages.FromSqlRaw("SELECT * FROM [cms].[Pages] WITH (READCOMMITTEDLOCK)");
    private IQueryable<CmsPageRevision> Revisions=>db.PageRevisions.FromSqlRaw("SELECT * FROM [cms].[PageRevisions] WITH (READCOMMITTEDLOCK)");
    private static CmsPageContent Draft(CmsPage p){if(CmsPageRules.Digest(p.DraftJson)!=p.DraftHash)throw CmsPageRules.Unavailable();var c=CmsPageRules.Read<CmsPageContent>(p.DraftJson);CmsPageRules.Content(c,false);return c;}
    private static CmsPageContent Body(CmsPageRevision r){if(CmsPageRules.Digest(r.BodyJson)!=r.BodyHash)throw CmsPageRules.Unavailable();var c=CmsPageRules.Read<CmsPageContent>(r.BodyJson);CmsPageRules.Content(c,true);return c;}
    private static CmsPageRevisionItem RevisionItem(CmsPageRevision r)=>new(r.Id,r.Publication,r.Action,r.At);
    private static CmsPageResult Receipt(CmsPageCommand c)
    {
        if(CmsPageRules.Digest(c.ResultJson)!=c.ResultHash)throw CmsPageRules.Unavailable();var r=CmsPageRules.Read<CmsPageResult>(c.ResultJson);
        if(r.PageId!=c.PageId||r.CommandId!=c.CommandId||r.Replayed||r.Action is not("Create"or"Save"or"Publish"or"Restore"or"Unpublish"))throw CmsPageRules.Unavailable();return r with{Replayed=true};
    }
    public async Task<CmsPageResult> ReceiptAsync(string actor,string commandId,string? pageId,CancellationToken ct)
    {
        CmsPageRules.Actor(actor);CmsPageRules.Id(commandId);if(pageId is not null)CmsPageRules.Id(pageId);
        var c=await db.PageCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw CmsPageRules.Missing();
        var r=Receipt(c);if(pageId is null?r.Action!="Create":r.Action=="Create"||r.PageId!=pageId)throw CmsPageRules.Missing();return r;
    }
    public async Task<CmsPageResult> WriteAsync(string actor,string? pageId,string commandId,CmsPageWrite input,CancellationToken ct)
    {
        CmsPageRules.Actor(actor);CmsPageRules.Id(commandId);if(pageId is not null)CmsPageRules.Id(pageId);CmsPageRules.Input(input,pageId is null);
        var hash=CmsPageRules.Digest(CmsPageRules.Serialize(new{pageId,input}));await Gate("command:"+actor+":"+commandId,ct);
        var prior=await db.PageCommands.FromSqlRaw("SELECT * FROM [cms].[PageCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("cms_page_idempotency_conflict","Command already belongs to another page operation.");return Receipt(prior);}
        if(input.Action is "Create" or "Save") await images.RequireReadyAsync(CmsImageReferences.Page(input.Content!),ct);
        CmsPage p;var now=DateTimeOffset.UtcNow;
        if(pageId is null){
            await Gate("slug:"+input.Slug,ct);if(await Heads.AnyAsync(x=>x.Slug==input.Slug,ct))throw new BusinessException("cms_page_slug_conflict","Page address already exists.");
            p=new(){Id=Guid.NewGuid().ToString("N"),Slug=input.Slug!,IsDemo=input.IsDemo!.Value,CreatedBy=actor,CreatedAt=now,UpdatedBy=actor,UpdatedAt=now,DraftJson=CmsPageRules.Serialize(input.Content!)};p.DraftHash=CmsPageRules.Digest(p.DraftJson);db.Pages.Add(p);await db.SaveChangesAsync(ct);
        }else{
            await Gate("page:"+pageId,ct);p=await Heads.SingleOrDefaultAsync(x=>x.Id==pageId,ct)??throw CmsPageRules.Missing();
            if(input.Version!=Convert.ToBase64String(p.Version))throw CmsPageRules.Changed();_=Draft(p);
        }
        CmsPageRevision? revision=null;
        if(input.Action=="Save"){p.DraftJson=CmsPageRules.Serialize(input.Content!);p.DraftHash=CmsPageRules.Digest(p.DraftJson);}
        else if(input.Action is "Publish"or"Restore"or"Unpublish"){
            if(p.Publication>=10000)throw new BusinessException("cms_page_capacity_conflict","Page publication history reached capacity.");
            string json;
            if(input.Action=="Publish"){var content=Draft(p);CmsPageRules.Content(content,true);await images.RequireReadyAsync(CmsImageReferences.Page(content),ct);json=p.DraftJson;}
            else{var id=input.Action=="Restore"?input.RestoreRevisionId:p.PublishedRevisionId;if(id is null)throw CmsPageRules.Changed();var source=await Revisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PageId==p.Id&&x.Id==id,ct)??throw CmsPageRules.Missing();if(source.Action=="Unpublish")throw CmsPageRules.Invalid();_=Body(source);json=source.BodyJson;}
            if(input.Action=="Restore") await images.RequireReadyAsync(CmsImageReferences.Page(CmsPageRules.Read<CmsPageContent>(json)),ct);
            revision=new(){Id=Guid.NewGuid().ToString("N"),PageId=p.Id,Publication=p.Publication+1,Action=input.Action,BodyJson=json,BodyHash=CmsPageRules.Digest(json),ActorId=actor,At=now};
            db.PageRevisions.Add(revision);await db.SaveChangesAsync(ct);p.Publication=revision.Publication;p.PublishedRevisionId=input.Action=="Unpublish"?null:revision.Id;
        }
        p.UpdatedBy=actor;p.UpdatedAt=now;await db.SaveChangesAsync(ct);
        var result=new CmsPageResult(commandId,p.Id,p.Slug,Convert.ToBase64String(p.Version),input.Action,p.Publication,revision?.Id,p.PublishedRevisionId,p.DraftHash,false);
        var receipt=CmsPageRules.Serialize(result);db.PageCommands.Add(new(){ActorId=actor,CommandId=commandId,PageId=p.Id,PayloadHash=hash,ResultJson=receipt,ResultHash=CmsPageRules.Digest(receipt),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CmsPageList> ListAsync(string? cursor,CancellationToken ct)
    {
        if(cursor is not null)CmsPageRules.Slug(cursor);var rows=await db.Pages.AsNoTracking().Where(x=>cursor==null||string.Compare(x.Slug,cursor)>0).OrderBy(x=>x.Slug).Take(51).Select(x=>new CmsPageListItem(x.Id,x.Slug,x.IsDemo,Convert.ToBase64String(x.Version),x.Publication,x.PublishedRevisionId,x.UpdatedAt)).ToListAsync(ct);
        return new(rows.Take(50).ToArray(),rows.Count>50?rows[49].Slug:null);
    }
    public async Task<CmsPageDetail> DetailAsync(string id,CancellationToken ct)
    {
        CmsPageRules.Id(id);var p=await db.Pages.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsPageRules.Missing();var draft=Draft(p);CmsPageContent? published=null;
        if(p.PublishedRevisionId is not null){var r=await db.PageRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PageId==p.Id&&x.Id==p.PublishedRevisionId,ct)??throw CmsPageRules.Unavailable();if(r.Action=="Unpublish")throw CmsPageRules.Unavailable();published=Body(r);}
        return new(p.Id,p.Slug,p.IsDemo,Convert.ToBase64String(p.Version),p.Publication,p.PublishedRevisionId,draft,published);
    }
    public async Task<CmsPageHistory> HistoryAsync(string id,int? before,CancellationToken ct)
    {
        CmsPageRules.Id(id);if(before is<1 or>10000)throw CmsPageRules.Invalid();if(!await db.Pages.AnyAsync(x=>x.Id==id,ct))throw CmsPageRules.Missing();var rows=await db.PageRevisions.AsNoTracking().Where(x=>x.PageId==id&&(before==null||x.Publication<before)).OrderByDescending(x=>x.Publication).Take(21).ToListAsync(ct);return new(rows.Take(20).Select(RevisionItem).ToArray(),rows.Count>20?rows[19].Publication:null);
    }
    public async Task<CmsPageRevisionDetail> RevisionAsync(string id,string revisionId,CancellationToken ct)
    {
        CmsPageRules.Id(id);CmsPageRules.Id(revisionId);var p=await db.Pages.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsPageRules.Missing();var r=await db.PageRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PageId==id&&x.Id==revisionId,ct)??throw CmsPageRules.Missing();return new(id,p.Slug,p.IsDemo,RevisionItem(r),Body(r));
    }
    public async Task<CmsPublicPage> PublicAsync(string slug,string locale,CancellationToken ct)
    {
        CmsPageRules.Slug(slug);if(locale is not("fa"or"en"))throw CmsPageRules.Invalid();
        var row=await (from p in db.Pages.AsNoTracking() join r in db.PageRevisions.AsNoTracking() on new{PageId=p.Id,Id=p.PublishedRevisionId} equals new{r.PageId,Id=(string?)r.Id} where p.Slug==slug&&(!p.IsDemo||development) select new{p.Id,p.Slug,p.IsDemo,Revision=r}).SingleOrDefaultAsync(ct)??throw CmsPageRules.Missing();
        if(row.Revision.Action=="Unpublish")throw CmsPageRules.Unavailable();var body=Body(row.Revision);var lang=locale=="fa"?body.Fa:body.En;return new(row.Id,row.Slug,locale,row.Revision.Id,row.Revision.At,row.IsDemo,lang.Title,lang.Description,lang.Blocks);
    }
}
