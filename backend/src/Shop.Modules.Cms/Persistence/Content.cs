using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;
public sealed class ContentDocument
{
    public string Key { get; set; } = "";
    public string Locale { get; set; } = "fa";
    public string DraftJson { get; set; } = "{}";
    public string? PublishedJson { get; set; }
    public int Revision { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string UpdatedBy { get; set; } = "";
    public byte[] Version { get; set; } = [];
}
public sealed class ContentRevision
{
    public long Id { get; set; }
    public string Key { get; set; } = "";
    public string Locale { get; set; } = "fa";
    public int Revision { get; set; }
    public string Json { get; set; } = "{}";
    public string PublishedBy { get; set; } = "";
    public DateTimeOffset PublishedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed partial class CmsDbContext(DbContextOptions<CmsDbContext> options) : DbContext(options)
{
    public DbSet<ContentDocument> Documents => Set<ContentDocument>();
    public DbSet<ContentRevision> Revisions => Set<ContentRevision>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("cms");
        ConfigurePages(b);ConfigureBlogPosts(b);
        CmsRedirectModel.Configure(b);
        b.Entity<ContentDocument>(e => { e.HasKey(x => new { x.Key, x.Locale }); e.Property(x => x.Key).HasMaxLength(80); e.Property(x => x.Locale).HasMaxLength(2); e.Property(x => x.UpdatedBy).HasMaxLength(64); e.Property(x => x.Version).IsRowVersion(); });
        b.Entity<ContentRevision>(e => { e.HasKey(x => x.Id); e.Property(x => x.Key).HasMaxLength(80); e.Property(x => x.Locale).HasMaxLength(2); e.Property(x => x.PublishedBy).HasMaxLength(64); e.HasIndex(x => new { x.Key, x.Locale, x.Revision }).IsUnique(); });
    }
}
public record ContentInput(JsonObject Content, string? Version);
public sealed class ContentService(CmsDbContext db, IPublicImageReferences images, ICustomerLoginContinuity loginContinuity, bool development = false) : ISiteContentReader
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    public async Task<WarrantyTemplateLibrary> ReadWarrantyTemplatesAsync(CancellationToken ct)
    {
        var document = await db.Documents.AsNoTracking()
            .SingleOrDefaultAsync(row => row.Key == WarrantyTemplateRules.Key && row.Locale == "fa", ct);
        if (document is null) return new(null, []);
        var items = JsonSerializer.Deserialize<WarrantyTemplate[]>(document.DraftJson, WebJson)
            ?? throw new InvalidOperationException("Warranty templates could not be read.");
        return new(Convert.ToBase64String(document.Version), items);
    }

    public Task SaveWarrantyTemplatesAsync(WarrantyTemplateLibrary input, string actor, CancellationToken ct)
    {
        WarrantyTemplateRules.Validate(input.Items);
        return SaveDocumentAsync(WarrantyTemplateRules.Key, "fa", JsonSerializer.Serialize(input.Items, WebJson), input.Version, actor, ct);
    }

    public async Task<JsonObject> ReadAsync(string key, string locale, CancellationToken ct)
    {
        var documents = db.Documents.AsNoTracking().Where(x => x.Key == key);
        var shared = key == "site" && locale == "en";
        var rows = await documents.Where(x => x.Locale == locale || (shared && x.Locale == "fa"))
            .Select(x => new { x.Locale, x.PublishedJson }).ToListAsync(ct);
        var json = rows.SingleOrDefault(x => x.Locale == locale)?.PublishedJson;
        var content = json is null ? new JsonObject() : JsonNode.Parse(json)!.AsObject();
        if (key == "site")
        {
            var settings = shared ? rows.SingleOrDefault(x => x.Locale == "fa")?.PublishedJson : null;
            if (json is not null && settings is not null)
                SharedSiteSettings.Apply(JsonNode.Parse(settings)!.AsObject(), content);
            content.Remove("paletteLibrary");
            StoreIdentityRules.ProjectPublic(content, development);
        }
        return content;
    }
    public Task<ContentDocument?> ProductHelpDraftAsync(string id, string locale, CancellationToken ct)
    {
        var key = ProductHelpRules.Key(id);
        return db.Documents.AsNoTracking().SingleOrDefaultAsync(x => x.Key == key && x.Locale == locale, ct);
    }

