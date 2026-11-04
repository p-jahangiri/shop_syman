using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Sales;

public sealed class DataProtectionAddressProtection(IDataProtectionProvider provider) : IAddressProtection
{
    private IDataProtector Protector(string ownerId, string addressId) => provider.CreateProtector("Sayman.Sales.AddressBook.v1", ownerId, addressId);
    public string Protect(string ownerId, string addressId, string plaintext) => Protector(ownerId, addressId).Protect(plaintext);
    public string Unprotect(string ownerId, string addressId, string ciphertext) => Protector(ownerId, addressId).Unprotect(ciphertext);
}
public static class AddressBookEndpoints
{
    public static void MapAddressBook(this WebApplication app, string[] origins)
    {
        var group = app.MapGroup("/api/addresses").RequireAuthorization("customer").RequireRateLimiting("addresses"); group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext; var supplied = http.Request.Headers.Origin.ToString();
            if (http.Request.QueryString.HasValue) return Results.BadRequest(new { title = "invalid_address" });
            if ((!HttpMethods.IsGet(http.Request.Method) || supplied.Length > 0) && !origins.Contains(supplied, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("", async (ClaimsPrincipal user, IAddressBook service, CancellationToken ct) => Results.Ok(await service.ReadAsync(user.FindFirstValue("sub")!, ct)));
        group.MapPut("/{id}", async (string id, SaveAddressInput input, ClaimsPrincipal user, IAddressBook service, CancellationToken ct) => { id = AddressBookRules.Id(id); input = AddressBookRules.Normalize(input); var result = await service.SaveAsync(user.FindFirstValue("sub")!, id, input, ct); return Results.Json(result, statusCode: input.Version is null && !result.Replayed ? 201 : 200); });
        group.MapDelete("/{id}", async (string id, [Microsoft.AspNetCore.Mvc.FromBody] DeleteAddressInput input, ClaimsPrincipal user, IAddressBook service, CancellationToken ct) => { id = AddressBookRules.Id(id); AddressBookRules.Version(input.Version); await service.DeleteAsync(user.FindFirstValue("sub")!, id, input, ct); return Results.NoContent(); });
    }
}
