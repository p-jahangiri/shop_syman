using System.Security.Claims;
using Shop.Modules.Identity;
using Shop.SharedKernel;

public static class MfaRecoveryEndpoints
{
    public static void MapMfaRecovery(this RouteGroupBuilder auth, string[] adminOrigins, bool development)
    {
        auth.MapGet("/mfa/recovery-codes", async (ClaimsPrincipal user, IMfaRecovery service, HttpContext http, CancellationToken ct) => {
            CheckClient(http, adminOrigins);
            return Results.Ok(await service.StatusAsync(UserId(user), ct));
        }).RequireAuthorization("staff_mfa");
        auth.MapPost("/mfa/recovery-codes", async (GenerateRecoveryCodesInput input, ClaimsPrincipal user, IMfaRecovery service, HttpContext http, CancellationToken ct) => {
            CheckClient(http, adminOrigins); RecoveryCodes.Validate(input);
            return Results.Ok(await service.GenerateAsync(UserId(user), user.FindFirstValue("sst") ?? "", input, http.TraceIdentifier, ct));
        }).RequireAuthorization("staff_mfa");
        auth.MapPost("/mfa/recover", async (RecoverMfaInput input, ClaimsPrincipal user, IMfaRecovery service, HttpContext http, CancellationToken ct) => {
            CheckClient(http, adminOrigins); RecoveryCodes.Validate(input);
            var result = await service.RecoverAsync(UserId(user), user.FindFirstValue("sst") ?? "", input, http.TraceIdentifier, ct);
            // Recovery never issues a refresh token or a full administrative session.
            if (result.RefreshToken is not null || !result.RequiresMfa || !result.RequiresEnrollment || result.RequiresRecovery) throw new InvalidOperationException("Recovery must require authenticator enrollment.");
            AuthHttpSecurity.Clear(http, development);
            return Results.Ok(new { result.AccessToken, result.ExpiresIn, result.RequiresMfa, result.RequiresEnrollment, result.RequiresRecovery, result.User });
        }).RequireAuthorization("mfa_pending");
    }
    private static void CheckClient(HttpContext http, string[] origins)
    {
        if (http.Request.Headers["X-Sayman-Client"] != "admin" || !origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal)) throw new BusinessException("invalid_origin", "This browser origin is not allowed.");
    }
    private static string UserId(ClaimsPrincipal user) => user.FindFirstValue("sub") ?? throw new BusinessException("invalid_credentials", "User identity is missing.");
}