    public async Task<object> AdminAsync(CancellationToken ct) => new { Documents = await db.Documents.AsNoTracking().Where(x => x.Key != WarrantyTemplateRules.Key && !x.Key.StartsWith(ProductHelpRules.Prefix) && !x.Key.StartsWith(ProductAnswersService.Prefix)).OrderBy(x => x.Key).ThenBy(x => x.Locale).ToListAsync(ct), Revisions = await db.Revisions.AsNoTracking().Where(x => !x.Key.StartsWith(ProductHelpRules.Prefix) && !x.Key.StartsWith(ProductAnswersService.Prefix)).OrderByDescending(x => x.Id).Take(50).Select(x => new { x.Id, x.Key, x.Locale, x.Revision, x.PublishedBy, x.PublishedAt }).ToListAsync(ct) };
    public static void Validate(string key, string locale, JsonObject value)
    {
        if (locale is "fa" or "en" && ProductHelpRules.IsKey(key))
        {
            _ = ProductHelpRules.Read(key, value);
            return;
        }
        if (locale is "fa" or "en" && key == CategoryReturnGuidance.DocumentKey)
        {
            CategoryReturnGuidance.Validate(value);
            return;
        }
        if (locale is not ("fa" or "en") || key is not ("site" or "auth" or "support")) throw new BusinessException("invalid_content", "Unsupported content key, locale or document size.");
        if (key == "support") { _ = SupportContentRules.Read(value); return; }
        if (JsonSerializer.SerializeToUtf8Bytes(value).Length > 100000) throw new BusinessException("invalid_content", "Unsupported content key, locale or document size.");
        if (key == "auth") {
            if (locale != "fa") throw new BusinessException("global_auth_settings", "Authentication settings are global; edit the fa settings document.");
            var keys = new[] { "mobileOtp", "emailPassword", "usernamePassword", "registration", "passwordReset" };
            if (keys.Any(k => value[k] is not JsonValue v || !v.TryGetValue<bool>(out _)) || value.Any(p => !keys.Contains(p.Key))) throw new BusinessException("invalid_auth_settings", "Provide only the supported boolean authentication settings.");
            if (value["emailPassword"]!.GetValue<bool>() == false && value["usernamePassword"]!.GetValue<bool>() == false && value["mobileOtp"]!.GetValue<bool>() == false) throw new BusinessException("no_login_method", "At least one customer login method must remain enabled.");
            CustomerAuthSettingsRules.RequireSupportedLogin(value);
            return;
        }
        foreach (var k in new[] { "name", "latinName", "tagline", "announcement", "about", "chequeDisclaimer" }) if (value[k] is not JsonValue v || !v.TryGetValue<string>(out var s) || string.IsNullOrWhiteSpace(s) || s.Length > 4000) throw new BusinessException("invalid_site_content", $"Missing or invalid site field: {k}.");
        if (value["seo"] is JsonObject seo) {
            foreach (var pair in seo) {
                if (pair.Key == "allowIndexing") { if (pair.Value is not JsonValue flag || !flag.TryGetValue<bool>(out _)) throw new BusinessException("invalid_seo", "Indexing permission must be boolean."); }
                else if (pair.Key is "title" or "description" or "shareImage") {
                    if (pair.Value is not JsonValue textNode || !textNode.TryGetValue<string>(out var text) || text.Length > (pair.Key == "title" ? 150 : pair.Key == "description" ? 400 : 2048)) throw new BusinessException("invalid_seo", "SEO fields must contain bounded text.");
                    if (pair.Key == "shareImage") {
                        ValidateImage(pair.Value);
                        if (text.Contains('?') || text.Contains('#') || text.Contains('\\') || text.Any(char.IsWhiteSpace) || text.StartsWith("https:", StringComparison.Ordinal) && (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0)) throw new BusinessException("invalid_seo", "Use a public image without credentials or query parameters.");
                    }
                }
                else throw new BusinessException("invalid_seo", "Unsupported SEO field.");
            }
        }
        else if (value["seo"] is not null) throw new BusinessException("invalid_seo", "SEO settings must be an object.");
        if (value["hero"] is not JsonObject hero || new[] { "eyebrow", "title", "description", "action", "secondary" }.Any(k => hero[k] is not JsonValue v || !v.TryGetValue<string>(out var s) || s.Length > 4000)) throw new BusinessException("invalid_hero", "Provide supported hero text fields.");
        foreach (var textKey in new[] { "visualTitle", "floatingTitle", "floatingDescription", "footnote" }) if (hero[textKey] is not null && (hero[textKey] is not JsonValue textNode || !textNode.TryGetValue<string>(out var text) || text.Length > 4000)) throw new BusinessException("invalid_hero", "Hero text must be a supported string.");
        if (value["nav"] is not JsonArray nav || nav.Count > 50) throw new BusinessException("invalid_menu", "Provide at most 50 menu items.");
        ValidateMenu(nav, 0);
        if (value["homeBlocks"] is JsonArray blocks) {
            if (blocks.Count > 20 || blocks.Any(b => b is not JsonObject) || blocks.Select(b => b!["id"]?.ToString()).Distinct().Count() != blocks.Count) throw new BusinessException("invalid_home_blocks", "Home blocks must be unique, with at most 20 entries.");
            foreach (var node in blocks) {
                var block = node!.AsObject();
                if (block["id"] is not JsonValue id || !id.TryGetValue<string>(out var blockId) || blockId.Length is < 1 or > 64 || block["kind"]?.ToString() is not ("categories" or "collection" or "promotions" or "products" or "spotlight" or "brands" or "cheque") || block["enabled"] is not JsonValue flag || !flag.TryGetValue<bool>(out _)) throw new BusinessException("invalid_home_blocks", "Provide a valid id, block kind and enabled flag.");
                foreach (var keyName in new[] { "eyebrow", "title", "description", "action", "categoryId" }) if (block[keyName] is not null && (block[keyName] is not JsonValue textNode || !textNode.TryGetValue<string>(out var text) || text.Length > 4000)) throw new BusinessException("invalid_home_blocks", "Block text must be a supported string.");
                if (block["href"] is not null) ValidatePath(block["href"]);
                if (block["limit"] is not null && (block["limit"] is not JsonValue count || !count.TryGetValue<int>(out var limit) || limit is < 1 or > 24)) throw new BusinessException("invalid_home_blocks", "Block limit must be between 1 and 24.");
                if (block["productIds"] is JsonArray selected) { if (selected.Count > 24 || selected.Any(n => n is not JsonValue v || !v.TryGetValue<string>(out var s) || s.Length is < 1 or > 64) || selected.Select(n => n!.ToString()).Distinct().Count() != selected.Count) throw new BusinessException("invalid_home_blocks", "Curated product ids must be unique, with at most 24 entries."); }
                else if (block["productIds"] is not null) throw new BusinessException("invalid_home_blocks", "Curated product ids must be an array.");
                if (block["kind"]!.ToString() == "spotlight" && flag.GetValue<bool>() && (block["productIds"] is not JsonArray { Count: > 0 } || string.IsNullOrWhiteSpace(block["title"]?.GetValue<string>()))) throw new BusinessException("invalid_home_blocks", "An enabled spotlight needs a title and an explicit product selection.");
                DateTimeOffset? Date(string keyName) { if (block[keyName] is null) return null; var dateString = block[keyName]!.ToString(); if (!dateString.EndsWith('Z') || !DateTimeOffset.TryParse(dateString, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var date)) throw new BusinessException("invalid_home_blocks", "Block dates must be UTC ISO timestamps."); return date; }
                var start = Date("startsAt"); var end = Date("endsAt"); if (start >= end) throw new BusinessException("invalid_home_blocks", "Block end must follow its start.");
                if (block["items"] is JsonArray items) { if (items.Count > 6) throw new BusinessException("invalid_home_blocks", "At most six promotions are supported."); foreach (var promotion in items) { if (promotion is not JsonObject promo || new[] { "eyebrow", "title", "action", "image" }.Any(k => promo[k] is not JsonValue v || !v.TryGetValue<string>(out var s) || s.Length > 4000)) throw new BusinessException("invalid_home_blocks", "Promotion fields must contain valid text."); ValidatePath(promo["href"]); ValidateImage(promo["image"]); } }
                else if (block["items"] is not null) throw new BusinessException("invalid_home_blocks", "Promotions must be an array.");
            }
        }
        else if (value["homeBlocks"] is not null) throw new BusinessException("invalid_home_blocks", "Home blocks must be an array.");
        foreach (var link in new[] { "actionHref", "secondaryHref" }) if (hero[link] is not null) ValidatePath(hero[link]);
        if (hero["image"] is not null) ValidateImage(hero["image"]);
        if (value["logoUrl"] is not null) ValidateImage(value["logoUrl"]);
        if (value["font"] is not null && value["font"]!.ToString() is not ("vazirmatn" or "noto-arabic" or "system")) throw new BusinessException("invalid_branding", "Select a supported local font.");
        SiteAppearanceRules.Validate(value);
        SiteDesignRules.Validate(locale, value);
        StoreIdentityRules.Validate(value);
        SitePurchaseRules.Validate(value);
        SitePaletteRules.Validate(value["palette"]);
        SitePaletteRules.ValidateLibrary(value["paletteLibrary"], value["palette"]);
        if (value["contact"] is JsonObject contact) {
            foreach (var pair in contact) if (pair.Key is not ("phone" or "email" or "address" or "hours") || pair.Value is not JsonValue textNode || !textNode.TryGetValue<string>(out var text) || text.Length > (pair.Key == "address" ? 1000 : pair.Key == "email" ? 254 : pair.Key == "phone" ? 32 : 200)) throw new BusinessException("invalid_contact", "Contact fields must contain bounded text.");
            if (contact["phone"] is not null && !System.Text.RegularExpressions.Regex.IsMatch(contact["phone"]!.ToString(), "^[0-9+() -]{5,32}$")) throw new BusinessException("invalid_contact", "Use an ASCII phone number.");
            if (contact["email"] is not null && (!System.Net.Mail.MailAddress.TryCreate(contact["email"]!.ToString(), out var email) || email.Address != contact["email"]!.ToString())) throw new BusinessException("invalid_contact", "Email address is invalid.");
        }
        else if (value["contact"] is not null) throw new BusinessException("invalid_contact", "Contact must be an object.");
    }
    private static void ValidatePath(JsonNode? node) { if (node is not JsonValue v || !v.TryGetValue<string>(out var path) || path.Length > 1500 || !path.StartsWith('/') || path.StartsWith("//", StringComparison.Ordinal) || path.Contains('\\') || path.Any(char.IsControl)) throw new BusinessException("invalid_content_link", "Content links must use an internal path."); }
    private static void ValidateImage(JsonNode? node) { if (node is not JsonValue v || !v.TryGetValue<string>(out var image) || !PublicImageUrlRules.IsValid(image)) throw new BusinessException("invalid_image_url", "Use an issued public image path, a bundled product image or an HTTPS image URL without credentials or a fragment."); }
    private static void ValidateMenu(JsonArray items, int depth)
    {
        if (depth > 3) throw new BusinessException("invalid_menu", "Menu depth is limited to four levels.");
        foreach (var item in items) {
            if (item is not JsonObject obj || obj["label"] is not JsonValue labelNode || !labelNode.TryGetValue<string>(out var label) || obj["href"] is not JsonValue hrefNode || !hrefNode.TryGetValue<string>(out var href) || string.IsNullOrWhiteSpace(label) || label.Length > 150 || href.Length > 1500 || !(href.StartsWith('/') && !href.StartsWith("//", StringComparison.Ordinal) && !href.Contains('\\') && !href.Any(char.IsControl))) throw new BusinessException("invalid_menu", "Menu items need a label and an internal path.");
            if (item?["children"] is JsonArray children) { if (children.Count > 50) throw new BusinessException("invalid_menu", "Too many menu children."); ValidateMenu(children, depth + 1); }
            else if (item?["children"] is not null) throw new BusinessException("invalid_menu", "Menu children must be an array.");
        }
    }
    public async Task SaveAsync(string key, string locale, ContentInput input, string actorId, CancellationToken ct)
    {
        Validate(key, locale, input.Content);
        if (ProductHelpRules.IsKey(key)) ProductHelpRules.RequireEnvironment(input.Content, development);
        if (key == "site") StoreIdentityRules.RequireEnvironment(input.Content, development);
        if (key == "site") await images.RequireReadyAsync(CmsImageReferences.Site(input.Content), ct);
        await SaveDocumentAsync(key, locale, input.Content.ToJsonString(), input.Version, actorId, ct);
    }

