using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

public sealed record OfficialNewsItem(string Title, string Url, DateTimeOffset PublishedAt, string? Source = null,
    string? Summary = null, string? ImageUrl = null);
public sealed record OfficialNewsSnapshot(IReadOnlyList<OfficialNewsItem> Items, DateTimeOffset? RefreshedAt, bool Stale);

public sealed partial class OfficialNewsFeed(TimeProvider clock) : IDisposable
{
    private const int MaxBytes = 2_000_000;
    private readonly HttpClient http = new(new SocketsHttpHandler { AllowAutoRedirect = false });
    private readonly FeedCache english = new();
    private readonly FeedCache persian = new();

    private sealed class FeedCache
    {
        public SemaphoreSlim Gate { get; } = new(1);
        public OfficialNewsSnapshot Snapshot { get; set; } = new([], null, false);
        public DateTimeOffset NextAttempt { get; set; }
    }

    public Task<OfficialNewsSnapshot> ReadAsync(CancellationToken ct) =>
        RefreshAsync(english, async budget => Parse(await FetchAsync("https://www.apple.com/newsroom/rss-feed.rss", budget)), ct);

    public Task<OfficialNewsSnapshot> ReadPersianAsync(CancellationToken ct) =>
        RefreshAsync(persian, async budget =>
        {
            var sources = await Task.WhenAll(
                TryPersianAsync("https://www.zoomit.ir/feed/", "www.zoomit.ir", "زومیت", budget),
                TryPersianAsync("https://digiato.com/feed", "digiato.com", "دیجیاتو", budget),
                TryPersianAsync("https://www.mobile.ir/news/rss.aspx", "www.mobile.ir", "مرجع موبایل ایران", budget),
                TryPersianAsync("https://gadgetnews.net/feed/", "gadgetnews.net", "گجت‌نیوز", budget),
                TryPersianAsync("https://itresan.com/feed/", "itresan.com", "آی‌تی‌رسان", budget));
            if (sources.All(x => x is null)) throw new HttpRequestException("Persian sources unavailable.");
            var now = clock.GetUtcNow();
            return sources.OfType<IReadOnlyList<OfficialNewsItem>>()
                .SelectMany(source => source.Where(x => x.PublishedAt >= now.AddDays(-14) && x.PublishedAt <= now.AddMinutes(10))
                    .OrderByDescending(x => x.PublishedAt).DistinctBy(x => x.Url).Take(4))
                .OrderByDescending(x => x.PublishedAt).ToArray();
        }, ct, timeoutSeconds: 6);

    private async Task<IReadOnlyList<OfficialNewsItem>?> TryPersianAsync(string feed, string host, string source, CancellationToken ct)
    {
        try { return ParsePersian(await FetchAsync(feed, ct), host, source); }
        catch (Exception error) when (IsFeedFailure(error)) { return null; }
    }

    private async Task<OfficialNewsSnapshot> RefreshAsync(FeedCache cache, Func<CancellationToken, Task<IReadOnlyList<OfficialNewsItem>>> load,
        CancellationToken ct, int timeoutSeconds = 4)
    {
        await cache.Gate.WaitAsync(ct);
        try
        {
            var now = clock.GetUtcNow();
            if (now < cache.NextAttempt) return cache.Snapshot;
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
            budget.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
            try
            {
                var entries = await load(budget.Token);
                ct.ThrowIfCancellationRequested();
                cache.Snapshot = new(entries, now, false);
                cache.NextAttempt = now.AddMinutes(30);
            }
            catch (Exception error) when (!ct.IsCancellationRequested && IsFeedFailure(error))
            {
                cache.NextAttempt = now.AddMinutes(5);
                cache.Snapshot = now - cache.Snapshot.RefreshedAt <= TimeSpan.FromDays(1)
                    ? cache.Snapshot with { Stale = true }
                    : new([], null, true);
            }
            return cache.Snapshot;
        }
        finally { cache.Gate.Release(); }
    }

