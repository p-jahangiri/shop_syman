using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact] public async Task ProductionCannotReadOrReplayDevelopmentShipmentAndReceiptsAreActorScoped()
    {
        var s=await Create();using var customer=s.Customer;var ready=await Read(s);var input=Input(ready,"pack");var result=await Body<ShipmentCommandResult>(await fixture.Admin.PostAsJsonAsync(Route(s.OrderId),input));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[Orders] SET [ContainsDemo]=1 WHERE [Id]={s.OrderId}");await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[OrderShipmentCommands] SET [ContainsDemo]=1 WHERE [OrderId]={s.OrderId}");return true;});
        foreach(var operation in new[]{"admin","customer","write","receipt"})await Scope(async sp=>{
            var service=ActivatorUtilities.CreateInstance<OrderShipmentService>(sp,false);var coordinator=sp.GetRequiredService<SalesTransactionCoordinator>();var actor=await sp.GetRequiredService<SalesDbContext>().OrderShipmentCommands.Where(x=>x.OrderId==s.OrderId).Select(x=>x.ActorId).SingleAsync();
            var error=await Assert.ThrowsAsync<BusinessException>(async()=>{switch(operation){
                case "admin":await coordinator.RunAsync(()=>service.ReadAdminAsync(s.Owner,s.OrderId,default),inventoryOnly:true);break;
                case "customer":await coordinator.RunAsync(()=>service.ReadCustomerAsync(s.Owner,s.OrderId,default),inventoryOnly:true);break;
                case "write":await coordinator.RunAsync(()=>service.ApplyAsync(actor,s.OrderId,input,default),inventoryOnly:true);break;
                default:await service.ReadReceiptAsync(actor,s.OrderId,input.CommandId,default);break;
            }});Assert.Equal("not_found",error.Code);return true;
        });
        await Scope(async sp=>{Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>sp.GetRequiredService<OrderShipmentService>().ReadReceiptAsync("another-actor",s.OrderId,input.CommandId,default))).Code);return true;});
        using var denied=await customer.GetAsync(Route(s.OrderId)+"/"+input.CommandId);Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
    }
    [Fact] public async Task UnknownFinancialFieldsAndWrongStageCannotMutateTheReviewedPackage()
    {
        var s=await Create();using var customer=s.Customer;var before=await Stock(s.Variant);var input=Input(await Read(s),"pack");var node=System.Text.Json.JsonSerializer.SerializeToNode(input,new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!.AsObject();node["amountRial"]="1";
        using(var bad=await fixture.Admin.PostAsJsonAsync(Route(s.OrderId),node))Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);
        using(var bad=await fixture.Admin.PostAsJsonAsync(Route(s.OrderId),input with {Action="deliver",ShipmentVersion="AAAAAAAAAAE=",OccurredAt=DateTimeOffset.UtcNow}))Assert.Equal(HttpStatusCode.Conflict,bad.StatusCode);
        Assert.Equal(before,await Stock(s.Variant));Assert.Null((await Read(s)).Shipment);
    }
}
public sealed class OrderShipmentMigrationSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    [Fact] public async Task EmptyShipmentSchemaCanRollBackButHistoricalPackingCannotBeDropped()
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrator=db.GetService<IMigrator>();var source=(await db.Database.GetAppliedMigrationsAsync()).ToArray();const string current="20261025223205_OrderShipments";await migrator.MigrateAsync(current);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();await migrator.MigrateAsync(previous);await migrator.MigrateAsync(current);await db.Database.MigrateAsync();Assert.Equal(source,await db.Database.GetAppliedMigrationsAsync());
        await fixture.Settings(max:10);var item=await fixture.Product();var person=await fixture.Customer();using var customer=person.Client;
        var cart=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));
        var quote=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Guid.NewGuid().ToString())));
        var order=(await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Guid.NewGuid().ToString("N"),"Synthetic QA","09121234567",new("IR","QA","QA","Synthetic address","1234567890"),null,true)),HttpStatusCode.Created))["order"]!;
        var id=order["summary"]!["id"]!.GetValue<string>();
        db.OrderShipments.Add(new(){Id=Guid.NewGuid().ToString("N"),OrderId=id,OwnerId="qa",ReservationId=Guid.NewGuid().ToString("N"),InventoryFingerprint=new string('A',64),PackedAt=DateTimeOffset.UtcNow,ChangedAt=DateTimeOffset.UtcNow,ContainsDemo=true});await db.SaveChangesAsync();await migrator.MigrateAsync(current);var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(previous));Assert.Equal(51000,error.Number);Assert.Single(await db.OrderShipments.ToArrayAsync());await db.Database.MigrateAsync();Assert.Equal(source,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
}
