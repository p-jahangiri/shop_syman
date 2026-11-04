using System.Globalization;
using System.Text.Json;
using Shop.Modules.Sales;

public static class RmaEndpoints
{
    public const int MaximumRequestBytes=32*1024;
    public const string Contract="rma-v1";
    public static bool IsScope(PathString path)
    {
        if(path.StartsWithSegments("/api/returns")||path.StartsWithSegments("/api/admin/returns"))return true;
        var pieces=(path.Value??"").Split('/',StringSplitOptions.RemoveEmptyEntries);
        return pieces.Length>=4&&pieces[0].Equals("api",StringComparison.OrdinalIgnoreCase)&&pieces[1].Equals("orders",StringComparison.OrdinalIgnoreCase)&&pieces[3].Equals("returns",StringComparison.OrdinalIgnoreCase);
    }
    public static bool IsPublicPolicy(HttpRequest request)=>HttpMethods.IsGet(request.Method)&&string.Equals(request.Path.Value?.TrimEnd('/'),"/api/returns/policy",StringComparison.OrdinalIgnoreCase);
    public static bool IsPrivateScope(HttpRequest request)=>IsScope(request.Path)&&!IsPublicPolicy(request);
    public static void Headers(HttpContext http)
    {
        if(!IsScope(http.Request.Path))return;
        http.Response.Headers["X-Sayman-Returns-Contract"]=Contract;
        http.Response.Headers.CacheControl=IsPublicPolicy(http.Request)?"public, no-store":"private, no-store";
        http.Response.Headers["X-Robots-Tag"]="noindex, nofollow";
        if(IsPrivateScope(http.Request))http.Response.Headers.Vary="Cookie, Authorization";
    }
    public static async Task LimitBodyAsync(HttpContext http,RequestDelegate next)
    {
        if(!IsScope(http.Request.Path)||HttpMethods.IsGet(http.Request.Method)||HttpMethods.IsHead(http.Request.Method)||HttpMethods.IsOptions(http.Request.Method)){await next(http);return;}
        if(http.Request.ContentLength>MaximumRequestBytes)throw new BadHttpRequestException("Return request body exceeds its bound.",413);
        var original=http.Request.Body;await using var buffered=new MemoryStream();var buffer=new byte[4096];
        while(true){var count=await original.ReadAsync(buffer,http.RequestAborted);if(count==0)break;if(buffered.Length+count>MaximumRequestBytes)throw new BadHttpRequestException("Return request body exceeds its bound.",413);await buffered.WriteAsync(buffer.AsMemory(0,count),http.RequestAborted);}
        try{using var json=JsonDocument.Parse(buffered.ToArray(),new JsonDocumentOptions{MaxDepth=32});UniqueProperties(json.RootElement);}
        catch(JsonException){throw new BadHttpRequestException("Return request JSON is invalid or ambiguous.",400);}
        buffered.Position=0;http.Request.Body=buffered;try{await next(http);}finally{http.Request.Body=original;}
    }
    private static void UniqueProperties(JsonElement value)
    {
        if(value.ValueKind==JsonValueKind.Object){var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var property in value.EnumerateObject()){if(!names.Add(property.Name))throw new JsonException();UniqueProperties(property.Value);}}
        else if(value.ValueKind==JsonValueKind.Array)foreach(var child in value.EnumerateArray())UniqueProperties(child);
    }
    private static bool Query(HttpContext h,params string[] keys)=>CreditApplicationEndpoints.Query(h,keys);
    private static string? Value(HttpContext h,string name)=>h.Request.Query.ContainsKey(name)?h.Request.Query[name].ToString():null;
    private static string Actor(HttpContext h)=>CreditApplicationEndpoints.Actor(h);
    private static void Configure(RouteGroupBuilder group,string[] origins)=>CreditApplicationEndpoints.Configure(group,origins);
    private static int? Before(HttpContext h)
    {
        var value=Value(h,"beforeRevision");if(value is null)return null;
        if(!int.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var n)||n is<1 or>RmaRules.MaxRevisions||n.ToString(CultureInfo.InvariantCulture)!=value)throw RmaRules.Invalid();return n;
    }
    public static void MapReturns(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        app.MapGet("/api/returns/policy",async Task<IResult>(HttpContext h,RmaCoordinator c,CancellationToken ct)=>{
            if(!Query(h))return Results.BadRequest();var current=await c.ReadAsync(s=>s.CurrentPolicyAsync(ct),ct);var p=current.Current;
            return Results.Ok(new RmaPublicPolicyData(1,p is not null,p?.Enabled??false,p?.PhysicalReturns??false,p?.DigitalComplaints??false,p?.ConditionsFa,p?.ConditionsEn,p?.WindowMode,p?.WindowDays));
        }).AllowAnonymous().RequireRateLimiting("support");
        var customer=app.MapGroup("/api/returns").RequireAuthorization("customer").RequireRateLimiting("support");Configure(customer,origins);
        customer.MapGet("",async(HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h,"state","after")?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(Actor(h),Value(h,"state"),Value(h,"after"),ct),ct)));
        customer.MapGet("/{id}",async(string id,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.DetailAsync(Actor(h),id,false,ct),ct)));
        customer.MapPut("/{id}/withdrawals/{cmd}",async(string id,string cmd,WithdrawRmaInput input,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WithdrawAsync(Actor(h),id,cmd,input,h.Request.Path,h.TraceIdentifier,ct)));
        customer.MapGet("/commands/{cmd}",async(string cmd,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReceiptAsync(Actor(h),cmd,false,ct),ct)));
        var order=app.MapGroup("/api/orders/{id}/returns").RequireAuthorization("customer").RequireRateLimiting("support");Configure(order,origins);
        order.MapGet("/context",async(string id,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ContextAsync(Actor(h),id,ct),ct)));
        order.MapPut("/commands/{cmd}",async Task<IResult>(string id,string cmd,CreateRmaInput input,HttpContext h,RmaCoordinator c,CancellationToken ct)=>{
            if(!Query(h))return Results.BadRequest();var result=await c.CreateAsync(Actor(h),id,cmd,input,h.Request.Path,h.TraceIdentifier,ct);h.Response.Headers.Location="/api/returns/"+result.Case.Case.Id;return Results.Json(result,statusCode:result.Replayed?200:201);
        });
        var staff=app.MapGroup("/api/admin/returns").RequireAuthorization("staff_mfa","sales.read").RequireRateLimiting("support");Configure(staff,adminOrigins);
        staff.MapGet("/policy",async(HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.CurrentPolicyAsync(ct),ct)));
        staff.MapGet("/policy/history",async(HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h,"beforeRevision")?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PolicyHistoryAsync(Before(h),ct),ct)));
        staff.MapPut("/policy/commands/{cmd}",async(string cmd,RmaPolicyInput input,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.PolicyAsync(Actor(h),cmd,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("sales.write");
        staff.MapGet("/policy/commands/{cmd}",async(string cmd,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PolicyReceiptAsync(Actor(h),cmd,ct),ct))).RequireAuthorization("sales.write");
        staff.MapGet("",async(HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h,"state","after")?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(null,Value(h,"state"),Value(h,"after"),ct),ct)));
        staff.MapGet("/{owner}/{id}",async(string owner,string id,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.DetailAsync(owner,id,true,ct),ct))).RequireAuthorization("sales.write");
        staff.MapPut("/{id}/commands/{cmd}",async(string id,string cmd,ReviewRmaInput input,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReviewAsync(Actor(h),id,cmd,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("sales.write");
        staff.MapGet("/commands/{cmd}",async(string cmd,HttpContext h,RmaCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReceiptAsync(Actor(h),cmd,true,ct),ct))).RequireAuthorization("sales.write");
    }
}
