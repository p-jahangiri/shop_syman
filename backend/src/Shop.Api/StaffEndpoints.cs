using System.Security.Claims;
using Shop.Modules.Identity;
using Shop.SharedKernel;

public static class StaffEndpoints
{
    public static ValueTask<object?> ValidateInputs(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        foreach (var arg in context.Arguments) {
            switch (arg) {
                case StaffCandidateInput candidate: StaffInput.Validate(candidate); break;
                case StaffGrantInput grant: StaffInput.Validate(grant); break;
                case StaffUpdateInput update: StaffInput.Validate(update); StaffFilter.Id(context.HttpContext.Request.RouteValues["id"]?.ToString() ?? ""); break;
                case CreateStaffAccountInput create: StaffProvisioningRules.Validate(create); break;
            }
        }
        return next(context);
    }
    public static void MapStaff(this RouteGroupBuilder admin)
    {
        admin.MapGet("/staff-role-catalog", () => Results.Ok(StaffInput.Catalog())).RequireAuthorization("staff.read");
        admin.MapPost("/staff/accounts", async (CreateStaffAccountInput input, ClaimsPrincipal user, IStaffProvisioning service, HttpContext http, CancellationToken ct) =>
            Results.Ok(await service.CreateAsync(Actor(user), Stamp(user), input, http.TraceIdentifier, ct))).RequireAuthorization("staff.write");
        admin.MapGet("/staff/creation-commands/{requestId}", async (string requestId, ClaimsPrincipal user, IStaffProvisioning service, CancellationToken ct) =>
            Results.Ok(await service.ReceiptAsync(Actor(user), Stamp(user), requestId, ct))).RequireAuthorization("staff.write");
        admin.MapGet("/staff", async (string? query, string? active, string? role, string? cursor, IStaffAdministration service, CancellationToken ct) => {
            var filter = StaffFilter.Create(query, active, role); StaffPaging.Decode(cursor, filter);
            return Results.Ok(await service.PageAsync(filter, cursor, ct));
        }).RequireAuthorization("staff.read");
        admin.MapGet("/staff/{id}", async (string id, IStaffAdministration service, CancellationToken ct) => { StaffFilter.Id(id); return Results.Ok(await service.DetailAsync(id, ct)); }).RequireAuthorization("staff.read");
        admin.MapGet("/staff/{id}/history", async (string id, string? cursor, IStaffAdministration service, CancellationToken ct) => { StaffHistoryPaging.Decode(cursor, id); return Results.Ok(await service.HistoryAsync(id, cursor, ct)); }).RequireAuthorization("staff.read");
        admin.MapPost("/staff-candidate", async (StaffCandidateInput input, ClaimsPrincipal user, IStaffAdministration service, CancellationToken ct) => Results.Ok(await service.CandidateAsync(Actor(user), Stamp(user), input, ct))).RequireAuthorization("staff.write");
        admin.MapPost("/staff", async (StaffGrantInput input, ClaimsPrincipal user, IStaffAdministration service, HttpContext http, CancellationToken ct) => Results.Ok(await service.GrantAsync(Actor(user), Stamp(user), input, http.TraceIdentifier, ct))).RequireAuthorization("staff.write");
        admin.MapPut("/staff/{id}", async (string id, StaffUpdateInput input, ClaimsPrincipal user, IStaffAdministration service, HttpContext http, CancellationToken ct) => { StaffFilter.Id(id); return Results.Ok(await service.UpdateAsync(Actor(user), Stamp(user), id, input, http.TraceIdentifier, ct)); }).RequireAuthorization("staff.write");
    }
    private static string Actor(ClaimsPrincipal user) => user.FindFirstValue("sub") ?? throw new BusinessException("invalid_credentials", "User identity is missing.");
    private static string Stamp(ClaimsPrincipal user) => user.FindFirstValue("sst") ?? "";
}
