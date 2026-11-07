using System.Text.Json.Nodes;

namespace Shop.Modules.Cms;

// The original Persian site document owns the common configuration. A translation
// supplies copy for matching parts of that configuration without overriding it.
internal static class SharedSiteSettings
{
    private static readonly string[] RootFields = ["latinName", "logoUrl", "font", "palette", "appearance"];
    private static readonly string[] HeroCopy = ["eyebrow", "title", "description", "action", "secondary", "visualTitle", "floatingTitle", "floatingDescription", "footnote"];
    private static readonly string[] BlockCopy = ["eyebrow", "title", "description", "action"];
    private static readonly string[] BannerCopy = ["eyebrow", "title", "action", "watermark"];

    internal static void Apply(JsonObject published, JsonObject translation)
    {
        foreach (var field in RootFields)
            CopyField(published, translation, field);

        CopyGroup(published, translation, "contact", ["address", "hours"]);
        MergeSeo(published, translation);
        CopyGroup(published, translation, "hero", HeroCopy);

        if (published["nav"] is JsonArray menu)
            translation["nav"] = MergeMenu(menu, translation["nav"] as JsonArray);

        if (published["homeBlocks"] is JsonArray blocks)
            translation["homeBlocks"] = MergeBlocks(blocks, translation["homeBlocks"] as JsonArray);
        else
            translation.Remove("homeBlocks");

        var translatedIdentity = translation["storeIdentity"] as JsonObject;
        CopyField(published, translation, "storeIdentity");
        if (translation["storeIdentity"] is JsonObject identity)
        {
            foreach (var collection in new[] { "badges", "policyLinks" })
            {
                if (identity[collection] is not JsonArray items) continue;
                foreach (var item in items.OfType<JsonObject>())
                    ApplyCopy(item, Find(translatedIdentity?[collection] as JsonArray, "id", item["id"]), ["title"]);
            }
        }
    }

    private static void MergeSeo(JsonObject published, JsonObject translation)
    {
        var translated = translation["seo"] as JsonObject;
        var result = published["seo"]?.DeepClone() as JsonObject ?? new JsonObject();
        foreach (var field in new[] { "title", "description" })
        {
            result.Remove(field);
            CopyField(translated, result, field);
        }
        if (result.Count == 0) translation.Remove("seo");
        else translation["seo"] = result;
    }

    private static void CopyGroup(JsonObject published, JsonObject translation, string key, string[] copyFields)
    {
        var localized = translation[key] as JsonObject;
        CopyField(published, translation, key);
        if (translation[key] is JsonObject copy)
            ApplyCopy(copy, localized, copyFields);
    }

    private static JsonArray MergeMenu(JsonArray source, JsonArray? translated)
    {
        var result = (JsonArray)source.DeepClone();
        foreach (var item in result.OfType<JsonObject>())
        {
            var match = Find(translated, "href", item["href"]);
            ApplyCopy(item, match, ["label"]);
            if (item["children"] is JsonArray children)
                item["children"] = MergeMenu(children, match?["children"] as JsonArray);
        }
        return result;
    }

    private static JsonArray MergeBlocks(JsonArray source, JsonArray? translated)
    {
        var result = (JsonArray)source.DeepClone();
        foreach (var block in result.OfType<JsonObject>())
        {
            var match = Find(translated, "id", block["id"]);
            if (!JsonNode.DeepEquals(block["kind"], match?["kind"])) continue;
            ApplyCopy(block, match, BlockCopy);
            if (block["items"] is not JsonArray banners) continue;
            var localized = match?["items"] as JsonArray;
            foreach (var banner in banners.OfType<JsonObject>())
                ApplyCopy(banner, Find(localized, "href", banner["href"]), BannerCopy);
        }
        return result;
    }

    private static JsonObject? Find(JsonArray? rows, string field, JsonNode? value) =>
        value is null ? null : rows?.OfType<JsonObject>().FirstOrDefault(item => JsonNode.DeepEquals(item[field], value));

    private static void ApplyCopy(JsonObject target, JsonObject? translated, string[] fields)
    {
        foreach (var field in fields)
            if (target.ContainsKey(field) && translated?[field] is JsonValue value && value.TryGetValue<string>(out var text) && !string.IsNullOrWhiteSpace(text))
                target[field] = text;
    }

    private static void CopyField(JsonObject? source, JsonObject target, string field)
    {
        if (source is not null && source.TryGetPropertyValue(field, out var value))
            target[field] = value?.DeepClone();
        else
            target.Remove(field);
    }
}
