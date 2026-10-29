using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;
public sealed class AdminProductSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task ProductPagesLookupAndSingleGraphPreserveUnpublishedInactiveAndTypedValues()
    {
        var key=Guid.NewGuid().ToString("N");var ids=Enumerable.Range(0,101).Select(i=>key+i.ToString("D3")).ToArray();var category="c"+key;var brand="b"+key;var multi="a"+key;var boolean="z"+key;var firstOption="o1"+key;var secondOption="o2"+key;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
            db.AttributeDefinitions.AddRange(new AttributeDefinition{Id=multi,Key="multi"+key,DataType=AttributeDataType.MultiSelect,Translations=[new(){Locale="fa",Name="چندگزینه‌ای"},new(){Locale="en",Name="Multiple"}],Options=[new(){Id=firstOption,Value="one",LabelFa="یک",LabelEn="One"},new(){Id=secondOption,Value="two",LabelFa="دو",LabelEn="Two"}]},new AttributeDefinition{Id=boolean,Key="bool"+key,DataType=AttributeDataType.Bool,Translations=[new(){Locale="fa",Name="منطقی"},new(){Locale="en",Name="Boolean"}]});
            db.Categories.Add(new(){Id=category,Slug="category-"+key,Translations=[new(){Locale="fa",Name="دسته"},new(){Locale="en",Name="Category"}],Attributes=[new(){AttributeId=multi},new(){AttributeId=boolean}]});db.Brands.Add(new(){Id=brand,Slug="brand-"+key,Name="Brand "+key});
            for(var i=0;i<ids.Length;i++)db.Products.Add(new(){Id=ids[i],Slug="product-"+key+"-"+i,CategoryId=category,BrandId=brand,Status=new[]{"Draft","Published","Hidden"}[i%3],Translations=[new(){Locale="fa",Name="کیبورد 12 "+key+" "+i,Description="Full editable description"},new(){Locale="en",Name="Keyboard 12 "+key+" "+i}],Attributes=[new(){AttributeId=multi,Selections=[new(){OptionId=firstOption},new(){OptionId=secondOption}]}],Variants=Enumerable.Range(0,3).Select(v=>new ProductVariant{Id="v"+ids[i]+v,Sku="SKU-"+key+"-"+i+"-"+v,PriceRial=long.MaxValue-v,CompareAtPriceRial=long.MaxValue,IsActive=v!=2,Attributes=[new(){AttributeId=boolean,ValueBool=false}]}).ToList(),Media=[new(){Url="/products/phone-silver.svg"}]});
            await db.SaveChangesAsync();
        }
        var all=new List<string>();var sizes=new List<int>();string? cursor=null;
        do{await using var scope=fixture.Factory.Services.CreateAsyncScope();var page=await scope.ServiceProvider.GetRequiredService<IAdminProducts>().PageAsync(AdminProductQuery.Create(key),cursor,CancellationToken.None);all.AddRange(page.Items.Select(p=>p.Id));sizes.Add(page.Items.Length);cursor=page.NextCursor;Assert.All(page.Items,p=>Assert.Equal(3,p.VariantCount));Assert.DoesNotContain("priceRial",JsonSerializer.Serialize(page),StringComparison.OrdinalIgnoreCase);}while(cursor is not null);
        Assert.Equal(new[]{50,50,1},sizes);Assert.Equal(ids,all);
        await using var final=fixture.Factory.Services.CreateAsyncScope();var service=final.ServiceProvider.GetRequiredService<IAdminProducts>();var lookup=await service.LookupAsync([ids[100],"missing",ids[0]],CancellationToken.None);Assert.Equal(2,lookup.Length);
        var draft=await service.PageAsync(AdminProductQuery.Create("كيبورد ۱۲ "+key,"Draft",category,brand),null,CancellationToken.None);Assert.All(draft.Items,p=>Assert.Equal("Draft",p.Status));Assert.Equal(34,draft.Items.Length);
        var detail=(await service.DetailAsync(ids[0],CancellationToken.None)).Product;Assert.Equal(3,detail.Variants.Length);Assert.Equal("9223372036854775807",detail.Variants[0].PriceRial);Assert.False(detail.Variants[2].IsActive);Assert.False(detail.Variants[0].Attributes[0].ValueBool);Assert.Equal(2,detail.Attributes[0].Selections.Length);Assert.Equal("Full editable description",detail.Translations.Single(t=>t.Locale=="fa").Description);
    }
    private static async Task<JsonNode> Json(HttpResponseMessage result){using(result){Assert.True(result.IsSuccessStatusCode,await result.Content.ReadAsStringAsync());Assert.Contains("no-store",result.Headers.CacheControl!.ToString());return JsonNode.Parse(await result.Content.ReadAsStringAsync())!;}}
    private async Task<HttpClient> Staff(string role)
    {
        var account=await fixture.CreateAdministratorAsync();if(role!="Administrator"){await using var scope=fixture.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var user=(await users.FindByNameAsync(account.Username))!;Assert.True((await users.RemoveFromRoleAsync(user,"Administrator")).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);}
        var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var pending=await Json(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=account.Username,account.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/admin/products")).StatusCode);var setup=await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));client.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));client.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return client;
    }
    [Fact] public async Task MetadataOnlyAndReadOnlyLookupDoNotAuditAndSingleDetailSupportsVersionedEditing()
    {
        using var admin=await Staff("Administrator");var metadata=await Json(await admin.GetAsync("/api/admin/catalog?metadataOnly=true"));Assert.Empty(metadata["products"]!.AsArray());Assert.NotEmpty(metadata["categories"]!.AsArray());Assert.NotEmpty((await Json(await admin.GetAsync("/api/admin/catalog")))["products"]!.AsArray());
        var category=metadata["categories"]![0]!["id"]!.GetValue<string>();var brand=metadata["brands"]![0]!["id"]!.GetValue<string>();var key=Guid.NewGuid().ToString("N");
        ProductInput Input(string? productVersion,string? variantId,string? variantVersion,string name)=>new(category,brand,"edit-"+key,"Draft",false,false,[new("fa",name),new("en","Editable product")],[],[new(variantId,"EDIT-"+key,"9223372036854775807",null,"#777777","خاکستری","Gray","استاندارد","Standard","گارانتی","Warranty",false,[],[],variantVersion)],["/products/phone-silver.svg"],["online"],[],productVersion);
        var created=await Json(await admin.PostAsJsonAsync("/api/admin/products",Input(null,null,null,"کالای اولیه")));var id=created["id"]!.GetValue<string>();long before;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())before=await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync();
        var detail=(await Json(await admin.GetAsync("/api/admin/products/"+id)))["product"]!;await Json(await admin.GetAsync("/api/admin/catalog/product-lookup?ids="+id));await Json(await admin.GetAsync("/api/admin/products?query="+key));
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())Assert.Equal(before,await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());
        var v=detail["variants"]![0]!;Assert.Equal("9223372036854775807",v["priceRial"]!.GetValue<string>());Assert.False(v["isActive"]!.GetValue<bool>());var body=Input(detail["version"]!.GetValue<string>(),v["id"]!.GetValue<string>(),v["version"]!.GetValue<string>(),"کالای ویرایش‌شده");await Json(await admin.PutAsJsonAsync("/api/admin/products/"+id,body));Assert.Equal(HttpStatusCode.Conflict,(await admin.PutAsJsonAsync("/api/admin/products/"+id,body)).StatusCode);
        var updated=(await Json(await admin.GetAsync("/api/admin/products/"+id)))["product"]!;Assert.Equal("کالای ویرایش‌شده",updated["translations"]!.AsArray().Single(t=>t!["locale"]!.GetValue<string>()=="fa")!["name"]!.GetValue<string>());Assert.Equal("9223372036854775807",updated["variants"]![0]!["priceRial"]!.GetValue<string>());Assert.False(updated["variants"]![0]!["isActive"]!.GetValue<bool>());
        using var content=await Staff("ContentManager");Assert.Equal(HttpStatusCode.Forbidden,(await content.PutAsJsonAsync("/api/admin/products/"+id,body)).StatusCode);await Json(await content.GetAsync("/api/admin/catalog/product-lookup?ids="+id));
    }
}
