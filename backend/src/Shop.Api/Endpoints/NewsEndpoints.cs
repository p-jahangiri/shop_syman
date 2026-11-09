public static class NewsEndpoints
{
    public static void MapNews(this WebApplication app)
    {
        var development = app.Environment.IsDevelopment();
        app.MapGet("/api/content/news/fa", async (OfficialNewsFeed feed, CancellationToken ct) =>
            Results.Ok(new { feed = await feed.ReadPersianAsync(ct), development })).AllowAnonymous();
        app.MapGet("/api/content/news", async (OfficialNewsFeed feed, CancellationToken ct) =>
            Results.Ok(new { feed = await feed.ReadAsync(ct), development })).AllowAnonymous();
    }
}
