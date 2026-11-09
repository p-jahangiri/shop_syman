using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Reviews;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReviewVoteInput(string RevisionId, int Value);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WithdrawReviewInput(string Version);
public sealed record ReviewVoteResult(int Value, int Likes, int Dislikes, bool Replayed);
public sealed record ReviewWithdrawResult(bool Withdrawn, bool Replayed);
public sealed record OwnedReviewActivity(PrivateReview Review, int Likes, int Dislikes);
public sealed record OwnedReviewActivityPage(OwnedReviewActivity[] Items, string? NextCursor);

public sealed partial class ReviewService
{
    public static (long Sequence, int Likes) ReadPublicCursor(string? sort, string? cursor)
    {
        if (sort is null or "newest") return (ReviewRules.Cursor(cursor), int.MaxValue);
        if (sort != "helpful") throw ReviewRules.Invalid();
        if (cursor is null) return (long.MaxValue, int.MaxValue);
        var parts = cursor.Split('.', 2, StringSplitOptions.None);
        if (parts.Length != 2 || !int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var likes)
            || likes < 0 || likes.ToString(CultureInfo.InvariantCulture) != parts[0]) throw ReviewRules.Invalid();
        return (ReviewRules.Cursor(parts[1]), likes);
    }

    public Task<ReviewVoteResult> VoteAsync(string actor, string reviewId, string commandId, ReviewVoteInput input, CancellationToken ct)
    {
        ReviewRules.Id(reviewId);
        ReviewRules.Id(input.RevisionId);
        if (input.Value is < -1 or > 1) throw ReviewRules.Invalid();
        return CommandAsync(actor, commandId, new { Action = "vote", ReviewId = reviewId, Input = input }, async () =>
        {
            // Serialize writers for this review while validating the current public revision and its counts.
            var review = await db.Reviews.FromSqlInterpolated($"SELECT * FROM [reviews].[Reviews] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={reviewId}")
                .SingleOrDefaultAsync(ct);
            if (review is null || review.IsWithdrawn || review.State != "Approved"
                || !options.IncludeDevelopmentExamples && IsDemo(review.OwnerId)
                || !await catalog.IsPublishedAsync(review.ProductId, ct))
                throw new BusinessException("not_found", "Review not found.");
            if (review.OwnerId == actor) throw new BusinessException("invalid_review", "You cannot vote for your own review.");
            if (review.CurrentRevisionId != input.RevisionId) throw Conflict();
            var vote = await db.Votes.SingleOrDefaultAsync(v => v.ReviewId == reviewId
                && v.RevisionId == input.RevisionId && v.VoterId == actor, ct);
            if (vote is not null) vote.Value = input.Value;
            else if (input.Value != 0) db.Votes.Add(new() { ReviewId = reviewId, RevisionId = input.RevisionId, VoterId = actor, Value = input.Value });
            await db.SaveChangesAsync(ct);
            var counts = await VoteCountsAsync(reviewId, input.RevisionId, ct);
            return new ReviewVoteResult(input.Value, counts.Likes, counts.Dislikes, false);
        }, result => result with { Replayed = true }, ct);
    }

    public async Task<Dictionary<string,int>> ReadVotesAsync(string actor, string productId, string revisions, CancellationToken ct)
    {
        ReviewRules.ProductId(productId);
        var ids = revisions.Split(',');
        if (ids.Length is < 1 or > 20 || ids.Distinct().Count() != ids.Length) throw ReviewRules.Invalid();
        foreach (var id in ids) ReviewRules.Id(id);
        if (!await catalog.IsPublishedAsync(productId, ct)) return [];
        return await (from r in VisibleReviews().AsNoTracking()
            where r.ProductId == productId && r.State == "Approved" && ids.Contains(r.CurrentRevisionId)
            join v in db.Votes.AsNoTracking() on new { ReviewId = r.Id, RevisionId = r.CurrentRevisionId } equals new { v.ReviewId, v.RevisionId }
            where v.VoterId == actor && v.Value != 0 select new { v.RevisionId, v.Value })
            .ToDictionaryAsync(v => v.RevisionId, v => v.Value, ct);
    }

    public Task<ReviewWithdrawResult> WithdrawAsync(string actor, string reviewId, string commandId, WithdrawReviewInput input, CancellationToken ct)
    {
        ReviewRules.Id(reviewId);
        ReviewRules.Version(input.Version);
        return CommandAsync(actor, commandId, new { Action = "withdraw", ReviewId = reviewId, Input = input }, async () =>
        {
            var row = await VisibleReviews().SingleOrDefaultAsync(r => r.Id == reviewId && r.OwnerId == actor, ct)
                ?? throw new BusinessException("not_found", "Review not found.");
            Match(row, input.Version);
            row.IsWithdrawn = true;
            row.ChangedAt = time.GetUtcNow();
            Event(row, actor, "Withdrawn", "");
            await db.SaveChangesAsync(ct);
            return new ReviewWithdrawResult(true, false);
        }, result => result with { Replayed = true }, ct);
    }

    public async Task<OwnedReviewActivityPage> OwnerActivityAsync(string actor, string? cursor, CancellationToken ct)
    {
        var before = ReviewRules.Cursor(cursor);
        var rows = await VisibleReviews().AsNoTracking().Where(r => r.OwnerId == actor && r.Sequence < before)
            .OrderByDescending(r => r.Sequence).Take(13).ToArrayAsync(ct);
        var items = new List<OwnedReviewActivity>();
        foreach (var row in rows.Take(12))
        {
            var counts = await VoteCountsAsync(row.Id, row.CurrentRevisionId, ct);
            items.Add(new(await PrivateAsync(row, ct), counts.Likes, counts.Dislikes));
        }
        return new(items.ToArray(), rows.Length > 12 ? rows[11].Sequence.ToString(CultureInfo.InvariantCulture) : null);
    }

    public async Task<string[]> ProductsWithoutReviewsAsync(string actor, string[] products, CancellationToken ct)
    {
        var reviewed = await VisibleReviews().Where(r => r.OwnerId == actor && products.Contains(r.ProductId))
            .Select(r => r.ProductId).ToArrayAsync(ct);
        return products.Except(reviewed, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private async Task<(int Likes, int Dislikes)> VoteCountsAsync(string reviewId, string revisionId, CancellationToken ct)
    {
        var counts = await db.Votes.Where(v => v.ReviewId == reviewId && v.RevisionId == revisionId && v.Value != 0)
            .GroupBy(v => v.Value).Select(g => new { Value = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Value, x => x.Count, ct);
        return (counts.GetValueOrDefault(1), counts.GetValueOrDefault(-1));
    }
}
