using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Reviews;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;

public sealed class ReviewSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SaveReviewInput Input(string? version=null)=>new(version,"fa",4,"نام عمومی آزمون","تجربهٔ کاربر","<script>همین متن ساده است</script>",true);
    private async Task<(HttpClient Client,string Owner)> Customer()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="review"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,DisplayName="Private account name"};Assert.True((await users.CreateAsync(user,fixture.Password)).Succeeded);
        var session=await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,fixture.Password),true,true,false,CancellationToken.None);var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return(client,user.Id);
    }
    private async Task<HttpClient> Administrator()
    {
        var account=await fixture.CreateAdministratorAsync();var c=fixture.Factory.CreateClient(new(){HandleCookies=false});c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");c.DefaultRequestHeaders.Add("X-Sayman-Client","admin");c.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var p=await Body(await c.PostAsJsonAsync("/api/auth/password",new{Identifier=account.Username,account.Password}));c.DefaultRequestHeaders.Authorization=new("Bearer",p["accessToken"]!.GetValue<string>());var setup=await Body(await c.PostAsJsonAsync("/api/auth/mfa/setup",new{}));c.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Body(await c.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));c.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return c;
    }
    private static async Task<JsonNode> Body(HttpResponseMessage response,string? capture=null){using(response){var raw=await response.Content.ReadAsStringAsync();if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_REVIEWS_WIRE_DIR") is {Length:>0} dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(Path.Combine(dir,capture+".json"),raw);}Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());return JsonNode.Parse(raw)!;}}
    private async Task<string> Product(){await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var p=await db.Products.AsNoTracking().SingleAsync(p=>p.Id=="p1");var copy=new Shop.Modules.Catalog.Domain.Product{Slug="review-"+Id(),CategoryId=p.CategoryId,BrandId=p.BrandId,Status="Published"};db.Products.Add(copy);await db.SaveChangesAsync();return copy.Id;}
    private static async Task<JsonNode> Moderate(HttpClient admin,JsonNode review,string action,string? commandId=null,string? reply=null)=>await Body(await admin.PutAsJsonAsync($"/api/admin/reviews/{review["id"]}/commands/{commandId??Id()}",new ModerateReviewInput(review["version"]!.GetValue<string>(),review["content"]!["revisionId"]!.GetValue<string>(),action,"دلیل نمونهٔ بررسی",reply)));
    [Fact]
    public async Task PendingApprovalReplyReportEditAndHideRespectRevisionAndDoNotExposeOwner()
    {
        var person=await Customer();using var c=person.Client;using var admin=await Administrator();using var anonymous=fixture.Factory.CreateClient();var product=await Product();var command=Id();var input=Input();
        var empty=await Body(await c.GetAsync($"/api/reviews/products/{product}/mine"),"own-empty");Assert.True(empty.AsObject().ContainsKey("review"));Assert.Null(empty["review"]);
        var saved=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input),"save-pending");var row=saved["review"]!;Assert.Equal("Pending",row["state"]!.GetValue<string>());
        var replay=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input),"save-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(row.ToJsonString(),replay["review"]!.ToJsonString());
        using(var mismatch=await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input with{Rating=1}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        var pending=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-empty");Assert.Empty(pending["items"]!.AsArray());Assert.All(pending["ratingCounts"]!.AsArray(),v=>Assert.Equal(0,v!.GetValue<int>()));Assert.True(pending.AsObject().ContainsKey("nextCursor"));
        row=(await Moderate(admin,row,"Approve"))["review"]!;Assert.Equal("Approved",row["state"]!.GetValue<string>());row=(await Moderate(admin,row,"Reply",reply:"پاسخ عمومی فروشگاه"))["review"]!;
        var published=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-approved");var shown=Assert.Single(published["items"]!.AsArray())!;Assert.False(shown["verifiedBuyer"]!.GetValue<bool>());Assert.Equal(input.Body,shown["content"]!["body"]!.GetValue<string>());Assert.DoesNotContain(person.Owner,published.ToJsonString(),StringComparison.Ordinal);Assert.DoesNotContain("Private account name",published.ToJsonString(),StringComparison.Ordinal);Assert.Equal("پاسخ عمومی فروشگاه",shown["reply"]!.GetValue<string>());
        var reportCommand=Id();var report=new ReportReviewInput(shown["content"]!["revisionId"]!.GetValue<string>(),"personal_data");await Body(await c.PostAsJsonAsync($"/api/reviews/{row["id"]}/reports/{reportCommand}",report));var reportReplay=await Body(await c.PostAsJsonAsync($"/api/reviews/{row["id"]}/reports/{reportCommand}",report),"report-replay");Assert.True(reportReplay["replayed"]!.GetValue<bool>());Assert.Null(reportReplay["review"]);
        row=(await Body(await c.GetAsync($"/api/reviews/products/{product}/mine"),"own-reported"))["review"]!;Assert.Equal(1,row["reportCount"]!.GetValue<int>());var old=row.DeepClone();row=(await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input(row["version"]!.GetValue<string>()) with{Locale="en",Body="Edited original English review."})))["review"]!;
        var afterEdit=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-after-edit");Assert.Empty(afterEdit["items"]!.AsArray());Assert.Null(row["reply"]);using(var stale=await admin.PutAsJsonAsync($"/api/admin/reviews/{row["id"]}/commands/{Id()}",new ModerateReviewInput(old["version"]!.GetValue<string>(),old["content"]!["revisionId"]!.GetValue<string>(),"Approve","",null)))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        row=(await Moderate(admin,row,"Approve"))["review"]!;row=(await Moderate(admin,row,"Hide"))["review"]!;Assert.Equal("Hidden",row["state"]!.GetValue<string>());Assert.Empty((await Body(await anonymous.GetAsync($"/api/reviews/products/{product}")))["items"]!.AsArray());
        await using var final=fixture.Factory.Services.CreateAsyncScope();var db=final.ServiceProvider.GetRequiredService<ReviewsDbContext>();Assert.Equal(2,await db.Revisions.CountAsync(r=>r.ReviewId==row["id"]!.GetValue<string>()));Assert.Equal(1,await db.Reports.CountAsync(r=>r.ReviewId==row["id"]!.GetValue<string>()));Assert.True(await final.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Audit.AnyAsync(a=>a.Resource.StartsWith("/api/admin/reviews/")));
    }
    [Fact]
    public async Task AnonymousForgeryOwnershipAndUnpublishedProductAreRejected()
    {
        var person=await Customer();using var c=person.Client;using var anonymous=fixture.Factory.CreateClient(new(){HandleCookies=false});anonymous.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");var product=await Product();
        using(var denied=await anonymous.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input()))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        using(var forged=await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",new{Version=(string?)null,Locale="fa",Rating=5,DisplayName="name",Title="title",Body="body body body",PublishConsent=true,VerifiedBuyer=true}))Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
        using(var adminDenied=await c.GetAsync("/api/admin/reviews"))Assert.Equal(HttpStatusCode.Forbidden,adminDenied.StatusCode);
        await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input()));var other=await Customer();using var otherClient=other.Client;Assert.Null((await Body(await otherClient.GetAsync($"/api/reviews/products/{product}/mine")))["review"]);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var p=await db.Products.SingleAsync(p=>p.Id==product);p.Status="Hidden";await db.SaveChangesAsync();}
        using(var hidden=await anonymous.GetAsync($"/api/reviews/products/{product}"))Assert.Equal(HttpStatusCode.NotFound,hidden.StatusCode);
        using(var edit=await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input()))Assert.Equal(HttpStatusCode.NotFound,edit.StatusCode);
    }
    [Fact]
    public async Task ConcurrentSameCommandProducesOneReviewRevisionAndReceipt()
    {
        var person=await Customer();using var c=person.Client;var product=await Product();var command=Id();var path=$"/api/reviews/products/{product}/commands/{command}";var results=await Task.WhenAll(c.PutAsJsonAsync(path,Input()),c.PutAsJsonAsync(path,Input()));var bodies=new List<JsonNode>();foreach(var r in results)bodies.Add(await Body(r));Assert.Single(bodies,b=>!b["replayed"]!.GetValue<bool>());Assert.Single(bodies,b=>b["replayed"]!.GetValue<bool>());
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<ReviewsDbContext>();var row=await db.Reviews.SingleAsync(r=>r.ProductId==product);Assert.Equal(1,await db.Revisions.CountAsync(r=>r.ReviewId==row.Id));Assert.Equal(1,await db.Commands.CountAsync(r=>r.ActorId==person.Owner&&r.CommandId==command));
    }
    [Fact]
    public async Task PaidFactsAreReadFromSalesForBothSnapshotVersionsOnlyAndNeverFromReviewInput()
    {
        // Own isolated SQL fixtures represent historical facts, not real payment execution.
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var db=sp.GetRequiredService<SalesDbContext>();var now=DateTimeOffset.UtcNow;var keys=new List<ReviewPurchaseKey>();
        foreach(var scenario in new[]{(OrderState.Paid,false,(int?)null),(OrderState.Fulfilled,false,(int?)2),(OrderState.AwaitingPayment,false,(int?)null),(OrderState.Paid,true,(int?)2),(OrderState.Cancelled,false,(int?)null)}){
            var owner=Id();var product=Id();keys.Add(new(owner,product));var quote=new CheckoutQuote{Id=Id(),ActorKey=owner,RequestId=Id(),CartVersion="AAAAAAAAAAE=",PricingFingerprint=new string('a',64),CreatedAt=now,ExpiresAt=now.AddMinutes(10),ResponseJson="{}"};db.Quotes.Add(quote);
            var order=new SalesOrder{OwnerId=owner,RequestId=Id(),QuoteId=quote.Id,CreatedAt=now,ExpiresAt=now.AddMinutes(10),ChangedAt=now,QuoteSnapshotJson="{}",State=scenario.Item1,ContainsDemo=scenario.Item2,SnapshotVersion=scenario.Item3,ItemsSubtotalRial=1,GoodsTotalRial=1,PayableTotalRial=1};
            if(scenario.Item3 is null)order.Lines.Add(new(){VariantId=Id(),ProductId=product,Quantity=1,UnitPriceRial=1,LineTotalRial=1});else order.LinesV2.Add(new(){LineId=Id(),LineKind="ordinary",VariantId=Id(),ProductId=product,Quantity=1,UnitPriceRial=1,LineTotalRial=1,PriceVersion="AAAAAAAAAAE="});db.Orders.Add(order);
        }
        await db.SaveChangesAsync();var facts=await sp.GetRequiredService<IReviewPurchaseReader>().VerifiedAsync(keys.ToArray(),CancellationToken.None);Assert.Equal(2,facts.Count);Assert.Contains(keys[0],facts);Assert.Contains(keys[1],facts);Assert.DoesNotContain(keys[2],facts);Assert.DoesNotContain(keys[3],facts);Assert.DoesNotContain(keys[4],facts);
    }
    [Fact]
    public async Task AuditFailureRollsBackApprovalReceiptAndEventBeforeSameCommandRetry()
    {
        var person=await Customer();using var c=person.Client;using var admin=await Administrator();var product=await Product();var saved=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input()));var row=saved["review"]!;var reviewId=row["id"]!.GetValue<string>();var command=Id();var path=$"/api/admin/reviews/{reviewId}/commands/{command}";var input=new ModerateReviewInput(row["version"]!.GetValue<string>(),row["content"]!["revisionId"]!.GetValue<string>(),"Approve","",null);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var identity=scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>();Assert.StartsWith("SaymanTest_",identity.Database.GetDbConnection().Database);Assert.Matches("^/api/admin/reviews/[a-f0-9]{32}/commands/[a-f0-9]{32}$",path);
            var guardedSql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_ReviewAuditFailure] CHECK ([Resource]<>N'"+path+"')";await identity.Database.ExecuteSqlRawAsync(guardedSql);
        }
        try{using var failure=await admin.PutAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failure.StatusCode);}
        finally{await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_ReviewAuditFailure]");}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<ReviewsDbContext>();Assert.Equal("Pending",(await db.Reviews.AsNoTracking().SingleAsync(r=>r.Id==reviewId)).State);Assert.False(await db.Commands.AnyAsync(r=>r.CommandId==command));Assert.Single(await db.Events.Where(r=>r.ReviewId==reviewId).ToArrayAsync());
        }
        var success=await Body(await admin.PutAsJsonAsync(path,input));Assert.False(success["replayed"]!.GetValue<bool>());Assert.Equal("Approved",success["review"]!["state"]!.GetValue<string>());
    }
}
