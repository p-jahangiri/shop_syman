using System.Net;
using Microsoft.AspNetCore.Identity;
using Shop.Modules.Identity;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderV2HttpSqlTests
{
    private async Task<HttpClient> UsedStaff(string role)
    {
        // These domain tests use real password/TOTP services for their own
        // generated staff. HTTP JWT/MFA/policies still protect the commands;
        // they do not spend the unrelated enrollment HTTP throttle budget.
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var users=sp.GetRequiredService<UserManager<ShopUser>>();var user=new ShopUser{UserName="usedqa"+Id(),Email=Id()+"@example.test",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,fixture.Sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);
        var auth=sp.GetRequiredService<AuthService>();var pending=await auth.PasswordAsync(new(user.UserName!,fixture.Sql.Password),true,true,true,default);Assert.True(pending.RequiresMfa);await auth.SetupMfaAsync(user.Id,user.SecurityStamp!,false,null,default);var current=await users.FindByIdAsync(user.Id)??throw new InvalidOperationException();var secret=await users.GetAuthenticatorKeyAsync(current)??throw new InvalidOperationException();var session=await auth.VerifyMfaAsync(current.Id,current.SecurityStamp!,false,Totp.Code(secret,DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30),Id(),default);
        var client=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return client;
    }

    [Theory][InlineData("CatalogManager")][InlineData("InventoryManager")]
    public async Task UsedInspectionRequiresBothCatalogAndInventoryPermission(string role)
    {
        using var staff=await UsedStaff(role);var facts=new UsedItemConditionData(Id(),"unknown","unknown",null,"unknown","unknown","unknown","","",DateTimeOffset.UtcNow.AddMinutes(-1));
        using var response=await staff.PutAsJsonAsync($"/api/admin/used-items/{Id()}/commands/{Id()}",new SaveUsedItemInput("AAAAAAAAAAE=",facts));Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
    }
    [Fact]public async Task IndependentUsedOrdinarySkuKeepsConditionInMixedQuote5AndOrder2History()
    {
        await using var policy=await Order2Policies();var scenario=await Quote4Cart(2,false);var s=scenario.Scenario;using var customer=s.Customer;
        var used=await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var original=await catalog.Variants.SingleAsync(v=>v.Id==s.Variant);var variant=new ProductVariant{Sku="QA-USED-"+Id(),ProductId=original.ProductId,PriceRial=9007199254740993,LabelFa="دستگاه کارکردهٔ نمونه",LabelEn="Synthetic used unit",WarrantyEn="Synthetic condition warranty"};catalog.Variants.Add(variant);await catalog.SaveChangesAsync();var stock=sp.GetRequiredService<InventoryDbContext>();stock.Stock.Add(new(){VariantId=variant.Id,OnHand=1});await stock.SaveChangesAsync();return variant.Id;});
        using var admin=await UsedStaff("Administrator");var detail=await Body(await admin.GetAsync("/api/admin/used-items/"+used));var condition=new UsedItemConditionData(Id(),"needsRepair","measured",0,"damaged","worn","repaired","نمونه؛ صفحه آسیب دارد","Sample: screen damage",DateTimeOffset.UtcNow.AddMinutes(-1));
        await Body(await admin.PutAsJsonAsync($"/api/admin/used-items/{used}/commands/{Id()}",new SaveUsedItemInput(Text(detail,"variantVersion"),condition)));
        var cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(used,1)],Text(scenario.Cart,"version"))));var quote=await Order2Quote(s,cart);await UsedItemWire.Body(await customer.PostAsJsonAsync(Quote5Route("en"),new CheckoutQuoteInput(Text(cart,"version"),null,null,null)),"mixed-quote5","quote5");var ordinary=Assert.Single(quote["lines"]!.AsArray(),l=>Text(l!,"lineKind")=="ordinary")!;Assert.Equal(condition.InspectionId,Text(ordinary["usedCondition"]!,"inspectionId"));
        var created=await UsedItemWire.Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),"order2-created","order2-create",HttpStatusCode.Created);var order=created["order"]!;var orderId=Text(order["summary"]!,"id");Assert.Equal(condition.InspectionId,Text(Assert.Single(order["lines"]!.AsArray(),l=>Text(l!,"lineKind")=="ordinary")!["usedCondition"]!,"inspectionId"));
        await Body(await customer.PostAsJsonAsync($"/api/orders/v2/{orderId}/cancel",new CancelOrderInput(Text(order["summary"]!,"version"))));detail=await Body(await admin.GetAsync("/api/admin/used-items/"+used));await Body(await admin.PutAsJsonAsync($"/api/admin/used-items/{used}/commands/{Id()}",new SaveUsedItemInput(Text(detail,"variantVersion"),condition with{InspectionId=Id(),BatteryHealthPercent=100,ScreenState="intact"})));
        var read=await UsedItemWire.Body(await customer.GetAsync("/api/orders/v2/"+orderId),"order2-history","order2");var report=Assert.Single(read["lines"]!.AsArray(),l=>Text(l!,"lineKind")=="ordinary")!["usedCondition"]!;Assert.Equal(condition.InspectionId,Text(report,"inspectionId"));Assert.Equal(0,report["batteryHealthPercent"]!.GetValue<int>());Assert.Equal("damaged",Text(report,"screenState"));
    }
}
