using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
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
    public async Task HelpfulVotesRankCurrentRevisionsAndWithdrawalIsOwnerOnlyAndReplaySafe()
    {
        var author = await Customer();
        var other = await Customer();
        var reader = await Customer();
        using var a = author.Client;
        using var b = other.Client;
        using var c = reader.Client;
        using var guest = fixture.Factory.CreateClient();
        var path = "/api/reviews/products/" + await Product();
        var first = (await Body(await a.PutAsJsonAsync(path + "/commands/" + Id(), Input())))["review"]!;
        var second = (await Body(await b.PutAsJsonAsync(path + "/commands/" + Id(), Input())))["review"]!;
        var id = first["id"]!.GetValue<string>();
        var revision = first["content"]!["revisionId"]!.GetValue<string>();
        var vote = $"/api/reviews/{id}/votes/";
        using (var denied = await a.PutAsJsonAsync(vote + Id(), new ReviewVoteInput(revision, 1)))
            Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        var command = Id();
        var pair = await Task.WhenAll(b.PutAsJsonAsync(vote + Id(), new ReviewVoteInput(revision, 1)),
            c.PutAsJsonAsync(vote + command, new ReviewVoteInput(revision, 1)));
        foreach (var response in pair) await Body(response);
        Assert.True((await Body(await c.PutAsJsonAsync(vote + command, new ReviewVoteInput(revision, 1))))["replayed"]!.GetValue<bool>());
        var changed = await Body(await c.PutAsJsonAsync(vote + Id(), new ReviewVoteInput(revision, -1)));
        Assert.Equal(1, changed["likes"]!.GetValue<int>());
        Assert.Equal(1, changed["dislikes"]!.GetValue<int>());
        var cleared = await Body(await c.PutAsJsonAsync(vote + Id(), new ReviewVoteInput(revision, 0)));
        Assert.Equal(0, cleared["dislikes"]!.GetValue<int>());
        Assert.Equal(1, (await Body(await b.GetAsync(path + "/vote-state?revisions=" + revision)))[revision]!.GetValue<int>());
        var newest = (await Body(await guest.GetAsync(path)))["items"]!;
        var helpful = (await Body(await guest.GetAsync(path + "?sort=helpful")))["items"]!;
        Assert.Equal(second["id"]!.GetValue<string>(), newest[0]!["id"]!.GetValue<string>());
        Assert.Equal(id, helpful[0]!["id"]!.GetValue<string>());
        Assert.DoesNotContain(other.Owner, helpful.ToJsonString(), StringComparison.Ordinal);
        var account = await Body(await a.GetAsync("/api/reviews/account/reviews?locale=fa"));
        Assert.Equal(1, Assert.Single(account["items"]!.AsArray())!["likes"]!.GetValue<int>());
        var withdraw = $"/api/reviews/{id}/withdraw/";
        var version = first["version"]!.GetValue<string>();
        using (var foreign = await b.PutAsJsonAsync(withdraw + Id(), new WithdrawReviewInput(version)))
            Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        var removed = withdraw + Id();
        await Body(await a.PutAsJsonAsync(removed, new WithdrawReviewInput(version)));
        Assert.True((await Body(await a.PutAsJsonAsync(removed, new WithdrawReviewInput(version))))["replayed"]!.GetValue<bool>());
        Assert.Empty((await Body(await a.GetAsync("/api/reviews/account/reviews?locale=fa")))["items"]!.AsArray());
        Assert.Single((await Body(await guest.GetAsync(path + "?sort=helpful")))["items"]!.AsArray());
        var savedAgain = (await Body(await a.PutAsJsonAsync(path + "/commands/" + Id(), Input())))["review"]!;
        Assert.NotEqual(revision, savedAgain["content"]!["revisionId"]!.GetValue<string>());
        using var staleVote = await c.PutAsJsonAsync(vote + Id(), new ReviewVoteInput(revision, 1));
        Assert.Equal(HttpStatusCode.Conflict, staleVote.StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        Assert.False(scope.ServiceProvider.GetRequiredService<ReviewsDbContext>().Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task CleanPhotoPublishesWithCurrentRevisionAndHidingRevokesPublicAccess()
    {
        var person=await Customer();using var account=person.Client;
        var other=await Customer();using var otherClient=other.Client;
        using var admin=await Administrator();using var anonymous=fixture.Factory.CreateClient();
        var scanner=new ReviewTestScanner();
        using var scanHost=fixture.Factory.WithWebHostBuilder(builder=>builder.ConfigureTestServices(services=>services.AddSingleton<IImageScanner>(scanner)));
        using var customer=scanHost.CreateClient(new(){HandleCookies=false});
        customer.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");
        customer.DefaultRequestHeaders.Authorization=account.DefaultRequestHeaders.Authorization;
        var product=await Product();
        var basePath=$"/api/reviews/products/{product}";
        var valid=new ReviewPhotoInput("replace","image.png","image/png",Png());
        var command=Id();
        var input=Input() with{Photo=valid};
        using(var unavailable=await account.PutAsJsonAsync($"{basePath}/commands/{command}",input))
            Assert.Equal(HttpStatusCode.ServiceUnavailable,unavailable.StatusCode);
        Assert.Null((await Body(await customer.GetAsync($"{basePath}/mine")))["review"]);
        using(var forged=await customer.PutAsJsonAsync($"{basePath}/commands/{command}",input with{Photo=valid with{Name="image.svg"}}))
            Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
        Assert.Equal(0,scanner.Calls);
        var saved=(await Body(await customer.PutAsJsonAsync($"{basePath}/commands/{command}",input)))["review"]!;
        Assert.True(saved["hasPhoto"]!.GetValue<bool>());
        var replay=await Body(await customer.PutAsJsonAsync($"{basePath}/commands/{command}",input));
        Assert.True(replay["replayed"]!.GetValue<bool>());
        Assert.Equal(1,scanner.Calls);
        var photoPath=PhotoPath(saved);
        Assert.Equal("Approved", saved["state"]!.GetValue<string>());
        await AssertNotFound(otherClient,$"{photoPath}/mine");
        var ownerBytes=await AssertImage(customer,$"{photoPath}/mine");
        var staffPath=$"/api/admin/reviews/{saved["id"]}/photos/{saved["content"]!["revisionId"]}";
        Assert.Equal(ownerBytes,await AssertImage(admin,staffPath));
        using(var forbidden=await account.GetAsync(staffPath))Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);
        Assert.Equal(ownerBytes,await AssertImage(anonymous,photoPath));
        var page=await Body(await anonymous.GetAsync(basePath));
        Assert.True(Assert.Single(page["items"]!.AsArray())!["hasPhoto"]!.GetValue<bool>());
        var kept=(await Body(await customer.PutAsJsonAsync($"{basePath}/commands/{Id()}",Input(saved["version"]!.GetValue<string>()) with{Photo=new("keep")})))["review"]!;
        var newPhotoPath=PhotoPath(kept);
        await AssertNotFound(anonymous,photoPath);
        await AssertNotFound(customer,$"{photoPath}/mine");
        Assert.Equal(ownerBytes,await AssertImage(customer,$"{newPhotoPath}/mine"));
        Assert.Equal(ownerBytes,await AssertImage(anonymous,newPhotoPath));
        var hidden=(await Moderate(admin,kept,"Hide"))["review"]!;
        await AssertNotFound(anonymous,newPhotoPath);
        var removed=(await Body(await customer.PutAsJsonAsync($"{basePath}/commands/{Id()}",Input(hidden["version"]!.GetValue<string>()) with{Photo=new("remove")})))["review"]!;
        Assert.Null(removed["hasPhoto"]);
        await AssertNotFound(customer,$"{PhotoPath(removed)}/mine");
        await using var scope=fixture.Factory.Services.CreateAsyncScope();
        var db=scope.ServiceProvider.GetRequiredService<ReviewsDbContext>();
        var reviewId=saved["id"]!.GetValue<string>();
        var revisions=await db.Revisions.Where(r=>r.ReviewId==reviewId).Select(r=>r.PhotoId).ToArrayAsync();
        Assert.Equal(3,revisions.Length);
        Assert.Single(revisions.Where(r=>r is not null).Distinct());
        string PhotoPath(JsonNode row)=>$"{basePath}/photos/{row["id"]}/{row["content"]!["revisionId"]}";
    }

    [Fact]
    public async Task DevelopmentReviewsNeverCountAsVerifiedAndAreHiddenOutsideDevelopment()
    {
        var product=await Product();
        await using var scope=fixture.Factory.Services.CreateAsyncScope();
        var services=scope.ServiceProvider;
        var db=services.GetRequiredService<ReviewsDbContext>();
        var demoOwner=ReviewService.DemoOwnerPrefix+Id();
        var saved=await services.GetRequiredService<ReviewService>().SaveAsync(demoOwner,product,Id(),Input(),CancellationToken.None);
        Assert.True(saved.Review!.IsDemo);
        var development=await services.GetRequiredService<ReviewService>().PublicAsync(product,null,CancellationToken.None);
        Assert.True(Assert.Single(development.Items).IsDemo);
        Assert.False(development.Items[0].VerifiedBuyer);
        Assert.Equal(1,development.RatingCounts[3]);
        var production=new ReviewService(db,services.GetRequiredService<IReviewProductReader>(),services.GetRequiredService<IReviewPurchaseReader>(),
            services.GetRequiredService<TimeProvider>(),services.GetRequiredService<IReviewPhotoProcessor>(),new(false));
        var page=await production.PublicAsync(product,null,CancellationToken.None);
        Assert.Empty(page.Items);
        Assert.All(page.RatingCounts,count=>Assert.Equal(0,count));
        Assert.Empty((await production.AdminAsync(null,product,null,CancellationToken.None)).Items);
        Assert.Null(await production.OwnAsync(demoOwner,product,CancellationToken.None));
    }

    private static async Task AssertNotFound(HttpClient client,string path)
    {
        using var response=await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound,response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    private static async Task<byte[]> AssertImage(HttpClient client,string path)
    {
        using var response=await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        Assert.Equal("image/webp",response.Content.Headers.ContentType?.MediaType);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Contains("nosniff",response.Headers.GetValues("X-Content-Type-Options"));
        var bytes=await response.Content.ReadAsByteArrayAsync();
        Assert.True(ReviewPhotos.IsWebp(bytes));
        return bytes;
    }

    private static string Png()
    {
        using var bitmap=new SkiaSharp.SKBitmap(20,20);
        bitmap.Erase(SkiaSharp.SKColors.Olive);
        using var output=bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Png,100);
        return Convert.ToBase64String(output.ToArray());
    }

    private sealed class ReviewTestScanner:IImageScanner
    {
        // Explicit opt-in for exercising the real local scanner with the same API/SQL scenario.
        private readonly IImageScanner? actual = Environment.GetEnvironmentVariable("SHOP_REVIEW_SCAN_LOCAL") == "1"
            ? new ClamAvScanner(new("127.0.0.1", 13310)) : null;
        public bool Configured=>true;
        public int Calls {get;private set;}
        public Task ScanAsync(ReadOnlyMemory<byte> input,CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Assert.NotEmpty(input.ToArray());
            Calls++;
            return actual?.ScanAsync(input,ct) ?? Task.CompletedTask;
        }
    }
    [Fact]
    public async Task ImmediatePublicationReplyReportEditAndHideRespectRevisionAndDoNotExposeOwner()
    {
        var person=await Customer();using var c=person.Client;using var admin=await Administrator();using var anonymous=fixture.Factory.CreateClient();var product=await Product();var command=Id();var input=Input();
        var empty=await Body(await c.GetAsync($"/api/reviews/products/{product}/mine"),"own-empty");Assert.True(empty.AsObject().ContainsKey("review"));Assert.Null(empty["review"]);
        var saved=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input),"save-published");var row=saved["review"]!;Assert.Equal("Approved",row["state"]!.GetValue<string>());
        var replay=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input),"save-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(row.ToJsonString(),replay["review"]!.ToJsonString());
        using(var mismatch=await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{command}",input with{Rating=1}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        var initial=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-first");Assert.Single(initial["items"]!.AsArray());Assert.Equal(1,initial["ratingCounts"]![3]!.GetValue<int>());Assert.True(initial.AsObject().ContainsKey("nextCursor"));
        row=(await Moderate(admin,row,"Reply",reply:"پاسخ عمومی فروشگاه"))["review"]!;
        var published=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-approved");var shown=Assert.Single(published["items"]!.AsArray())!;Assert.False(shown["verifiedBuyer"]!.GetValue<bool>());Assert.Equal(input.Body,shown["content"]!["body"]!.GetValue<string>());Assert.DoesNotContain(person.Owner,published.ToJsonString(),StringComparison.Ordinal);Assert.DoesNotContain("Private account name",published.ToJsonString(),StringComparison.Ordinal);Assert.Equal("پاسخ عمومی فروشگاه",shown["reply"]!.GetValue<string>());
        var reportCommand=Id();var report=new ReportReviewInput(shown["content"]!["revisionId"]!.GetValue<string>(),"personal_data");await Body(await c.PostAsJsonAsync($"/api/reviews/{row["id"]}/reports/{reportCommand}",report));var reportReplay=await Body(await c.PostAsJsonAsync($"/api/reviews/{row["id"]}/reports/{reportCommand}",report),"report-replay");Assert.True(reportReplay["replayed"]!.GetValue<bool>());Assert.Null(reportReplay["review"]);
        row=(await Body(await c.GetAsync($"/api/reviews/products/{product}/mine"),"own-reported"))["review"]!;Assert.Equal(1,row["reportCount"]!.GetValue<int>());var old=row.DeepClone();row=(await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input(row["version"]!.GetValue<string>()) with{Locale="en",Body="Edited original English review."})))["review"]!;
        var afterEdit=await Body(await anonymous.GetAsync($"/api/reviews/products/{product}"),"public-after-edit");Assert.Equal("Edited original English review.",Assert.Single(afterEdit["items"]!.AsArray())!["content"]!["body"]!.GetValue<string>());Assert.Null(row["reply"]);using(var stale=await admin.PutAsJsonAsync($"/api/admin/reviews/{row["id"]}/commands/{Id()}",new ModerateReviewInput(old["version"]!.GetValue<string>(),old["content"]!["revisionId"]!.GetValue<string>(),"Approve","",null)))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        row=(await Moderate(admin,row,"Hide"))["review"]!;Assert.Equal("Hidden",row["state"]!.GetValue<string>());Assert.Empty((await Body(await anonymous.GetAsync($"/api/reviews/products/{product}")))["items"]!.AsArray());
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
        var purchases = sp.GetRequiredService<IReviewPurchaseReader>();
        Assert.Empty(await purchases.RecentDeliveredProductsAsync(keys[0].OwnerId, CancellationToken.None));
        Assert.Equal(new[] { keys[1].ProductId }, await purchases.RecentDeliveredProductsAsync(keys[1].OwnerId, CancellationToken.None));
        Assert.Empty(await purchases.RecentDeliveredProductsAsync(keys[3].OwnerId, CancellationToken.None));

    }
    [Fact]
    public async Task ReviewWatchEmitsNewStampWhenAnotherClientPublishes()
    {
        var person = await Customer();
        using var customer = person.Client;
        using var visitor = fixture.Factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var path = $"/api/reviews/products/{await Product()}";
        using var watch = await visitor.GetAsync($"{path}/watch", HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        Assert.Equal("text/event-stream", watch.Content.Headers.ContentType!.MediaType);
        Assert.True(watch.Headers.CacheControl!.NoStore);
        using var lines = new StreamReader(await watch.Content.ReadAsStreamAsync(timeout.Token));
        Assert.Equal("retry: 3000", await lines.ReadLineAsync(timeout.Token));
        var before = await lines.ReadLineAsync(timeout.Token);
        Assert.Equal("", await lines.ReadLineAsync(timeout.Token));
        await Body(await customer.PutAsJsonAsync($"{path}/commands/{Id()}", Input(), timeout.Token));
        var after = await lines.ReadLineAsync(timeout.Token);
        Assert.StartsWith("data: ", after);
        Assert.NotEqual(before, after);
    }

    [Fact]
    public async Task AuditFailureRollsBackHideReceiptAndEventBeforeSameCommandRetry()
    {
        var person=await Customer();using var c=person.Client;using var admin=await Administrator();var product=await Product();var saved=await Body(await c.PutAsJsonAsync($"/api/reviews/products/{product}/commands/{Id()}",Input()));var row=saved["review"]!;var reviewId=row["id"]!.GetValue<string>();var command=Id();var path=$"/api/admin/reviews/{reviewId}/commands/{command}";var input=new ModerateReviewInput(row["version"]!.GetValue<string>(),row["content"]!["revisionId"]!.GetValue<string>(),"Hide","Test moderation reason",null);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var identity=scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>();Assert.StartsWith("SaymanTest_",identity.Database.GetDbConnection().Database);Assert.Matches("^/api/admin/reviews/[a-f0-9]{32}/commands/[a-f0-9]{32}$",path);
            var guardedSql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_ReviewAuditFailure] CHECK ([Resource]<>N'"+path+"')";await identity.Database.ExecuteSqlRawAsync(guardedSql);
        }
        try{using var failure=await admin.PutAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failure.StatusCode);}
        finally{await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_ReviewAuditFailure]");}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<ReviewsDbContext>();Assert.Equal("Approved",(await db.Reviews.AsNoTracking().SingleAsync(r=>r.Id==reviewId)).State);Assert.False(await db.Commands.AnyAsync(r=>r.CommandId==command));Assert.Single(await db.Events.Where(r=>r.ReviewId==reviewId).ToArrayAsync());
        }
        var success=await Body(await admin.PutAsJsonAsync(path,input));Assert.False(success["replayed"]!.GetValue<bool>());Assert.Equal("Hidden",success["review"]!["state"]!.GetValue<string>());
    }
}
