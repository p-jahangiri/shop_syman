using System.Security.Claims;
using System.Text.RegularExpressions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Cms;
using Shop.Modules.Reviews;
using Shop.Modules.Support;
using Shop.SharedKernel;

internal static class ReviewAccountEndpoints
{
    private sealed record ProductLink(string Id, string Slug, string Name, string Image);
    private static ProductLink Link(ProductDto product) => new(product.Id, product.Slug, product.Name, product.Image);

    internal static void MapReviewAccount(this RouteGroupBuilder group)
    {
        group.MapGet("/account/{section}", async (string section, string locale, string? cursor, ClaimsPrincipal user,
            ReviewService reviews, IReviewPurchaseReader purchases, ICatalogService catalog, ContentService cms,
            TicketService tickets, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (locale is not ("fa" or "en")) return Results.BadRequest();
            var actor = user.FindFirstValue("sub")!;
            var site = await cms.ReadAsync("site", locale, ct);
            var hideUsed = site["appearance"]?["showUsedProducts"]?.GetValue<bool>() == false;
            if (section == "pending")
            {
                if (cursor is not null) return Results.BadRequest();
                var purchased = await purchases.RecentDeliveredProductsAsync(actor, ct);
                var ids = await reviews.ProductsWithoutReviewsAsync(actor, purchased, ct);
                var products = await Lookup(new(ProductIds: ids), ids.Length);
                return Results.Ok(new { items = ids.Where(products.ContainsKey).Select(id => products[id]) });
            }
            if (section == "reviews")
            {
                var page = await reviews.OwnerActivityAsync(actor, cursor, ct);
                var ids = page.Items.Select(x => x.Review.ProductId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                var products = await Lookup(new(ProductIds: ids), ids.Length);
                return Results.Ok(new { items = page.Items.Select(x => new {
                    x.Review, x.Likes, x.Dislikes, product = products.GetValueOrDefault(x.Review.ProductId)
                }), page.NextCursor });
            }
            if (section != "questions") return Results.NotFound();
            var history = await tickets.PageAsync(actor, false, null, cursor, ct, pageSize: 12);
            var questions = new List<(TicketSummary Ticket, string Slug, string Body, string? Reply)>();
            foreach (var ticket in history.Items.Where(t => t.Subject.StartsWith("[product-question] ", StringComparison.Ordinal)))
            {
                var messages = await tickets.ProductQuestionMessagesAsync(actor, ticket.Id, ct);
                var parts = messages.Question.Split("\n\n", 2, StringSplitOptions.None);
                if (parts.Length != 2 || parts[0].Length > 140 || !Regex.IsMatch(parts[0], @"\A[a-z0-9]+(?:-[a-z0-9]+)*\z")) continue;
                var body = parts[1];
                if (body.StartsWith("[public-name] ", StringComparison.Ordinal))
                    body = body.Split("\n\n", 2, StringSplitOptions.None).ElementAtOrDefault(1) ?? body;
                questions.Add((ticket, parts[0], body, messages.Reply));
            }
            var slugs = questions.Select(q => q.Slug).Distinct(StringComparer.Ordinal).ToArray();
            var bySlug = (await Lookup(new(Slugs: slugs), slugs.Length)).Values.ToDictionary(x => x.Slug, StringComparer.Ordinal);
            var result = new List<object>();
            foreach (var item in questions)
            {
                var product = bySlug.GetValueOrDefault(item.Slug);
                var thread = product is null ? null : await answers.ReadForTicketAsync(product.Id, item.Ticket.Locale, item.Ticket.Id, ct);
                result.Add(new {
                    item.Ticket.Id,
                    name = item.Ticket.Subject["[product-question] ".Length..],
                    item.Ticket.CreatedAt,
                    item.Ticket.State,
                    question = thread?.Question.Question ?? item.Body,
                    product,
                    published = thread is not null,
                    replies = thread?.Question.Replies?.TakeLast(4).ToArray() ?? [],
                    replyCount = thread?.Question.Replies?.Length ?? 0,
                    privateReply = thread?.Question.Replies?.Any(r => r.ByStore && r.Body == item.Reply) == true ? null : item.Reply
                });
            }
            return Results.Ok(new { items = result, history.NextCursor });

            async Task<Dictionary<string,ProductLink>> Lookup(ProductLookupInput input, int count) => count == 0
                ? new(StringComparer.OrdinalIgnoreCase)
                : (await catalog.LookupAsync(locale, input, ct, hideUsed)).Select(Link)
                    .ToDictionary(x => x.Id, StringComparer.OrdinalIgnoreCase);
        }).RequireAuthorization("customer");
    }
}
