using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class AddressBookTests
{
    private const string Id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static SaveAddressInput Input()=>new(" خانه "," گیرندهٔ آزمون ","+۹۸۹۱۲۱۲۳۴۵۶۷",new("IR"," تهران "," تهران ","نشانی آزمون\r\nواقعی نیست","۱۲۳۴۵۶۷۸۹۰"),false,null,new(AddressGeography.Version,"123","1230001","1230001001576","city","۱۲","",null,null));
    [Fact] public void AddressRulesReuseCanonicalDeliveryWithoutVerifyingAnIdentityContact(){var input=AddressBookRules.Normalize(Input());Assert.Equal("09121234567",input.ContactPhone);Assert.Equal("1234567890",input.Delivery.PostalCode);Assert.Equal("خانه",input.Label);Assert.DoesNotContain('\r',input.Delivery.Address);Assert.False(input.MakeDefault);Assert.Null(input.Version);Assert.Equal(20,AddressBookRules.Capacity);}
    [Fact] public void CompatibilityCharactersCannotMakeCanonicalAddressChangeOnASecondNormalization(){var input=Input() with{Label="\u00a8 خانه ",ContactName="\u00a8 گیرنده"};var normalized=AddressBookRules.Normalize(input);Assert.Equal(normalized,AddressBookRules.Normalize(normalized));}
    [Theory][InlineData("label")][InlineData("label_control")][InlineData("phone")][InlineData("delivery")][InlineData("country")][InlineData("postal")][InlineData("default")][InlineData("version")]
    public void InvalidAddressIsRejectedBeforeSql(string kind){var input=Input();input=kind switch{"label"=>input with{Label=new string('x',61)},"label_control"=>input with{Label="a\0b"},"phone"=>input with{ContactPhone="123"},"delivery"=>input with{Delivery=null!},"country"=>input with{Delivery=input.Delivery with{CountryCode="US"}},"postal"=>input with{Delivery=input.Delivery with{PostalCode="1"}},"default"=>input with{MakeDefault=null},_=>input with{Version="bad"}};Assert.Equal("invalid_address",Assert.Throws<BusinessException>(()=>AddressBookRules.Normalize(input)).Code);}
    [Fact] public void AddressIdsAndVersionsAreValidated(){Assert.Equal(Id,AddressBookRules.Id("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"));Assert.Equal(8,AddressBookRules.Version("AAAAAAAAAAE=").Length);foreach(var id in new[]{"../other",Guid.Empty.ToString(),""})Assert.Equal("invalid_address",Assert.Throws<BusinessException>(()=>AddressBookRules.Id(id)).Code);}
    [Fact] public void ProtectionIsBoundToOwnerAndResourceAndCiphertextHidesPrivateFields(){var protection=new DataProtectionAddressProtection(new EphemeralDataProtectionProvider());var plaintext=JsonSerializer.Serialize(Input());var cipher=protection.Protect("one",Id,plaintext);Assert.DoesNotContain("0912",cipher);Assert.DoesNotContain("ContactName",cipher);Assert.Equal(plaintext,protection.Unprotect("one",Id,cipher));Assert.Throws<CryptographicException>(()=>protection.Unprotect("two",Id,cipher));Assert.Throws<CryptographicException>(()=>protection.Unprotect("one",new string('b',32),cipher));Assert.Throws<CryptographicException>(()=>protection.Unprotect("one",Id,cipher[..^2]+"!!"));}
    [Fact] public void SqlModelContainsOnlyProtectedPrivatePayloadAndEnforcesUniqueDefaultAndRowVersion(){using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var model=db.Model.FindEntityType(typeof(CustomerAddress))!;Assert.Null(model.FindProperty("ContactName"));Assert.Null(model.FindProperty("Delivery"));Assert.True(model.FindProperty("Version")!.IsConcurrencyToken);Assert.Contains(model.GetIndexes(),i=>i.IsUnique&&i.GetFilter()=="[IsDefault]=1");var sql=db.Addresses.AsNoTracking().Where(a=>a.OwnerId=="one").OrderByDescending(a=>a.IsDefault).ThenByDescending(a=>a.CreatedAt).ThenBy(a=>a.Id).Take(21).ToQueryString();Assert.Contains("TOP",sql);Assert.Contains("OwnerId",sql);Assert.DoesNotContain("AspNet",sql);}
    private static WebApplicationFactory<Program> Host(FakeBook service)=>new ApiFactory().WithWebHostBuilder(b=>{b.UseEnvironment("Development");b.ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(new Dictionary<string,string?>{["Cors:Origins:0"]="http://127.0.0.1:3000"}));b.ConfigureTestServices(s=>s.AddSingleton<IAddressBook>(service));});
    private static HttpClient Client(WebApplicationFactory<Program> host,string? kind="access"){var c=host.CreateClient();if(kind is not null)c.DefaultRequestHeaders.Add("X-Test-Kind",kind);c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");return c;}
    [Theory][InlineData(null,401)][InlineData("mfa_pending",403)][InlineData("mfa_recovery",403)]
    public async Task IncompleteIdentityCannotReadOrWriteAddresses(string? kind,int expected){var fake=new FakeBook();using var host=Host(fake);using var c=Client(host,kind);Assert.Equal(expected,(int)(await c.GetAsync("/api/addresses")).StatusCode);Assert.Equal(expected,(int)(await c.PutAsJsonAsync("/api/addresses/"+Id,Input())).StatusCode);Assert.Equal(0,fake.Calls);}
    [Fact] public async Task NativeAddressContractBindsOwnerFromClaimsAndContainsNoCiphertext(){var fake=new FakeBook();using var host=Host(fake);using var c=Client(host);using var r=await c.GetAsync("/api/addresses");Assert.Equal(HttpStatusCode.OK,r.StatusCode);Assert.Contains("no-store",r.Headers.CacheControl!.ToString());var json=await r.Content.ReadAsStringAsync();Assert.DoesNotContain("ownerId",json);Assert.DoesNotContain("protectedData",json);Assert.Equal("test-user",fake.Owner);await ContractWireCapture.SaveAsync("address-book",json);using var saved=await c.PutAsJsonAsync("/api/addresses/"+Id,Input());Assert.Equal(HttpStatusCode.Created,saved.StatusCode);await ContractWireCapture.SaveAsync("address-save",await saved.Content.ReadAsStringAsync());Assert.Equal("09121234567",fake.Last!.ContactPhone);using var deleted=await c.SendAsync(new(HttpMethod.Delete,"/api/addresses/"+Id){Content=JsonContent.Create(new DeleteAddressInput("AAAAAAAAAAE="))});Assert.Equal(HttpStatusCode.NoContent,deleted.StatusCode);Assert.Equal(3,fake.Calls);}
    [Fact] public async Task InvalidOriginsQueriesUnknownAuthorityAndMissingVersionNeverReachService(){var fake=new FakeBook();using var host=Host(fake);using var c=Client(host);c.DefaultRequestHeaders.Remove("Origin");Assert.Equal(HttpStatusCode.Forbidden,(await c.PutAsJsonAsync("/api/addresses/"+Id,Input())).StatusCode);c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");Assert.Equal(HttpStatusCode.BadRequest,(await c.GetAsync("/api/addresses?ownerId=other")).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync("/api/addresses/"+Id,new{Label="home",ContactName="Test person",ContactPhone="09121234567",Delivery=Input().Delivery,MakeDefault=false,OwnerId="other"})).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync("/api/addresses/"+Id,Input() with{MakeDefault=null})).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await c.SendAsync(new(HttpMethod.Delete,"/api/addresses/"+Id){Content=JsonContent.Create(new{})})).StatusCode);Assert.Equal(0,fake.Calls);}
    public sealed class FakeBook:IAddressBook
    {
        public int Calls;public string? Owner;public SaveAddressInput? Last;
        private static SavedAddressData Row(){var v=AddressBookRules.Normalize(Input());return new(Id,v.Label,v.ContactName,v.ContactPhone,v.Delivery,true,DateTimeOffset.Parse("2026-10-23T00:00:00Z"),DateTimeOffset.Parse("2026-10-23T00:00:00Z"),"AAAAAAAAAAE=",v.Details);}
        public Task<AddressBookData> ReadAsync(string owner,CancellationToken ct){Calls++;Owner=owner;return Task.FromResult(new AddressBookData(1,20,[Row()]));}
        public Task<SaveAddressResult> SaveAsync(string owner,string id,SaveAddressInput input,CancellationToken ct){Calls++;Owner=owner;Last=input;return Task.FromResult(new SaveAddressResult(1,Row(),false));}
        public Task DeleteAsync(string owner,string id,DeleteAddressInput input,CancellationToken ct){Calls++;Owner=owner;return Task.CompletedTask;}
    }
}
