using System.Security.Claims;
using Shop.Modules.Identity;
using Shop.SharedKernel;

public static class StaffPasswordEndpoints
{
    public static void MapStaffPassword(this RouteGroupBuilder auth, string[] adminOrigins, bool development)
    {
        auth.MapPost("/staff/change-password", async (ChangeStaffPasswordInput input, ClaimsPrincipal user,
            IStaffPassword service, HttpContext http, CancellationToken ct) => {
            if (http.Request.Headers["X-Sayman-Client"] != "admin"
                || !adminOrigins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal)
                || http.Request.Query.Count != 0)
                throw new BusinessException("invalid_origin", "This browser origin is not allowed.");
            StaffPasswordRules.Validate(input);
            await service.ChangeAsync(user.FindFirstValue("sub") ?? "", user.FindFirstValue("sst") ?? "",
                user.FindFirstValue("sid") ?? "", input, http.TraceIdentifier, ct);
            AuthHttpSecurity.Clear(http, development);
            return Results.NoContent();
        }).RequireAuthorization("staff_mfa");
    }
}