    private async Task SaveDocumentAsync(string key, string locale, string draft, string? version, string actorId, CancellationToken ct)
    {
        var entity = await db.Documents.SingleOrDefaultAsync(x => x.Key == key && x.Locale == locale, ct);
        if (entity is null) { if (version is not null) throw new BusinessException("version_conflict", "Content changed. Reload first."); entity = new() { Key = key, Locale = locale }; db.Documents.Add(entity); }
        else if (version != Convert.ToBase64String(entity.Version)) throw new BusinessException("version_conflict", "Content changed. Reload first.");
        entity.DraftJson = draft; entity.UpdatedAt = DateTimeOffset.UtcNow; entity.UpdatedBy = actorId; await db.SaveChangesAsync(ct);
    }
    public async Task PublishAsync(string key, string locale, string version, string actorId, long? restoreRevisionId, CancellationToken ct, string? section = null)
    {
        if (key == WarrantyTemplateRules.Key)
            throw new BusinessException("invalid_content", "Warranty templates are managed through the catalog.");
        if (section is not null && (section != "socialLinks" || key != "site" || locale != "fa" || restoreRevisionId is not null))
            throw new BusinessException("invalid_publish_section", "Only saved site social links can be published separately.");
        var entity = await db.Documents.SingleOrDefaultAsync(x => x.Key == key && x.Locale == locale, ct) ?? throw new BusinessException("not_found", "Content was not found.");
        if (version != Convert.ToBase64String(entity.Version)) throw new BusinessException("version_conflict", "Content changed. Reload first.");
        var json = section is not null ? MergeSocialLinks(entity) : restoreRevisionId is null ? entity.DraftJson : (await db.Revisions.SingleOrDefaultAsync(x => x.Id == restoreRevisionId && x.Key == key && x.Locale == locale, ct) ?? throw new BusinessException("not_found", "Revision was not found.")).Json;
        var content = JsonNode.Parse(json)!.AsObject();
        Validate(key, locale, content);
        if (ProductHelpRules.IsKey(key)) ProductHelpRules.RequireEnvironment(content, development);
        if (key == "site") StoreIdentityRules.RequireEnvironment(content, development);
        if (key == "auth") await loginContinuity.RequireAsync(content["emailPassword"]!.GetValue<bool>(),content["usernamePassword"]!.GetValue<bool>(),content["mobileOtp"]!.GetValue<bool>(),ct);
        if (key == "site") await images.RequireReadyAsync(CmsImageReferences.Site(content), ct);
        entity.PublishedJson = json;
        if (section is null) entity.DraftJson = json;
        entity.Revision++; entity.UpdatedBy = actorId; entity.UpdatedAt = DateTimeOffset.UtcNow;
        db.Revisions.Add(new() { Key = key, Locale = locale, Revision = entity.Revision, Json = json, PublishedBy = actorId });
        await db.SaveChangesAsync(ct);
    }