    private static bool IsFeedFailure(Exception error) =>
        error is HttpRequestException or IOException or XmlException or OperationCanceledException;

    private async Task<XDocument> FetchAsync(string feed, CancellationToken ct)
    {
        using var response = await http.GetAsync(feed, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaxBytes) throw new XmlException("Feed capacity exceeded.");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var bytes = new MemoryStream();
        var buffer = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (bytes.Length + count > MaxBytes) throw new XmlException("Feed capacity exceeded.");
            bytes.Write(buffer, 0, count);
        }
        bytes.Position = 0;
        using var xml = XmlReader.Create(bytes, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxBytes
        });
        return XDocument.Load(xml);
    }

    public static IReadOnlyList<OfficialNewsItem> Parse(XDocument document)
    {
        XNamespace atom = "http://www.w3.org/2005/Atom";
        if (document.Root?.Name != atom + "feed") throw new XmlException("Atom feed required.");
        var entries = new List<OfficialNewsItem>();
        foreach (var item in document.Root.Elements(atom + "entry").Take(100))
        {
            var title = ((string?)item.Element(atom + "title"))?.Trim();
            if (!ValidTitle(title) || (!title.Contains("iPhone", StringComparison.OrdinalIgnoreCase)
                && !title.Contains("iOS", StringComparison.OrdinalIgnoreCase))) continue;
            var link = (string?)item.Elements(atom + "link")
                .FirstOrDefault(x => (string?)x.Attribute("rel") is null or "alternate")?.Attribute("href");
            var url = SafeLink(link, "www.apple.com");
            if (url is null || !url.AbsolutePath.StartsWith("/newsroom/", StringComparison.Ordinal)
                || !TryDate((string?)(item.Element(atom + "published") ?? item.Element(atom + "updated")), out var date)) continue;
            entries.Add(new(title, url.GetLeftPart(UriPartial.Path), date.ToUniversalTime(), "Apple Newsroom"));
        }
        return entries.OrderByDescending(x => x.PublishedAt).DistinctBy(x => x.Url).Take(8).ToArray();
    }

    public static IReadOnlyList<OfficialNewsItem> ParsePersian(XDocument document, string host, string source)
    {
        var channel = document.Root?.Element("channel") ?? throw new XmlException("RSS channel required.");
        var entries = new List<OfficialNewsItem>();
        foreach (var item in channel.Elements("item").Take(100))
        {
            var title = ((string?)item.Element("title"))?.Trim();
            if (!ValidTitle(title) || !title.Any(c => c is >= '\u0600' and <= '\u06ff')) continue;
            var link = ((string?)item.Element("link"))?.Trim();
            if (host == "www.mobile.ir" && link?.StartsWith("http://www.mobile.ir/news/view-", StringComparison.Ordinal) == true)
                link = "https" + link[4..];
            var url = SafeLink(link, host);
            if (url is null || !TryDate((string?)item.Element("pubDate"), out var date)) continue;
            if (url.AbsolutePath.StartsWith("/promoted/", StringComparison.Ordinal)
                || title.Contains("رجیستری ادیتور", StringComparison.Ordinal)
                || title.StartsWith("گزارش مالی ", StringComparison.Ordinal)
                || item.Elements("category").Any(category => category.Value is "مطالب مانیتور" or "مطالب تلویزیون" or "رپورتاژ آگهی")) continue;
            var relevant = (host == "www.mobile.ir" && url.AbsolutePath.StartsWith("/news/view-", StringComparison.Ordinal))
                || url.AbsolutePath.StartsWith("/mobile/", StringComparison.Ordinal)
                || item.Elements("category").Any(category => category.Value is "مطالب موبایل" or "اخبار موبایل" or "موبایل" or "گوشی موبایل")
                || new[] { "گوشی", "آیفون", "اندروید", "رجیستری", "همتا", "سیم‌کارت", "گلکسی", "گوگل پیکسل", "iOS", "One UI", "5G", "سیری" }
                    .Any(word => title.Contains(word, StringComparison.OrdinalIgnoreCase));
            if (!relevant) continue;
            var description = (string?)item.Element("description");
            // Zoomit's RSS copyright notice limits republication. Keep its headline and link.
            var summary = host == "www.zoomit.ir" ? null : ReadSummary(description);
            var image = ReadImage(host, description);
            entries.Add(new(title, url.GetLeftPart(UriPartial.Path), date.ToUniversalTime(), source,
                string.Equals(summary, title, StringComparison.Ordinal) ? null : summary, image));
        }
        return entries;
    }

    private static string? ReadSummary(string? description)
    {
        if (string.IsNullOrWhiteSpace(description)) return null;
        var decoded = WebUtility.HtmlDecode(description[..Math.Min(description.Length, 4096)]);
        var plain = Whitespace().Replace(HtmlTags().Replace(decoded, " "), " ").Trim();
        plain = plain.Replace("واحد خبر mobile.ir :", "", StringComparison.Ordinal);
        var footer = plain.IndexOf(" نوشته ", StringComparison.Ordinal);
        if (footer < 0) footer = plain.IndexOf(" The post ", StringComparison.Ordinal);
        if (footer >= 0) plain = plain[..footer];
        var words = Whitespace().Split(new string(plain.Where(c => !char.IsControl(c) || char.IsWhiteSpace(c)).ToArray()).Trim());
        var summary = string.Join(' ', words.Take(24));
        if (summary.Length > 280) return summary[..279].TrimEnd() + "…";
        return summary.Length < 24 ? null : words.Length > 24 ? summary.TrimEnd('.', '…') + "…" : summary;
    }

    private static string? ReadImage(string host, string? description)
    {
        // Read a publisher's own teaser thumbnail only. Never fetch or proxy an image in the API.
        var (imageHost, path) = host switch
        {
            "www.mobile.ir" => ("s.mobile.ir", "/Static/cache/newsthumbs/"),
            "gadgetnews.net" => ("gadgetnews.net", "/wp-content/uploads/"),
            _ => ("", "")
        };
        if (description is null || imageHost.Length == 0) return null;
        var match = HtmlImage().Match(description[..Math.Min(description.Length, 4096)]);
        if (!match.Success) return null;
        var value = WebUtility.HtmlDecode(match.Groups[1].Value);
        if (value.StartsWith("//", StringComparison.Ordinal)) value = "https:" + value;
        var image = SafeLink(value, imageHost);
        return image is not null && image.AbsolutePath.StartsWith(path, StringComparison.Ordinal)
            && ImageExtension().IsMatch(image.AbsolutePath) ? image.GetLeftPart(UriPartial.Path) : null;
    }

    [GeneratedRegex("<[^<>]*>")]
    private static partial Regex HtmlTags();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex("<img\\b[^<>]*?\\ssrc\\s*=\\s*[\"']([^\"'<>]+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex HtmlImage();

    [GeneratedRegex(@"\.(?:jpe?g|png|webp)$", RegexOptions.IgnoreCase)]
    private static partial Regex ImageExtension();

    private static bool ValidTitle([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? title) => title is { Length: > 0 and <= 240 } && !title.Any(char.IsControl);
    private static Uri? SafeLink(string? link, string host) =>
        link is { Length: > 0 and <= 1000 } && Uri.TryCreate(link, UriKind.Absolute, out var url)
        && url.Scheme == "https" && url.Host == host && url.IsDefaultPort && url.UserInfo.Length == 0 ? url : null;

    private static bool TryDate(string? value, out DateTimeOffset result) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out result);

    public void Dispose()
    {
        http.Dispose();
        english.Gate.Dispose();
        persian.Gate.Dispose();
    }
}
