using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Shop.Modules.Identity;
using Shop.Modules.Market;
using Shop.SqlTests;

namespace Shop.PhoneHarness;
internal static class PhoneHarnessProgram
{
    public static async Task Main()
    {
        if(!OperatingSystem.IsMacOS()&&!OperatingSystem.IsLinux())throw new InvalidOperationException("Unix private QA files are required.");
        var root=Path.GetFullPath(Environment.GetEnvironmentVariable("SHOP_PHONE_QA_ROOT")??throw new InvalidOperationException("Use the owned phone QA wrapper."));
        var run=Guid.NewGuid().ToString("N");var directory=Path.Combine(root,"tmp","phone-discovery-qa-"+run);
        Directory.CreateDirectory(directory);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(directory,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
        var fixture=new SqlFixture{ContentRoot=Path.Combine(root,"backend","src","Shop.Api")};WebApplicationFactory<global::Program>? factory=null;
        try{
            await fixture.InitializeAsync();
            factory=fixture.Factory.WithWebHostBuilder(builder=>builder.ConfigureAppConfiguration((_,config)=>config.AddInMemoryCollection(new Dictionary<string,string?>{
                ["Cors:Origins:0"]="http://sayman-phone-ui.localhost:3108",["Cors:Origins:1"]="http://sayman-phone-admin.localhost:3178",["Cors:AdminOrigins:0"]="http://sayman-phone-admin.localhost:3178",["PhoneDiscovery:AutomaticNotificationsEnabled"]="true"
            })));
            var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false,HandleCookies=false});
            await using(var scope=factory.Services.CreateAsyncScope()){
                var services=scope.ServiceProvider;var environment=services.GetRequiredService<IWebHostEnvironment>();
                await DevelopmentPhoneDiscoverySeed.RunAsync(services,environment,Path.Combine(root,"backend","src","Shop.Api"),CancellationToken.None);
                var users=services.GetRequiredService<UserManager<ShopUser>>();
                async Task<object> User(string prefix,bool admin){
                    var name=prefix+run[..12];var user=new ShopUser{UserName=name,Email=name+"@example.test",DisplayName=admin?"مدیر آزمایش گوشی":"مشتری آزمایش گوشی",EmailConfirmed=true,RequireMfa=admin};
                    var created=await users.CreateAsync(user,fixture.Password);if(!created.Succeeded)throw new InvalidOperationException("Generated phone QA identity creation failed.");
                    string? key=null;if(admin){if(!(await users.AddToRoleAsync(user,"Administrator")).Succeeded||!(await users.ResetAuthenticatorKeyAsync(user)).Succeeded||!(await users.SetTwoFactorEnabledAsync(user,true)).Succeeded)throw new InvalidOperationException("Generated phone QA administrator MFA setup failed.");key=await users.GetAuthenticatorKeyAsync(user);}
                    return new{id=user.Id,username=name,password=fixture.Password,authenticatorKey=key};
                }
                var credentials=new{runId=run,syntheticTestOnly=true,admin=await User("phoneadmin",true),customer=await User("phonecustomer",false),otherCustomer=await User("phoneother",false)};
                var credentialPath=Path.Combine(directory,"credentials.json");await File.WriteAllTextAsync(credentialPath,JsonSerializer.Serialize(credentials));if(!OperatingSystem.IsWindows())File.SetUnixFileMode(credentialPath,UnixFileMode.UserRead|UnixFileMode.UserWrite);
            }
            var builder=WebApplication.CreateBuilder(new WebApplicationOptions{Args=[],ContentRootPath=root,EnvironmentName="Development"});builder.WebHost.UseUrls("http://127.0.0.1:5183");builder.Logging.ClearProviders();var app=builder.Build();
            app.Run(async context=>{
                using var outgoing=new HttpRequestMessage(new HttpMethod(context.Request.Method),context.Request.Path+context.Request.QueryString);
                if(context.Request.ContentLength>0||context.Request.Headers.ContainsKey("Transfer-Encoding"))outgoing.Content=new StreamContent(context.Request.Body);
                foreach(var header in context.Request.Headers){if(header.Key.Equals("Host",StringComparison.OrdinalIgnoreCase)||header.Key.Equals("Content-Length",StringComparison.OrdinalIgnoreCase))continue;if(!outgoing.Headers.TryAddWithoutValidation(header.Key,header.Value.ToArray()))outgoing.Content?.Headers.TryAddWithoutValidation(header.Key,header.Value.ToArray());}
                try{using var response=await client.SendAsync(outgoing,HttpCompletionOption.ResponseHeadersRead,context.RequestAborted);context.Response.StatusCode=(int)response.StatusCode;foreach(var header in response.Headers.Concat(response.Content.Headers))if(!header.Key.Equals("Transfer-Encoding",StringComparison.OrdinalIgnoreCase))context.Response.Headers[header.Key]=header.Value.ToArray();await response.Content.CopyToAsync(context.Response.Body,context.RequestAborted);}catch(OperationCanceledException)when(context.RequestAborted.IsCancellationRequested){}catch{if(!context.Response.HasStarted){context.Response.StatusCode=(int)HttpStatusCode.BadGateway;await context.Response.WriteAsJsonAsync(new{title="phone_qa_unavailable"});}}
            });
            var state=new{runId=run,syntheticTestOnly=true,directory,pid=Environment.ProcessId,apiPort=5183,storefrontPort=3108,adminPort=3178,mainChanged=false,connectionDatabase=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(fixture.Connection).InitialCatalog};
            await File.WriteAllTextAsync(Path.Combine(root,"tmp","phone-discovery-qa-current.json"),JsonSerializer.Serialize(state));
            Console.WriteLine("PHONE_QA_READY "+run);await app.RunAsync();
        }finally{
            // ConsoleLifetime may already dispose the in-process API providers on
            // SIGTERM. Cleanup uses a fresh independent SQL connection and only
            // the random database generated by this fixture, never a supplied DB.
            if(!string.IsNullOrEmpty(fixture.Connection)){
                var settings=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(fixture.Connection);var database=settings.InitialCatalog;
                if(!System.Text.RegularExpressions.Regex.IsMatch(database,"^SaymanTest_[a-f0-9]{32}$",System.Text.RegularExpressions.RegexOptions.CultureInvariant))throw new InvalidOperationException("Phone QA database ownership changed.");
                settings.InitialCatalog="master";Microsoft.Data.SqlClient.SqlConnection.ClearAllPools();
                await using(var sql=new Microsoft.Data.SqlClient.SqlConnection(settings.ConnectionString)){
                    await sql.OpenAsync();await using var command=sql.CreateCommand();command.CommandText=$"IF DB_ID(N'{database}') IS NOT NULL BEGIN ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]; END";await command.ExecuteNonQueryAsync();
                }
                try{await fixture.DisposeAsync();}catch(ObjectDisposedException){/* The owned database has already been removed above. */}
                var keys=Path.Combine(Path.GetTempPath(),database);if(Directory.Exists(keys)&&new DirectoryInfo(keys).LinkTarget is null)Directory.Delete(keys,true);
            }
            if(factory is not null)await factory.DisposeAsync();
            // Only this process's newly created GUID directory and synthetic credentials.
            if(Directory.Exists(directory)&&new DirectoryInfo(directory).LinkTarget is null)Directory.Delete(directory,true);
        }
    }
}
