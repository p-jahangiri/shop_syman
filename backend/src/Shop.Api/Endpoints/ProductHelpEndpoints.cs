using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Support;
using Shop.Modules.Cms;
using Shop.SharedKernel;

public static class ProductHelpEndpoints
{
    public static void MapProductHelp(this WebApplication app, string[] origins)
    {
        var development = app.Environment.IsDevelopment();
        app.MapGet("/api/content/product-help/{locale}/{id}", async (string locale, string id, HttpContext http, ContentService cms, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (locale is not ("fa" or "en") || http.Request.QueryString.HasValue) return Results.BadRequest();
            var key = ProductHelpRules.Key(id);
            var language = await cms.ReadAsync(key, locale, ct);
            var shared = locale == "fa" ? language : await cms.ReadAsync(key, "fa", ct);
            var localHelp = language.Count == 0 ? null : ProductHelpRules.Read(key, language);
            var sharedHelp = shared.Count == 0 ? null : ProductHelpRules.Read(key, shared);
            if (localHelp?.IsDemo == true && !development) localHelp = null;
            if (sharedHelp?.IsDemo == true && !development) sharedHelp = null;
            return Results.Ok(new
            {
                development,
                configured = localHelp is not null || sharedHelp is not null,
                questionsIsDemo = localHelp?.IsDemo == true,
                accessoriesIsDemo = sharedHelp?.IsDemo == true,
                accessoryIds = sharedHelp?.AccessoriesEnabled == true ? sharedHelp.AccessoryIds : [],
                questions = localHelp?.Questions ?? [],
                publishedAnswers = await answers.ReadAsync(id, locale, ct)
            });
        }).AllowAnonymous();

        app.MapPost("/api/support/product-questions/{locale}/{id}/{threadId}/replies/{commandId}", async (
            string locale, string id, string threadId, string commandId, CommunityReplyInput input,
            HttpContext http, IReviewProductReader catalog, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (!origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal))
                return Results.StatusCode(403);
            if (locale is not ("fa" or "en") || http.Request.QueryString.HasValue || input.Body is null || input.Body.Length > 1200)
                return Results.BadRequest(new { title = "invalid_product_answer" });
            _ = ProductHelpRules.Key(id);
            if (!await catalog.IsPublishedAsync(id, ct)) return Results.NotFound();
            await answers.SubmitReplyAsync(id, locale, threadId, http.User.FindFirstValue("sub")!, commandId,
                input.Body.Trim(), input.DisplayName, ct);
            return Results.NoContent();
        }).RequireAuthorization("customer").RequireRateLimiting("support")
            .WithMetadata(new RequestSizeLimitAttribute(16384));
    }

    public static void MapProductHelpAdmin(this RouteGroupBuilder admin, string[] origins)
    {
        admin.MapGet("/content/product-help/{locale}/{id}", async (string locale, string id, ContentService cms, IHostEnvironment env, CancellationToken ct) =>
        {
            if (locale is not ("fa" or "en")) return Results.BadRequest();
            var document = await cms.ProductHelpDraftAsync(id, locale, ct);
            return Results.Ok(new
            {
                development = env.IsDevelopment(),
                document = document is null ? null : new { document.DraftJson, document.PublishedJson, document.Version }
            });
        }).RequireAuthorization("cms.read");

        admin.MapGet("/support/tickets/{ticketId}/public-thread", async (
            string ticketId, HttpContext http, TicketService tickets, ICatalogService catalog,
            ContentService cms, ProductAnswersService answers, CancellationToken ct) =>
        {
            var source = await FindQuestionAsync(http.User.FindFirstValue("sub")!, ticketId, tickets, catalog, cms, ct);
            if (source is null) return Results.NotFound();
            return Results.Ok(new
            {
                source.DisplayName,
                thread = await answers.ReadForTicketAsync(source.ProductId, source.Ticket.Locale, ticketId, ct)
            });
        }).RequireAuthorization("staff_mfa", "support.read", "support.write", "cms.write");

        admin.MapPut("/support/tickets/{ticketId}/public-thread/replies/{replyId}", async (
            string ticketId, string replyId, ModerateCommunityReplyInput input, HttpContext http,
            TicketService tickets, ICatalogService catalog, ContentService cms, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (!origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal))
                return Results.StatusCode(403);
            if (http.Request.QueryString.HasValue || input.Publish is null) return Results.BadRequest();
            var actor = http.User.FindFirstValue("sub")!;
            var source = await FindQuestionAsync(actor, ticketId, tickets, catalog, cms, ct);
            if (source is null) return Results.NotFound();
            await answers.ModerateAsync(source.ProductId, source.Ticket.Locale, ticketId, actor, replyId, input.Publish.Value, ct);
            return Results.Ok(new { saved = true });
        }).RequireAuthorization("staff_mfa", "support.read", "support.write", "cms.write").RequireRateLimiting("support");

        admin.MapPost("/support/tickets/{ticketId}/public-answer/{commandId}", async (
            string ticketId, string commandId, ProductAnswerInput input, HttpContext http,
            TicketService tickets, ICatalogService catalog, ContentService cms, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (!origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal))
                return Results.StatusCode(403);
            if (!input.Confirmed || http.Request.QueryString.HasValue || string.IsNullOrWhiteSpace(input.Question)
                || input.Answer is null || input.Question.Length > 240 || input.Answer.Length > 1200
                || !Guid.TryParseExact(commandId, "N", out var command) || command.ToString("N") != commandId)
                return Results.BadRequest(new { title = "invalid_product_answer" });

            var actor = http.User.FindFirstValue("sub")!;
            var source = await FindQuestionAsync(actor, ticketId, tickets, catalog, cms, ct);
            if (source is null) return Results.NotFound(new { title = "product_not_published" });
            var ticket = source.Ticket;

            var question = input.Question.Trim();
            var answer = input.Answer.Trim();
            var receipt = answer.Length > 0
                ? await tickets.ReplyAsync(actor, true, ticketId, commandId, new(input.Version, answer, ticket.Locale), ct)
                : null;
            await answers.PublishAsync(source.ProductId, ticket.Locale, actor, ticketId, commandId,
                question, answer, source.DisplayName, receipt is not null || ticket.Version == input.Version,
                receipt?.Replayed == true, ct);
            return receipt is null ? Results.Ok(new { published = true }) : Results.Ok(receipt);
        }).RequireAuthorization("staff_mfa", "support.read", "support.write", "cms.write").RequireRateLimiting("support");

    }

    private static async Task<QuestionSource?> FindQuestionAsync(string actor, string ticketId, TicketService tickets,
        ICatalogService catalog, ContentService cms, CancellationToken ct)
    {
        var ticket = (await tickets.DetailAsync(actor, true, ticketId, ct)).Ticket;
        if (!ticket.Subject.StartsWith("[product-question] ", StringComparison.Ordinal)) return null;
        var first = (await tickets.MessagesAsync(actor, true, ticketId, null, ct)).Items.FirstOrDefault();
        if (first?.Author != "customer") return null;
        var parts = first.Body.Split("\n\n", 2, StringSplitOptions.None);
        var slug = parts[0];
        if (parts.Length != 2 || slug.Length > 140 || !Regex.IsMatch(slug, @"\A[a-z0-9]+(?:-[a-z0-9]+)*\z")) return null;
        const string marker = "[public-name] ";
        var second = parts[1].Split("\n\n", 2, StringSplitOptions.None);
        var displayName = second.Length == 2 && second[0].StartsWith(marker, StringComparison.Ordinal)
            ? ProductAnswersService.DisplayName(second[0][marker.Length..]) : null;
        var site = await cms.ReadAsync("site", ticket.Locale, ct);
        var hideUsed = site["appearance"]?["showUsedProducts"]?.GetValue<bool>() == false;
        var products = await catalog.LookupAsync(ticket.Locale, new ProductLookupInput(Slugs: [slug]), ct, hideUsed);
        var product = products.SingleOrDefault(x => x.Slug == slug);
        return product is null ? null : new(ticket, product.Id, displayName);
    }

    private sealed record QuestionSource(TicketSummary Ticket, string ProductId, string? DisplayName);
}

public sealed record ProductAnswerInput(string Version, string Question, string Answer, bool Confirmed);
public sealed record CommunityReplyInput(string Body, string? DisplayName);
public sealed record ModerateCommunityReplyInput(bool? Publish);
