using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact]public async Task ParcelHttpBoundaryRejectsOwnershipQueriesForgedFactsAndChangedCommandBodiesWithoutAuditOrStockEffects()
    {
        var s=await Create(quantity:2);using var customer=s.Customer;var path=ParcelBase(s);var before=await Stock(s.Variant);
        using(var anonymous=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false})){using var denied=await anonymous.GetAsync(path);Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);Assert.Contains("no-store",denied.Headers.CacheControl!.ToString());}
        using(var denied=await customer.GetAsync(path))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        foreach(var tail in new[]{"?owner=another","?after=01","?after=9223372036854775808","?after=1&after=2"}){using var invalid=await ParcelStaff.GetAsync(path+tail);Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);}
        var page=await Parcels(s);var input=ParcelInput(page,"pack",null,new PartialDispatchSelection(page.Lines[0].LineKey,1,[]));var forged=JsonSerializer.SerializeToNode(input,new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsObject();forged["paid"]=true;using(var denied=await ParcelStaff.PostAsJsonAsync(path+"/commands/"+input.CommandId,forged))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);
        var result=await ParcelWrite(s,input);using(var changed=await ParcelStaff.PostAsJsonAsync(path+"/commands/"+input.CommandId,input with{Reason="Different review"}))Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);Assert.Equal(before,await Stock(s.Variant));
        using(var wrongOwner=await ParcelStaff.GetAsync(path.Replace(s.Owner,"OTHER_OWNER")+"/commands/"+input.CommandId))Assert.Equal(HttpStatusCode.NotFound,wrongOwner.StatusCode);
        var stranger=await fixture.Customer();using(var person=stranger.Client){using var denied=await person.GetAsync($"/api/orders/{s.OrderId}/fulfillment/parcels/{result.Detail.Parcel.Id}");Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);}
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.ParcelCommands.SingleAsync(x=>x.CommandId==input.CommandId);Assert.NotEmpty(row.ProtectedResult);Assert.Equal(1,await sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Resource==path+"/commands/"+input.CommandId));return true;});
    }
}
