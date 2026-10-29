using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class StaffAdministrationTests
{
    [Fact] public void CursorIsBoundToEveryFilterAndSupportsIdentityKeyLengths()
    {
        var filter=StaffFilter.Create("كاربَر ۱۲", "true", "ContentManager"); Assert.Equal("کاربر 12",filter.Search);
        var token=StaffPaging.Encode(new string('a',450),filter);Assert.Equal(new string('a',450),StaffPaging.Decode(token,filter));
        foreach(var changed in new[]{StaffFilter.Create("other","true","ContentManager"),StaffFilter.Create("كاربَر ۱۲","false","ContentManager"),StaffFilter.Create("كاربَر ۱۲","true","Administrator")})Assert.Throws<BusinessException>(()=>StaffPaging.Decode(token,changed));
        Assert.Null(StaffPaging.Decode(null,filter));Assert.Throws<BusinessException>(()=>StaffPaging.Decode("!",filter));Assert.Throws<BusinessException>(()=>StaffFilter.Create(new string('x',121)));Assert.Throws<BusinessException>(()=>StaffFilter.Create("a b c d e f g h i"));
    }
    [Theory][InlineData("yes","all")][InlineData("all","administrator")][InlineData("all","Root")]
    public void UnknownRolesOrFiltersAreRejected(string active,string role)=>Assert.Throws<BusinessException>(()=>StaffFilter.Create(null,active,role));
    [Fact] public void StaffInputsRequireExplicitStateVersionAndNonemptyKnownRoles()
    {
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffUpdateInput(["Administrator"],null,"v1")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffUpdateInput([],true,"v1")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffGrantInput("one",["Administrator","Administrator"],"v1")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffGrantInput("one",["Root"],"v1")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffGrantInput("one",["Administrator"],"")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffCandidateInput(" ")));
        Assert.Throws<BusinessException>(()=>StaffInput.Validate(new StaffCandidateInput("test\nuser")));
    }
    [Fact] public void OnlyAdministratorRoleContainsStaffPermissions()
    {
        var catalog=StaffInput.Catalog();Assert.Equal(new[]{"Administrator","CatalogManager","ContentManager","CreditReviewer","FinanceManager","InventoryManager","SalesManager","SupportAgent"},catalog.Roles.Select(x=>x.Id));Assert.Contains("staff.write",catalog.Roles.Single(x=>x.Id=="Administrator").Permissions);
        Assert.All(catalog.Roles.Where(x=>x.Id!="Administrator"),r=>Assert.DoesNotContain(r.Permissions,p=>p.StartsWith("staff.",StringComparison.Ordinal)));
    }
    [Fact] public void CandidateContractKeepsFalseCredentialCapabilityWithoutHashOrContactValues()
    {
        var value=new StaffCandidate(1,"one","unit","کارمند نمونه",true,true,false,false,false,"v1");
        var json=System.Text.Json.JsonSerializer.Serialize(value,new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web){DefaultIgnoreCondition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull});
        var body=JsonNode.Parse(json)!;Assert.False(body["hasPassword"]!.GetValue<bool>());Assert.True(body["contactVerified"]!.GetValue<bool>());Assert.Null(body["passwordHash"]);Assert.Null(body["email"]);Assert.Null(body["phoneNumber"]);
    }
    [Fact] public void HistoryCursorKeepsLongIdsAndIsScopedToStaff()
    {
        var cursor=StaffHistoryPaging.Encode(long.MaxValue,"one");Assert.Equal(long.MaxValue,StaffHistoryPaging.Decode(cursor,"one"));Assert.Throws<BusinessException>(()=>StaffHistoryPaging.Decode(cursor,"two"));Assert.Throws<BusinessException>(()=>StaffHistoryPaging.Decode("!","one"));
    }
    [Fact] public void StaffSqlProjectsOnlyBoundedPublicAccountMetadata()
    {
        using var db=new IdentityDbContext(DesignTimeOptions.Create<IdentityDbContext>("identity"));var service=new StaffAdministration(null!,db,TimeProvider.System,null!);
        var sql=StaffAdministration.Project(service.Match(StaffFilter.Create("كاربَر ۱۲","false","ContentManager"),"after").OrderBy(u=>u.Id).Take(51)).ToQueryString();
        Assert.Contains("TOP",sql);Assert.Contains("AspNetUserRoles",sql);Assert.Contains("AspNetRoles",sql);Assert.Contains("ConcurrencyStamp",sql);Assert.DoesNotContain("PasswordHash",sql);Assert.DoesNotContain("SecurityStamp",sql);Assert.DoesNotContain("Email",sql);Assert.DoesNotContain("PhoneNumber",sql);Assert.DoesNotContain("AspNetUserTokens",sql);
    }
    private static WebApplicationFactory<Program> Host(FakeStaff fake)=>new ApiFactory().WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.AddSingleton<IStaffAdministration>(fake)));
    private static HttpClient Client(WebApplicationFactory<Program> host,string? kind="access",string? permission="staff.read",string? role="Administrator")
    {
        var client=host.CreateClient();if(kind is not null)client.DefaultRequestHeaders.Add("X-Test-Kind",kind);if(permission is not null)client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);if(role is not null)client.DefaultRequestHeaders.Add("X-Test-Roles",role);return client;
    }
    [Theory][InlineData("/api/admin/staff")][InlineData("/api/admin/staff-role-catalog")][InlineData("/api/admin/staff/one")][InlineData("/api/admin/staff/one/history")]
    public async Task AnonymousCannotReadStaff(string path){var fake=new FakeStaff();using var host=Host(fake);using var client=Client(host,null);Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync(path)).StatusCode);Assert.Equal(0,fake.Calls);}
    [Theory][InlineData("mfa_pending","staff.read","Administrator")][InlineData("access","catalog.read","Administrator")][InlineData("access","staff.read","CatalogManager")]
    public async Task CompleteAdministratorPermissionIsRequiredForReads(string kind,string permission,string role){var fake=new FakeStaff();using var host=Host(fake);using var client=Client(host,kind,permission,role);Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/admin/staff")).StatusCode);Assert.Equal(0,fake.Calls);}
    [Theory][InlineData("mfa_pending","staff.write","Administrator")][InlineData("access","staff.read","Administrator")][InlineData("access","staff.write","ContentManager")]
    public async Task UnauthorizedWritesNeverStartAuditTransaction(string kind,string permission,string role){var fake=new FakeStaff();using var host=Host(fake);using var client=Client(host,kind,permission,role);Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync("/api/admin/staff",new{AccountId="one",Roles=new[]{"ContentManager"},Version="v1"})).StatusCode);Assert.Equal(0,fake.Calls);}
    [Theory]
    [InlineData("POST","/api/admin/staff","{\"accountId\":\"one\",\"roles\":[],\"version\":\"v1\"}")]
    [InlineData("PUT","/api/admin/staff/one","{\"roles\":[\"Administrator\"],\"version\":\"v1\"}")]
    [InlineData("PUT","/api/admin/staff/bad!","{\"roles\":[\"Administrator\"],\"isActive\":false,\"version\":\"v1\"}")]
    [InlineData("POST","/api/admin/staff-candidate","{\"identifier\":\" \"}")]
    public async Task InvalidInputsAreRejectedBeforeSqlAuditTransaction(string method,string path,string json)
    {
        var fake=new FakeStaff();using var host=Host(fake);using var client=Client(host,permission:"staff.write");using var response=await client.SendAsync(new(new HttpMethod(method),path){Content=new StringContent(json,System.Text.Encoding.UTF8,"application/json")});Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);Assert.Equal(0,fake.Calls);
    }
    [Fact] public async Task NativeReadContractsDoNotExposeAuthenticationSecretsOrOpenTransactions()
    {
        var fake=new FakeStaff();using var host=Host(fake);using var client=Client(host);
        foreach(var (path,name) in new[]{("/api/admin/staff","staff-page"),("/api/admin/staff/one","staff-detail"),("/api/admin/staff-role-catalog","staff-roles"),("/api/admin/staff/one/history","staff-history")}){
            using var response=await client.GetAsync(path);Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var json=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("securityStamp",json);Assert.DoesNotContain("passwordHash",json);Assert.DoesNotContain("email",json);Assert.DoesNotContain("phoneNumber",json);await ContractWireCapture.SaveAsync(name,json);
            var body=JsonNode.Parse(json)!;if(name=="staff-page"||name=="staff-history"){Assert.True(body.AsObject().ContainsKey("nextCursor"));Assert.Null(body["nextCursor"]);}if(name=="staff-history")Assert.Equal("9007199254740993",body["items"]![0]!["id"]!.GetValue<string>());
        }
        Assert.Equal(3,fake.Calls);
    }
    public sealed class FakeStaff:IStaffAdministration
    {
        public int Calls;
        private static StaffRow Row(string id)=>new(id,"unit-account","کارمند نمونه",true,true,false,DateTimeOffset.Parse("2026-10-23T00:00:00Z"),"unit-version",["ContentManager"]);
        public Task<StaffPage> PageAsync(StaffFilter filter,string? cursor,CancellationToken ct){Calls++;return Task.FromResult(new StaffPage(1,50,[Row("one")],null));}
        public Task<StaffDetail> DetailAsync(string id,CancellationToken ct){Calls++;return Task.FromResult(new StaffDetail(1,Row(id)));}
        public Task<StaffAccessHistory> HistoryAsync(string id,string? cursor,CancellationToken ct){Calls++;return Task.FromResult(new StaffAccessHistory(1,50,[new(9007199254740993,"STAFF_ROLE_ADDED:ContentManager","test-user","مدیر نمونه",DateTimeOffset.Parse("2026-10-23T00:00:00Z"),"unit-trace")],null));}
        public Task<StaffCandidate> CandidateAsync(string actorId,string stamp,StaffCandidateInput input,CancellationToken ct)=>throw new InvalidOperationException("Mutation audit must never be bypassed in a no-SQL test.");
        public Task<StaffDetail> GrantAsync(string actorId,string stamp,StaffGrantInput input,string trace,CancellationToken ct)=>throw new InvalidOperationException("Mutation audit must never be bypassed in a no-SQL test.");
        public Task<StaffDetail> UpdateAsync(string actorId,string stamp,string id,StaffUpdateInput input,string trace,CancellationToken ct)=>throw new InvalidOperationException("Mutation audit must never be bypassed in a no-SQL test.");
    }
}
