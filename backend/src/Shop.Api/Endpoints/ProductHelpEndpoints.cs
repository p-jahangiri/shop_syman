using System.Security.Claims;
using System.Text.RegularExpressions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Support;
using Shop.Modules.Cms;

public static class ProductHelpEndpoints
{
    public static void MapProductHelp(this WebApplication app)
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

        admin.MapPost("/support/tickets/{ticketId}/public-answer/{commandId}", async (
            string ticketId, string commandId, ProductAnswerInput input, HttpContext http,
            TicketService tickets, ICatalogService catalog, ContentService cms, ProductAnswersService answers, CancellationToken ct) =>
        {
            if (!origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal))
                return Results.StatusCode(403);
            if (!input.Confirmed || http.Request.QueryString.HasValue || string.IsNullOrWhiteSpace(input.Question)
                || string.IsNullOrWhiteSpace(input.Answer) || input.Question.Length > 240 || input.Answer.Length > 1200)
                return Results.BadRequest(new { title = "invalid_product_answer" });

            var actor = http.User.FindFirstValue("sub")!;
            var detail = await tickets.DetailAsync(actor, true, ticketId, ct);
            var ticket = detail.Ticket;
            if (!ticket.Subject.StartsWith("[product-question] ", StringComparison.Ordinal))
                return Results.BadRequest(new { title = "invalid_product_answer" });
            var messages = await tickets.MessagesAsync(actor, true, ticketId, null, ct);
            var message = messages.Items.FirstOrDefault();
            var slug = message?.Body.Split("\n\n", 2, StringSplitOptions.None).FirstOrDefault();
            if (message?.Author != "customer" || slug is null || !Regex.IsMatch(slug, @"\A[a-z0-9]+(?:-[a-z0-9]+)*\z") || slug.Length > 140)
                return Results.BadRequest(new { title = "invalid_product_answer" });
            var site = await cms.ReadAsync("site", ticket.Locale, ct);
            var hideUsed = site["appearance"]?["showUsedProducts"]?.GetValue<bool>() == false;
            var products = await catalog.LookupAsync(ticket.Locale, new ProductLookupInput(Slugs: [slug]), ct, hideUsed);
            var product = products.SingleOrDefault(x => x.Slug == slug);
            if (product is null) return Results.NotFound(new { title = "product_not_published" });

            var question = input.Question.Trim();
            var answer = input.Answer.Trim();
            var receipt = await tickets.ReplyAsync(actor, true, ticketId, commandId, new(input.Version, answer, ticket.Locale), ct);
            await answers.PublishAsync(product.Id, ticket.Locale, actor, ticketId, commandId, question, answer, receipt.Replayed, ct);
            return Results.Ok(receipt);
        }).RequireAuthorization("staff_mfa", "support.read", "support.write", "cms.write").RequireRateLimiting("support");

    }
}

public sealed record ProductAnswerInput(string Version, string Question, string Answer, bool Confirmed);
