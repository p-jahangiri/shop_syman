using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed partial class CmsBlogPostService(CmsDbContext db,bool development,TimeProvider clock,ICmsBlogCursorProtection cursors,IPublicImageReferences images)
{
    private async Task Gate(string key,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=System.Data.IsolationLevel.Serializable)throw new InvalidOperationException("CMS page commands require a root transaction.");
        await using var q=db.Database.GetDbConnection().CreateCommand();q.Transaction=db.Database.CurrentTransaction.GetDbTransaction();q.CommandTimeout=15;
        q.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
        var p=q.CreateParameter();p.ParameterName="@key";p.Value="sayman:cms:blog-posts:v1:"+CmsBlogPostRules.Digest(key);q.Parameters.Add(p);
        if(Convert.ToInt32(await q.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cms_blog_busy","Retry the same page command.");
    }
    private IQueryable<CmsBlogPost> Heads=>db.BlogPosts.FromSqlRaw("SELECT * FROM [cms].[BlogPosts] WITH (READCOMMITTEDLOCK)");
    private IQueryable<CmsBlogPostRevision> Revisions=>db.BlogPostRevisions.FromSqlRaw("SELECT * FROM [cms].[BlogPostRevisions] WITH (READCOMMITTEDLOCK)");
    private static CmsBlogContent Draft(CmsBlogPost p){if(CmsBlogPostRules.Digest(p.DraftJson)!=p.DraftHash)throw CmsBlogPostRules.Unavailable();var c=CmsBlogPostRules.Read<CmsBlogContent>(p.DraftJson);try{CmsBlogPostRules.Content(c,false);}catch(BusinessException){throw CmsBlogPostRules.Unavailable();}return c;}
    private static CmsBlogContent Body(CmsBlogPostRevision r){if(CmsBlogPostRules.Digest(r.BodyJson)!=r.BodyHash)throw CmsBlogPostRules.Unavailable();var c=CmsBlogPostRules.Read<CmsBlogContent>(r.BodyJson);try{CmsBlogPostRules.Content(c,true);}catch(BusinessException){throw CmsBlogPostRules.Unavailable();}return c;}
    private static CmsBlogPostRevisionItem RevisionItem(CmsBlogPostRevision r)=>new(r.Id,r.Publication,r.Action,r.At);
    private static CmsBlogPostResult Receipt(CmsBlogPostCommand c)
    {
        if(CmsBlogPostRules.Digest(c.ResultJson)!=c.ResultHash)throw CmsBlogPostRules.Unavailable();var r=CmsBlogPostRules.Read<CmsBlogPostResult>(c.ResultJson);
        if(r.PostId!=c.PostId||r.CommandId!=c.CommandId||r.Replayed||r.Action is not("Create"or"Save"or"Publish"or"Restore"or"Unpublish"))throw CmsBlogPostRules.Unavailable();return r with{Replayed=true};
    }
    public async Task<CmsBlogPostResult> ReceiptAsync(string actor,string commandId,string? pageId,CancellationToken ct)
    {
        CmsBlogPostRules.Actor(actor);CmsBlogPostRules.Id(commandId);if(pageId is not null)CmsBlogPostRules.Id(pageId);
        var c=await db.BlogPostCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw CmsBlogPostRules.Missing();
        var r=Receipt(c);if(pageId is null?r.Action!="Create":r.Action=="Create"||r.PostId!=pageId)throw CmsBlogPostRules.Missing();return r;
    }
    public async Task<CmsBlogPostResult> WriteAsync(string actor,string? pageId,string commandId,CmsBlogPostWrite input,CancellationToken ct)
    {
        CmsBlogPostRules.Actor(actor);CmsBlogPostRules.Id(commandId);if(pageId is not null)CmsBlogPostRules.Id(pageId);CmsBlogPostRules.Input(input,pageId is null);if(pageId is null&&input.IsDemo==true&&!development)throw CmsBlogPostRules.Invalid();
        var hash=CmsBlogPostRules.Digest(CmsBlogPostRules.Serialize(new{pageId,input}));await Gate("command:"+actor+":"+commandId,ct);
        var prior=await db.BlogPostCommands.FromSqlRaw("SELECT * FROM [cms].[BlogPostCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("cms_blog_idempotency_conflict","Command already belongs to another page operation.");return Receipt(prior);}
        if(input.Action is "Create" or "Save") await images.RequireReadyAsync(CmsImageReferences.Blog(input.Content!),ct);
        CmsBlogPost p;var now=clock.GetUtcNow().ToUniversalTime();
        if(pageId is null){
            await Gate("slug:"+input.Slug,ct);if(await Heads.AnyAsync(x=>x.Slug==input.Slug,ct))throw new BusinessException("cms_blog_slug_conflict","Page address already exists.");
            p=new(){Id=Guid.NewGuid().ToString("N"),Slug=input.Slug!,IsDemo=input.IsDemo!.Value,CreatedBy=actor,CreatedAt=now,UpdatedBy=actor,UpdatedAt=now,DraftJson=CmsBlogPostRules.Serialize(input.Content!)};p.DraftHash=CmsBlogPostRules.Digest(p.DraftJson);db.BlogPosts.Add(p);await db.SaveChangesAsync(ct);
        }else{
            await Gate("page:"+pageId,ct);p=await Heads.SingleOrDefaultAsync(x=>x.Id==pageId,ct)??throw CmsBlogPostRules.Missing();
            if(input.Version!=Convert.ToBase64String(p.Version)||p.UpdatedAt>now)throw CmsBlogPostRules.Changed();_=Draft(p);
        }
        CmsBlogPostRevision? revision=null;
        if(input.Action=="Save"){p.DraftJson=CmsBlogPostRules.Serialize(input.Content!);p.DraftHash=CmsBlogPostRules.Digest(p.DraftJson);}
        else if(input.Action is "Publish"or"Restore"or"Unpublish"){
            if(p.Publication>=10000)throw new BusinessException("cms_blog_capacity_conflict","Page publication history reached capacity.");
            string json;
            if(input.Action=="Publish"){var content=Draft(p);CmsBlogPostRules.Content(content,true);await images.RequireReadyAsync(CmsImageReferences.Blog(content),ct);json=p.DraftJson;}
            else{var id=input.Action=="Restore"?input.RestoreRevisionId:p.PublishedRevisionId;if(id is null)throw CmsBlogPostRules.Changed();var source=await Revisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PostId==p.Id&&x.Id==id,ct)??throw CmsBlogPostRules.Missing();if(source.Action=="Unpublish")throw CmsBlogPostRules.Invalid();_=await VerifiedBody(source,ct);json=source.BodyJson;}
            if(input.Action=="Restore") await images.RequireReadyAsync(CmsImageReferences.Blog(CmsBlogPostRules.Read<CmsBlogContent>(json)),ct);
            revision=new(){Id=Guid.NewGuid().ToString("N"),PostId=p.Id,Publication=p.Publication+1,Action=input.Action,BodyJson=json,BodyHash=CmsBlogPostRules.Digest(json),ActorId=actor,At=now};
            revision.Tags=CmsBlogPostRules.Read<CmsBlogContent>(json).Tags.Select(t=>new CmsBlogRevisionTag{RevisionId=revision.Id,Slug=t.Slug,NameFa=t.NameFa,NameEn=t.NameEn}).ToList();
            db.BlogPostRevisions.Add(revision);await db.SaveChangesAsync(ct);p.Publication=revision.Publication;p.PublishedRevisionId=input.Action=="Unpublish"?null:revision.Id;if(input.Action!="Unpublish")p.FirstPublishedAt??=now;
        }
        p.UpdatedBy=actor;p.UpdatedAt=now;if(pageId is not null)db.Entry(p).Property(x=>x.UpdatedAt).IsModified=true;await db.SaveChangesAsync(ct);
        var result=new CmsBlogPostResult(commandId,p.Id,p.Slug,Convert.ToBase64String(p.Version),input.Action,p.Publication,revision?.Id,p.PublishedRevisionId,p.DraftHash,false);
        var receipt=CmsBlogPostRules.Serialize(result);db.BlogPostCommands.Add(new(){ActorId=actor,CommandId=commandId,PostId=p.Id,PayloadHash=hash,ResultJson=receipt,ResultHash=CmsBlogPostRules.Digest(receipt),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CmsBlogPostList> ListAsync(string? cursor,CancellationToken ct)
    {
        if(cursor is not null)CmsBlogPostRules.Slug(cursor);var rows=await db.BlogPosts.AsNoTracking().Where(x=>cursor==null||string.Compare(x.Slug,cursor)>0).OrderBy(x=>x.Slug).Take(51).Select(x=>new CmsBlogPostListItem(x.Id,x.Slug,x.IsDemo,Convert.ToBase64String(x.Version),x.Publication,x.PublishedRevisionId,x.UpdatedAt)).ToListAsync(ct);
        return new(rows.Take(50).ToArray(),rows.Count>50?rows[49].Slug:null);
    }
    public async Task<CmsBlogPostDetail> DetailAsync(string id,CancellationToken ct)
    {
        CmsBlogPostRules.Id(id);var p=await db.BlogPosts.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsBlogPostRules.Missing();var draft=Draft(p);CmsBlogContent? published=null;
        if(p.PublishedRevisionId is not null){var r=await db.BlogPostRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PostId==p.Id&&x.Id==p.PublishedRevisionId,ct)??throw CmsBlogPostRules.Unavailable();if(r.Action=="Unpublish")throw CmsBlogPostRules.Unavailable();published=await VerifiedBody(r,ct);}
        return new(p.Id,p.Slug,p.IsDemo,Convert.ToBase64String(p.Version),p.Publication,p.PublishedRevisionId,draft,published,p.FirstPublishedAt,p.DraftHash);
    }
    public async Task<CmsBlogPostHistory> HistoryAsync(string id,int? before,CancellationToken ct)
    {
        CmsBlogPostRules.Id(id);if(before is<1 or>10000)throw CmsBlogPostRules.Invalid();if(!await db.BlogPosts.AnyAsync(x=>x.Id==id,ct))throw CmsBlogPostRules.Missing();var rows=await db.BlogPostRevisions.AsNoTracking().Where(x=>x.PostId==id&&(before==null||x.Publication<before)).OrderByDescending(x=>x.Publication).Take(21).ToListAsync(ct);return new(rows.Take(20).Select(RevisionItem).ToArray(),rows.Count>20?rows[19].Publication:null);
    }
    public async Task<CmsBlogPostRevisionDetail> RevisionAsync(string id,string revisionId,CancellationToken ct)
    {
        CmsBlogPostRules.Id(id);CmsBlogPostRules.Id(revisionId);var p=await db.BlogPosts.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CmsBlogPostRules.Missing();var r=await db.BlogPostRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.PostId==id&&x.Id==revisionId,ct)??throw CmsBlogPostRules.Missing();return new(id,p.Slug,p.IsDemo,RevisionItem(r),await VerifiedBody(r,ct));
    }
    private async Task<CmsBlogContent> VerifiedBody(CmsBlogPostRevision r,CancellationToken ct)
    {
        CmsBlogContent body;try{CmsBlogPostRules.Id(r.Id);CmsBlogPostRules.Id(r.PostId);CmsBlogPostRules.Actor(r.ActorId);if(r.Publication is<1 or>10000||r.At.Offset!=TimeSpan.Zero||r.Action is not("Publish"or"Restore"or"Unpublish"))throw CmsBlogPostRules.Unavailable();body=Body(r);}catch(BusinessException){throw CmsBlogPostRules.Unavailable();}
        var tags=await db.BlogRevisionTags.AsNoTracking().Where(x=>x.RevisionId==r.Id).OrderBy(x=>x.Slug).Select(x=>new CmsBlogTag(x.Slug,x.NameFa,x.NameEn)).ToArrayAsync(ct);if(CmsBlogPostRules.Serialize(tags)!=CmsBlogPostRules.Serialize(body.Tags))throw CmsBlogPostRules.Unavailable();return body;
    }
    public async Task<CmsPublicBlogPost> PublicAsync(string slug,string locale,CancellationToken ct)
    {
        CmsBlogPostRules.Slug(slug);if(locale is not("fa"or"en"))throw CmsBlogPostRules.Invalid();
        var row=await (from p in db.BlogPosts.AsNoTracking() join r in db.BlogPostRevisions.AsNoTracking() on new{PostId=p.Id,Id=p.PublishedRevisionId} equals new{r.PostId,Id=(string?)r.Id} where p.Slug==slug&&(!p.IsDemo||development) select new{p.Id,p.Slug,p.IsDemo,p.FirstPublishedAt,p.Publication,p.CreatedAt,p.UpdatedAt,Revision=r}).SingleOrDefaultAsync(ct)??throw CmsBlogPostRules.Missing();
        if(row.Revision.Action=="Unpublish"||row.Publication!=row.Revision.Publication||row.FirstPublishedAt is null||row.FirstPublishedAt<row.CreatedAt||row.FirstPublishedAt>row.Revision.At||row.Revision.At>row.UpdatedAt)throw CmsBlogPostRules.Unavailable();var content=await VerifiedBody(row.Revision,ct);var lang=locale=="fa"?content.Body.Fa:content.Body.En;return new(row.Id,row.Slug,locale,row.Revision.Id,row.FirstPublishedAt.Value,row.Revision.At,row.IsDemo,lang.Title,lang.Description,content.AuthorKind!,locale=="fa"?content.BylineFa:content.BylineEn,content.Cover,locale=="fa"?content.CoverAltFa:content.CoverAltEn,content.Tags.Select(t=>new CmsBlogPublicTag(t.Slug,locale=="fa"?t.NameFa:t.NameEn)).ToArray(),lang.Blocks);
    }
}
