using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Reviews;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveReviewInput(string? Version,string Locale,int Rating,string DisplayName,string Title,string Body,bool PublishConsent,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]ReviewPhotoInput? Photo=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ModerateReviewInput(string Version,string RevisionId,string Action,string Reason,string? Reply);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReportReviewInput(string RevisionId,string Reason);
public sealed record ReviewText(string RevisionId,string Locale,int Rating,string DisplayName,string Title,string Body,DateTimeOffset At);
public sealed record PublicReview(string Id,string ProductId,ReviewText Content,bool VerifiedBuyer,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Reply,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool HasPhoto=false,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool IsDemo=false,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]int Likes=0,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]int Dislikes=0);
public sealed record PrivateReview(string Id,string ProductId,string State,string Version,ReviewText Content,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Reply,int ReportCount,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool HasPhoto=false,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool IsDemo=false);
public sealed record ReviewPage(int SchemaVersion,PublicReview[] Items,int[] RatingCounts,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record AdminReviewPage(int SchemaVersion,PrivateReview[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record OwnReviewResult(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]PrivateReview? Review);
public sealed record ReviewResult(int SchemaVersion,bool Replayed,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]PrivateReview? Review,bool Reported);

public static class ReviewRules
{
    public static BusinessException Invalid()=>new("invalid_review","Review fields, version or command id are invalid.");
    public static string ProductId(string value){if(string.IsNullOrWhiteSpace(value)||value.Length>64||value!=value.Trim()||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();return value;}
    public static string Id(string value){if(value is null||!Guid.TryParseExact(value,"N",out var id)||value!=id.ToString("N"))throw Invalid();return value;}
    public static string Text(string value,int min,int max){if(value is null||value.Length>max||value.Trim().Length<min||value.Any(c=>(char.IsControl(c)&&c is not ('\n' or '\r' or '\t'))||c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069'))throw Invalid();return value.Trim();}
    public static void Version(string? value){try{if(value is null||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();}catch(FormatException){throw Invalid();}}
    public static SaveReviewInput Validate(SaveReviewInput i){if(i.Locale is not ("fa" or "en")||i.Rating is <1 or >5||!i.PublishConsent)throw Invalid();if(i.Version is not null)Version(i.Version);return i with{DisplayName=Text(i.DisplayName,1,60),Title=Text(i.Title,1,100),Body=Text(i.Body,10,2000)};}
    public static long Cursor(string? value){if(value is null)return long.MaxValue;if(value.Length>19||!long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var n)||n<=0||n.ToString(CultureInfo.InvariantCulture)!=value)throw Invalid();return n;}
}

public sealed partial class ReviewService(ReviewsDbContext db,IReviewProductReader catalog,IReviewPurchaseReader purchases,TimeProvider time,IReviewPhotoProcessor photoProcessor,ReviewOptions options)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public const string DemoOwnerPrefix="demo-review:";
    private static bool IsDemo(string owner)=>owner.StartsWith(DemoOwnerPrefix,StringComparison.Ordinal);
    private IQueryable<ProductReview> VisibleReviews()=>db.Reviews.Where(r=>!r.IsWithdrawn && (options.IncludeDevelopmentExamples || !r.OwnerId.StartsWith(DemoOwnerPrefix)));
    public async Task<string?> PublicChangeStampAsync(string productId, CancellationToken ct)
    {
        productId = ReviewRules.ProductId(productId);
        if (!await catalog.IsPublishedAsync(productId, ct)) return null;
        var q = db.Reviews.AsNoTracking().Where(r => r.ProductId == productId
            && (options.IncludeDevelopmentExamples || !r.OwnerId.StartsWith(DemoOwnerPrefix)));
        var latest = await q.Where(r => r.IsWithdrawn || r.State == "Approved" || r.State == "Hidden")
            .OrderByDescending(r => r.Version).Select(r => r.Version).FirstOrDefaultAsync(ct);
        var vote = await (from r in q
            where !r.IsWithdrawn && r.State == "Approved"
            join v in db.Votes.AsNoTracking() on new { ReviewId = r.Id, RevisionId = r.CurrentRevisionId }
                equals new { v.ReviewId, v.RevisionId }
            orderby v.Version descending select v.Version).FirstOrDefaultAsync(ct);
        return latest is null ? "empty" : Convert.ToHexString(latest) + (vote is null ? "" : "-" + Convert.ToHexString(vote));
    }

    public async Task<ReviewPage> PublicAsync(string productId, string? cursor, CancellationToken ct, string? sort = null)
    {
        productId = ReviewRules.ProductId(productId);
        var (before, likesBefore) = ReadPublicCursor(sort, cursor);
        if (!await catalog.IsPublishedAsync(productId, ct))
            throw new BusinessException("not_found", "Product is not published.");
        var q = VisibleReviews().AsNoTracking().Where(r => r.ProductId == productId && r.State == "Approved");
        var ranked = q.Select(r => new {
            Row = r,
            Likes = db.Votes.Count(v => v.ReviewId == r.Id && v.RevisionId == r.CurrentRevisionId && v.Value == 1),
            Dislikes = db.Votes.Count(v => v.ReviewId == r.Id && v.RevisionId == r.CurrentRevisionId && v.Value == -1)
        });
        var rows = sort == "helpful"
            ? await ranked.Where(x => x.Likes < likesBefore || x.Likes == likesBefore && x.Row.Sequence < before)
                .OrderByDescending(x => x.Likes).ThenByDescending(x => x.Row.Sequence).Take(21).ToArrayAsync(ct)
            : await ranked.Where(x => x.Row.Sequence < before).OrderByDescending(x => x.Row.Sequence).Take(21).ToArrayAsync(ct);
        var selected = rows.Take(20).Select(x => x.Row).ToArray();
        var revisions = await RevisionsAsync(selected, ct);
        var facts = await purchases.VerifiedAsync(selected.Where(r => !IsDemo(r.OwnerId))
            .Select(r => new ReviewPurchaseKey(r.OwnerId, r.ProductId)).Distinct().ToArray(), ct);
        var counts = await (from r in q join v in db.Revisions.AsNoTracking()
            on new { ReviewId = r.Id, RevisionId = r.CurrentRevisionId } equals new { v.ReviewId, RevisionId = v.Id }
            group v by v.Rating into g select new { Rating = g.Key, Count = g.Count() }).ToArrayAsync(ct);
        var ids = selected.Select(r => r.Id).ToArray();
        var fresh = await q.Where(r => ids.Contains(r.Id)).ToArrayAsync(ct);
        if (fresh.Length != selected.Length || selected.Any(r => !fresh.Any(f => f.Id == r.Id && f.CurrentRevisionId == r.CurrentRevisionId
                && f.Version.SequenceEqual(r.Version))) || !await catalog.IsPublishedAsync(productId, ct))
            throw new BusinessException("reviews_unavailable", "Review publication changed while reading. Retry the read.");
        var items = rows.Take(20).Select(x => {
            var r = x.Row;
            return new PublicReview(r.Id, r.ProductId, Content(revisions[r.CurrentRevisionId]),
                facts.Contains(new(r.OwnerId,r.ProductId)), r.Reply, revisions[r.CurrentRevisionId].PhotoId is not null,
                IsDemo(r.OwnerId), x.Likes, x.Dislikes);
        }).ToArray();
        var next = rows.Length > 20 ? rows[19].Row.Sequence.ToString(CultureInfo.InvariantCulture) : null;
        if (next is not null && sort == "helpful") next = $"{rows[19].Likes.ToString(CultureInfo.InvariantCulture)}.{next}";
        return new(1, items, Enumerable.Range(1,5).Select(n => counts.SingleOrDefault(x => x.Rating == n)?.Count ?? 0).ToArray(), next);
    }
    public async Task<PrivateReview?> OwnAsync(string owner,string productId,CancellationToken ct)
    {
        productId=ReviewRules.ProductId(productId);var row=await VisibleReviews().AsNoTracking().SingleOrDefaultAsync(r=>r.OwnerId==owner&&r.ProductId==productId,ct);return row is null?null:await PrivateAsync(row,ct);
    }
    public async Task<AdminReviewPage> AdminAsync(string? state,string? productId,string? cursor,CancellationToken ct)
    {
        if(state is not (null or "Pending" or "Approved" or "Rejected" or "Hidden"))throw ReviewRules.Invalid();if(productId is not null)ReviewRules.ProductId(productId);var before=ReviewRules.Cursor(cursor);
        var q=VisibleReviews().AsNoTracking().Where(r=>r.Sequence<before);if(state is not null)q=q.Where(r=>r.State==state);if(productId is not null)q=q.Where(r=>r.ProductId==productId);
        var rows=await q.OrderByDescending(r=>r.Sequence).Take(21).ToArrayAsync(ct);var items=new List<PrivateReview>();foreach(var row in rows.Take(20))items.Add(await PrivateAsync(row,ct));
        return new(1,items.ToArray(),rows.Length>20?rows[19].Sequence.ToString(CultureInfo.InvariantCulture):null);
    }
    public async Task<byte[]?> PublicPhotoAsync(string productId,string reviewId,string revisionId,CancellationToken ct)
    {
        productId=ReviewRules.ProductId(productId);
        if(!await catalog.IsPublishedAsync(productId,ct))return null;
        var bytes=await PhotoAsync(VisibleReviews().Where(r=>r.ProductId==productId&&r.State=="Approved"),reviewId,revisionId,ct);
        return bytes is not null&&await catalog.IsPublishedAsync(productId,ct)?bytes:null;
    }
    public Task<byte[]?> OwnPhotoAsync(string owner,string productId,string reviewId,string revisionId,CancellationToken ct)
    {
        productId=ReviewRules.ProductId(productId);
        return PhotoAsync(VisibleReviews().Where(r=>r.OwnerId==owner&&r.ProductId==productId),reviewId,revisionId,ct);
    }
    public Task<byte[]?> StaffPhotoAsync(string reviewId,string revisionId,CancellationToken ct)
        =>PhotoAsync(VisibleReviews(),reviewId,revisionId,ct);

    private async Task<byte[]?> PhotoAsync(IQueryable<ProductReview> reviews,string reviewId,string revisionId,CancellationToken ct)
    {
        ReviewRules.Id(reviewId);ReviewRules.Id(revisionId);
        var bytes=await (from r in reviews.AsNoTracking()
            where r.Id==reviewId&&r.CurrentRevisionId==revisionId
            join revision in db.Revisions on new{ReviewId=r.Id,RevisionId=r.CurrentRevisionId} equals new{revision.ReviewId,RevisionId=revision.Id}
            join photo in db.Photos on revision.PhotoId equals photo.Id
            select photo.Webp).SingleOrDefaultAsync(ct);
        if(bytes is not null&&!ReviewPhotos.IsWebp(bytes))throw new BusinessException("reviews_unavailable","Review photo is unavailable.");
        return bytes;
    }
    public Task<ReviewResult> SaveAsync(string owner,string productId,string commandId,SaveReviewInput input,CancellationToken ct)
    {
        productId=ReviewRules.ProductId(productId);input=ReviewRules.Validate(input);
        if(!options.IncludeDevelopmentExamples&&IsDemo(owner))throw ReviewRules.Invalid();
        var photoInput=ReviewPhotos.Decode(input.Photo);
        return CommandAsync(owner,commandId,new{Action="save",ProductId=productId,Input=input},async()=>{
            if(!await catalog.IsPublishedAsync(productId,ct))throw new BusinessException("not_found","Product is not published.");
            var row=await db.Reviews.SingleOrDefaultAsync(r=>r.OwnerId==owner&&r.ProductId==productId,ct);var now=time.GetUtcNow();
            var publish = row is null || row.State == "Approved";
            var retainPhoto = row?.IsWithdrawn != true;
            if(row is null){if(input.Version is not null)throw Conflict();row=new(){OwnerId=owner,ProductId=productId,CreatedAt=now};db.Reviews.Add(row);}
            else if (row.IsWithdrawn) { if (input.Version is not null) throw Conflict(); row.IsWithdrawn = false; }
            else Match(row,input.Version);
            string? photoId=null;
            if(photoInput is not null)
            {
                var webp=await photoProcessor.ProcessAsync(photoInput,input.Photo!.Name!,input.Photo.ContentType!,ct);
                if(!ReviewPhotos.IsWebp(webp))throw new BusinessException("reviews_unavailable","Review photo is unavailable.");
                var photo=new ReviewPhoto{Webp=webp};db.Photos.Add(photo);photoId=photo.Id;
            }
            else if(retainPhoto&&input.Photo?.Action!="remove"&&row.CurrentRevisionId.Length>0)
                photoId=await db.Revisions.Where(v=>v.Id==row.CurrentRevisionId&&v.ReviewId==row.Id).Select(v=>v.PhotoId).SingleAsync(ct);
            var revision=new ReviewRevision{ReviewId=row.Id,Locale=input.Locale,Rating=input.Rating,DisplayName=input.DisplayName,Title=input.Title,Body=input.Body,At=now,PhotoId=photoId};db.Revisions.Add(revision);
            row.CurrentRevisionId=revision.Id;row.State=publish?"Approved":"Pending";row.Reply=null;row.ChangedAt=now;Event(row,owner,"Submitted","");
            await db.SaveChangesAsync(ct);return new(1,false,await PrivateAsync(row,ct),false);
        },ct);
    }
    public Task<ReviewResult> ModerateAsync(string actor,string reviewId,string commandId,ModerateReviewInput input,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Review moderation requires the root Serializable audit transaction.");
        ReviewRules.Id(reviewId);ReviewRules.Id(input.RevisionId);ReviewRules.Version(input.Version);
        if(input.Action is not ("Approve" or "Reject" or "Hide" or "Reply"))throw ReviewRules.Invalid();
        input=input with{Reason=ReviewRules.Text(input.Reason,input.Action is "Reject" or "Hide"?5:0,400),Reply=input.Reply is null?null:ReviewRules.Text(input.Reply,1,2000)};
        if(input.Action=="Reply"&&input.Reply is null||input.Action!="Reply"&&input.Reply is not null)throw ReviewRules.Invalid();
        return CommandAsync(actor,commandId,new{Action="moderate",ReviewId=reviewId,Input=input},async()=>{
            var row=await VisibleReviews().SingleOrDefaultAsync(r=>r.Id==reviewId,ct)??throw new BusinessException("not_found","Review not found.");Match(row,input.Version);if(row.CurrentRevisionId!=input.RevisionId)throw Conflict();
            if(input.Action=="Reply"){if(row.State!="Approved")throw Conflict();row.Reply=input.Reply;}
            else{if(input.Action is "Approve" or "Reject"&&row.State!="Pending"||input.Action=="Hide"&&row.State!="Approved")throw Conflict();row.State=input.Action=="Approve"?"Approved":input.Action=="Reject"?"Rejected":"Hidden";if(row.State!="Approved")row.Reply=null;}
            row.ChangedAt=time.GetUtcNow();Event(row,actor,input.Action,input.Reason);await db.SaveChangesAsync(ct);return new(1,false,await PrivateAsync(row,ct),false);
        },ct);
    }
    public Task<ReviewResult> ReportAsync(string owner,string reviewId,string commandId,ReportReviewInput input,CancellationToken ct)
    {
        ReviewRules.Id(reviewId);ReviewRules.Id(input.RevisionId);if(input.Reason is not ("spam" or "abuse" or "personal_data" or "unrelated"))throw ReviewRules.Invalid();
        return CommandAsync(owner,commandId,new{Action="report",ReviewId=reviewId,Input=input},async()=>{
            var row=await VisibleReviews().SingleOrDefaultAsync(r=>r.Id==reviewId,ct)??throw new BusinessException("not_found","Review not found.");
            if(row.State!="Approved"||row.CurrentRevisionId!=input.RevisionId||!await catalog.IsPublishedAsync(row.ProductId,ct))throw Conflict();
            if(!await db.Reports.AnyAsync(r=>r.ReviewId==reviewId&&r.RevisionId==input.RevisionId&&r.OwnerId==owner,ct))db.Reports.Add(new(){ReviewId=reviewId,RevisionId=input.RevisionId,OwnerId=owner,Reason=input.Reason,At=time.GetUtcNow()});
            await db.SaveChangesAsync(ct);return new(1,false,null,true);
        },ct);
    }
    private Task<ReviewResult> CommandAsync(string actor,string commandId,object input,Func<Task<ReviewResult>> work,CancellationToken ct)
        => CommandAsync(actor, commandId, input, work, result => result with { Replayed = true }, ct);

    private async Task<T> CommandAsync<T>(string actor,string commandId,object input,Func<Task<T>> work,Func<T,T> replay,CancellationToken ct) where T : class
    {
        ReviewRules.Id(commandId);if(string.IsNullOrEmpty(actor)||actor.Length>64)throw ReviewRules.Invalid();
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input,Json))));
        var own=db.Database.CurrentTransaction is null;await using var owned=own?await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct):null;
        var transaction=db.Database.CurrentTransaction??throw new InvalidOperationException("Review command transaction is required.");if(transaction.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Review commands require Serializable isolation.");
        await using(var command=db.Database.GetDbConnection().CreateCommand()){
            command.Transaction=transaction.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:reviews:actor:"+actor;command.Parameters.Add(p);
            if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw Conflict();
        }
        var previous=await db.Commands.FromSqlInterpolated($"SELECT * FROM [reviews].[Commands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.PayloadHash!=hash)throw new BusinessException("review_idempotency_conflict","This command id was already used with different details.");return replay(JsonSerializer.Deserialize<T>(previous.ResultJson,Json)??throw new InvalidOperationException("Invalid review receipt."));}
        var result=await work();db.Commands.Add(new(){ActorId=actor,CommandId=commandId,PayloadHash=hash,ResultJson=JsonSerializer.Serialize(result,Json),At=time.GetUtcNow()});await db.SaveChangesAsync(ct);if(owned is not null)await owned.CommitAsync(ct);return result;
    }
    private async Task<Dictionary<string,ReviewRevision>> RevisionsAsync(ProductReview[] rows,CancellationToken ct)
    {
        var ids=rows.Select(r=>r.CurrentRevisionId).ToArray();var result=await db.Revisions.AsNoTracking().Where(v=>ids.Contains(v.Id)).ToDictionaryAsync(v=>v.Id,ct);
        if(rows.Any(r=>!result.TryGetValue(r.CurrentRevisionId,out var v)||v.ReviewId!=r.Id))throw new InvalidOperationException("Review revision relationship is inconsistent.");return result;
    }
    private async Task<PrivateReview> PrivateAsync(ProductReview row,CancellationToken ct)
    {
        var revisions=await RevisionsAsync([row],ct);var count=await db.Reports.CountAsync(r=>r.ReviewId==row.Id&&r.RevisionId==row.CurrentRevisionId,ct);
        var revision=revisions[row.CurrentRevisionId];
        return new(row.Id,row.ProductId,row.State,Convert.ToBase64String(row.Version),Content(revision),row.State=="Approved"?row.Reply:null,count,revision.PhotoId is not null,IsDemo(row.OwnerId));
    }
    private static ReviewText Content(ReviewRevision r)=>new(r.Id,r.Locale,r.Rating,r.DisplayName,r.Title,r.Body,r.At);
    private void Event(ProductReview row,string actor,string action,string reason)=>db.Events.Add(new(){ReviewId=row.Id,RevisionId=row.CurrentRevisionId,ActorId=actor,Action=action,Reason=reason,At=time.GetUtcNow()});
    private static BusinessException Conflict()=>new("review_version_conflict","Review changed or its current state does not allow this command.");
    private static void Match(ProductReview row,string? version){if(version is null||Convert.ToBase64String(row.Version)!=version)throw Conflict();}
}
