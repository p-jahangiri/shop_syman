using System.Text.Json.Nodes;

namespace Shop.Modules.Cms;

// Extract only image fields in validated CMS contracts. Editorial strings and
// arbitrary JSON fields are never interpreted as media references.
public static class CmsImageReferences
{
    public static string[] Site(JsonObject site)
    {
        var urls = new List<string>();
        Add(urls, site["logoUrl"]);
        Add(urls, site["hero"]?["image"]);
        Add(urls, site["seo"]?["shareImage"]);
        if (site["storeIdentity"]?["badges"] is JsonArray badges)
            foreach (var badge in badges.OfType<JsonObject>()) Add(urls, badge["imageUrl"]);
        if (site["homeBlocks"] is JsonArray blocks)
            foreach (var block in blocks.OfType<JsonObject>())
                if (block["items"] is JsonArray items)
                    foreach (var item in items.OfType<JsonObject>()) Add(urls, item["image"]);
        return urls.Distinct(StringComparer.Ordinal).ToArray();
    }

    public static string[] Page(CmsPageContent page) => new[] { page.Fa, page.En }
        .SelectMany(language => language.Blocks)
        .Where(block => block.Kind == "Image")
        .Select(block => block.Image!)
        .Distinct(StringComparer.Ordinal).ToArray();

    public static string[] Blog(CmsBlogContent blog)
    {
        var urls = Page(blog.Body).ToList();
        if (blog.Cover is not null) urls.Add(blog.Cover);
        return urls.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static void Add(List<string> urls, JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<string>(out var url)) urls.Add(url);
    }
}
