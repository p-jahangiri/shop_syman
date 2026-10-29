using Shop.Modules.Credit;
public static class ChequeReportEndpoints
{
    public static void MapChequeReport(this WebApplication app,string[] adminOrigins)
    {
        var group=app.MapGroup("/api/admin/credit/cheque-report").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(group,adminOrigins);
        group.MapGet("",async(string from,string through,string state,string? cursor,HttpContext h,CreditScheduleCoordinator root,ChequeReportService service,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h,"from","through","state","cursor")?Results.BadRequest():Results.Ok(await root.Atomic(()=>service.ReadAsync(CreditApplicationEndpoints.Actor(h),new(from,through,state),cursor,ct),ct)));
    }
}
