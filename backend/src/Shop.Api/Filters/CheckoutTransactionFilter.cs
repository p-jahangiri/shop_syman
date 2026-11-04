public sealed class CheckoutTransactionFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var identity = CartEndpoints.Identity(context.HttpContext);
        if (identity.OwnerId is null && identity.GuestToken is null) return await next(context);
        return await context.HttpContext.RequestServices.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async () => await next(context), commit: result => context.HttpContext.Response.StatusCode < 400 && result is not IStatusCodeHttpResult { StatusCode: >= 400 }, ct: context.HttpContext.RequestAborted);
    }
}
