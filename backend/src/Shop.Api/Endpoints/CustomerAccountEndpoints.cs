using System.Security.Claims;
using System.Data.Common;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Microsoft.EntityFrameworkCore;

public static class CustomerAccountEndpoints
{
    private const int MaxBodyBytes = 4096;
    private static readonly JsonSerializerOptions InputJson = new(JsonSerializerDefaults.Web) {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 4
    };

    public static void MapCustomerAccount(this WebApplication app, string[] origins, bool development)
    {
        var group = app.MapGroup("/api/account").RequireAuthorization("customer").RequireRateLimiting("addresses");
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext;
            Private(http);
            if (http.User.FindFirstValue("token_kind") != "access"
                || http.User.FindAll("role").Any(role => ShopPermissions.Roles.ContainsKey(role.Value))
                || http.Request.Headers["X-Sayman-Client"] == "admin" || http.Request.Headers["X-Sayman-Admin"] == "1")
                return Results.Forbid();
            if (http.Request.Query.Count != 0) return Results.BadRequest(new { title = "invalid_profile" });
            if (!HttpMethods.IsGet(http.Request.Method) || http.Request.Headers.ContainsKey("Origin"))
                AuthHttpSecurity.CheckBrowserOrigin(http, origins);
            try { return await next(context); }
            catch (BusinessException error) when (error.Code == "account_unavailable") {
                return Results.Problem(statusCode: 503, title: "account_unavailable", detail: "The account could not be updated safely.");
            }
            catch (DbUpdateConcurrencyException) {
                return http.Request.Path == "/api/account/profile"
                    ? Results.Problem(statusCode: 409, title: "profile_conflict", detail: "The account changed. Reload it before saving again.")
                    : Results.Problem(statusCode: 503, title: "account_unavailable", detail: "The password change outcome could not be confirmed. Sign in again.");
            }
            catch (Exception error) when (error is DbException or DbUpdateException
                || error is InvalidOperationException { InnerException: DbException or DbUpdateException }) {
                return Results.Problem(statusCode: 503, title: "account_unavailable", detail: "The account operation could not be confirmed.");
            }
        });

        group.MapGet("/profile", async (HttpContext http, AuthService auth, CancellationToken ct) =>
            Results.Ok(await auth.ReadCustomerProfileAsync(Subject(http), Stamp(http), Family(http), ct)));

        group.MapPut("/profile", async (HttpContext http, AuthService auth, CancellationToken ct) => {
            var input = await Input<UpdateCustomerProfileInput>(http, ["displayName", "version"], ct);
            return Results.Ok(await auth.UpdateCustomerProfileAsync(Subject(http), Stamp(http), Family(http), input, http.TraceIdentifier, ct));
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxBodyBytes));

        group.MapPost("/password", async (HttpContext http, AuthService auth, CancellationToken ct) => {
            var input = await Input<ChangeCustomerPasswordInput>(http, ["currentPassword", "newPassword"], ct);
            await auth.ChangeCustomerPasswordAsync(Subject(http), Stamp(http), Family(http), input, http.TraceIdentifier, ct);
            AuthHttpSecurity.Clear(http, development);
            return Results.NoContent();
        }).RequireRateLimiting("auth").WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxBodyBytes));
    }

    private static async Task<T> Input<T>(HttpContext http, string[] fields, CancellationToken ct) where T : class
    {
        if (http.Request.ContentType is not { } contentType
            || !System.Net.Http.Headers.MediaTypeHeaderValue.TryParse(contentType, out var parsed)
            || !string.Equals(parsed.MediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || parsed.CharSet is not null && !string.Equals(parsed.CharSet.Trim('"'), "utf-8", StringComparison.OrdinalIgnoreCase))
            throw new BadHttpRequestException("Use a JSON request.", StatusCodes.Status415UnsupportedMediaType);
        if (http.Request.ContentLength > MaxBodyBytes)
            throw new BadHttpRequestException("The account request is too large.", StatusCodes.Status413PayloadTooLarge);
        var bytes = new byte[MaxBodyBytes + 1];
        var size = 0;
        while (size <= MaxBodyBytes) {
            var read = await http.Request.Body.ReadAsync(bytes.AsMemory(size, bytes.Length - size), ct);
            if (read == 0) break;
            size += read;
        }
        if (size > MaxBodyBytes)
            throw new BadHttpRequestException("The account request is too large.", StatusCodes.Status413PayloadTooLarge);
        try {
            var text = new UTF8Encoding(false, true).GetString(bytes, 0, size);
            using var document = JsonDocument.Parse(text, new() { MaxDepth = 4 });
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw InvalidInput();
            var properties = document.RootElement.EnumerateObject().ToArray();
            if (properties.Length != fields.Length || properties.Any(property => !fields.Contains(property.Name, StringComparer.Ordinal))
                || properties.Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != fields.Length)
                throw InvalidInput();
            return JsonSerializer.Deserialize<T>(text, InputJson) ?? throw InvalidInput();
        } catch (Exception error) when (error is JsonException or DecoderFallbackException) { throw InvalidInput(); }
    }

    private static void Private(HttpContext http)
    {
        http.Response.Headers.CacheControl = "private, no-store";
        http.Response.Headers.Pragma = "no-cache";
        http.Response.Headers.Vary = "Origin, Cookie, Authorization";
        http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        http.Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private static string Subject(HttpContext http) => http.User.FindFirstValue("sub") ?? throw InvalidCredentials();
    private static string Stamp(HttpContext http) => http.User.FindFirstValue("sst") ?? throw InvalidCredentials();
    private static string Family(HttpContext http) => http.User.FindFirstValue("sid") ?? throw InvalidCredentials();
    private static BusinessException InvalidInput() => new("invalid_profile", "The account request is invalid.");
    private static BusinessException InvalidCredentials() => new("invalid_credentials", "A complete customer session is required.");
}