    private string MergeSocialLinks(ContentDocument entity)
    {
        if (entity.PublishedJson is null)
            throw new BusinessException("site_not_published", "Publish the site document before publishing its social links separately.");
        var published = JsonNode.Parse(entity.PublishedJson)!.AsObject();
        var draft = JsonNode.Parse(entity.DraftJson)!.AsObject();
        StoreIdentityRules.RequireEnvironment(draft, development);
        var saved = draft["storeIdentity"]?["socialLinks"] as JsonArray ?? [];
        var current = published["storeIdentity"]?["socialLinks"] as JsonArray ?? [];
        if (JsonNode.DeepEquals(current, saved))
            throw new BusinessException("no_social_link_changes", "The saved social links match the published social links.");
        if (published["storeIdentity"] is not JsonObject identity)
        {
            identity = new JsonObject();
            published["storeIdentity"] = identity;
        }
        identity["socialLinks"] = saved.DeepClone();
        return published.ToJsonString();
    }
    public async Task SeedAsync(string key, string locale, JsonObject value, CancellationToken ct)
    {
        if (await db.Documents.AnyAsync(x => x.Key == key && x.Locale == locale, ct)) return;
        Validate(key, locale, value);
        if (ProductHelpRules.IsKey(key)) ProductHelpRules.RequireEnvironment(value, development);
        if (key == "site") StoreIdentityRules.RequireEnvironment(value, development);
        if (key == "auth") await loginContinuity.RequireAsync(value["emailPassword"]!.GetValue<bool>(),value["usernamePassword"]!.GetValue<bool>(),value["mobileOtp"]!.GetValue<bool>(),ct);
        if (key == "site") await images.RequireReadyAsync(CmsImageReferences.Site(value), ct);
        db.Documents.Add(new() { Key = key, Locale = locale, DraftJson = value.ToJsonString(), PublishedJson = value.ToJsonString(), Revision = 1, UpdatedBy = "seed" }); db.Revisions.Add(new() { Key = key, Locale = locale, Revision = 1, Json = value.ToJsonString(), PublishedBy = "seed" }); await db.SaveChangesAsync(ct);
    }
}
