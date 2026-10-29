using Shop.Modules.Payments;
using Shop.Modules.Credit;
using Shop.SharedKernel;
public static class AdminFinanceEndpoints
{
    public static void MapAdminFinance(this RouteGroupBuilder admin)
    {
        admin.MapGet("/purchase-methods-page",async(HttpRequest request,string? query,string? enabled,string? kind,string? categoryId,string? cursor,IAdminPurchaseMethods service,CancellationToken ct)=>{Query(request,true);var filter=PurchaseAdminFilter.Create(query,enabled,categoryId,kind);PurchaseAdminPaging.Decode(cursor,filter,"method");return Results.Ok(await service.PageAsync(filter,cursor,ct));}).RequireAuthorization("finance.read");
        admin.MapGet("/cheque-plans-page",async(HttpRequest request,string? query,string? enabled,string? categoryId,string? cursor,IAdminCreditPlans service,CancellationToken ct)=>{Query(request,false);var filter=PurchaseAdminFilter.Create(query,enabled,categoryId);PurchaseAdminPaging.Decode(cursor,filter,"plan");return Results.Ok(await service.PageAsync(filter,cursor,ct));}).RequireAuthorization("finance.read");
        admin.MapGet("/purchase-methods/{id}",async(string id,IAdminPurchaseMethods service,CancellationToken ct)=>{PurchaseAdminFilter.Id(id);return Results.Ok(await service.DetailAsync(id,ct));}).RequireAuthorization("finance.read");
        admin.MapGet("/cheque-plans/{id}",async(string id,IAdminCreditPlans service,CancellationToken ct)=>{PurchaseAdminFilter.Id(id);return Results.Ok(await service.DetailAsync(id,ct));}).RequireAuthorization("finance.read");
        admin.MapGet("/purchase-summary",async(IAdminPurchaseMethods methods,IAdminCreditPlans plans,CancellationToken ct)=>{var m=methods.CountsAsync(ct);var p=plans.CountsAsync(ct);await Task.WhenAll(m,p);return Results.Ok(new{SchemaVersion=1,Methods=(await m).Total,EnabledMethods=(await m).Enabled,Plans=(await p).Total,EnabledPlans=(await p).Enabled});}).RequireAuthorization("finance.read");
    }
    private static void Query(HttpRequest request,bool method){foreach(var q in request.Query)if(q.Value.Count!=1||q.Key is not ("query" or "enabled" or "categoryId" or "cursor")&&!(method&&q.Key=="kind"))throw new BusinessException("invalid_purchase_filter","Unknown or repeated purchase filters are not supported.");}
}
