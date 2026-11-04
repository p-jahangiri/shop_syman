using System.Security.Claims;

internal static class CmsEditorialAccess
{
    public static bool CanWrite(ClaimsPrincipal user, string action)
        => user.HasClaim("permission", "cms.write")
           || ((action is "Create" or "Save") && user.HasClaim("permission", "cms.editor"));
}
