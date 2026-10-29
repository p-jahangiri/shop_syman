using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.Modules.Support;
using Shop.SharedKernel;
using Shop.SqlTests;

namespace Shop.UiHarness;
internal sealed record PrivateStorageCredentials(string AccessKey,string SecretKey,string Bucket,string Endpoint,string ClamHost,int ClamPort);
internal static class PrivateStorageVerifier
{
    public static byte[] Document(string text="Synthetic private QA attachment. No customer data.")
    {
        // ASCII-only, one-page, valid PDF with computed xref offsets.
        var content="BT /F1 10 Tf 20 60 Td ("+text.Replace("\\","\\\\").Replace("(","\\(").Replace(")","\\)")+") Tj ET\n";
        string[] objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+Encoding.ASCII.GetByteCount(content)+" >>\nstream\n"+content+"endstream"];
        var output=new StringBuilder("%PDF-1.7\n");var offsets=new List<int>();for(var i=0;i<objects.Length;i++){offsets.Add(output.Length);output.Append(i+1).Append(" 0 obj\n").Append(objects[i]).Append("\nendobj\n");}var xref=output.Length;output.Append("xref\n0 6\n0000000000 65535 f \n");foreach(var offset in offsets)output.Append(offset.ToString("D10",CultureInfo.InvariantCulture)).Append(" 00000 n \n");output.Append("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n").Append(xref).Append("\n%%EOF\n");return Encoding.ASCII.GetBytes(output.ToString());
    }
    public static (JsonObject Meta,PrivateStorageCredentials Credentials,string Root) ReadServices()
    {
        var root=Environment.GetEnvironmentVariable("SHOP_UI_ROOT")??throw new InvalidOperationException("Use the owned harness launcher.");var path=Path.Combine(root,"tmp/private-files-services-current.json");var meta=JsonNode.Parse(File.ReadAllText(path))!.AsObject();var run=meta["run"]!.GetValue<string>();if(meta["qaOnly"]!.GetValue<bool>()!=true||meta["cleanup"]!.GetValue<bool>()||!System.Text.RegularExpressions.Regex.IsMatch(run,"^[a-f0-9]{32}$")||meta["privateDirectory"]!.GetValue<string>()!="tmp/private-files-services/"+run)throw new InvalidOperationException("Only the exact owned private services run is supported.");var privatePath=Path.Combine(root,"tmp/private-files-services",run);var credentials=Path.Combine(privatePath,"credentials.json");if(new DirectoryInfo(privatePath).LinkTarget is not null||new FileInfo(credentials).LinkTarget is not null||!OperatingSystem.IsWindows()&&(File.GetUnixFileMode(credentials)&(UnixFileMode)63)!=0)throw new InvalidOperationException("Owned private credential permissions changed.");var value=JsonSerializer.Deserialize<PrivateStorageCredentials>(File.ReadAllText(credentials),new JsonSerializerOptions(JsonSerializerDefaults.Web))??throw new InvalidOperationException("Private QA credentials missing.");if(value.Endpoint!="http://127.0.0.1:19100"||value.ClamHost!="127.0.0.1"||value.ClamPort!=19310||value.Bucket!="sayman-private-qa-"+run)throw new InvalidOperationException("Only fixed loopback private QA services are supported.");return(meta,value,root);
    }
    public static Dictionary<string,string?> Configuration(PrivateStorageCredentials c)=>new(){["Files:Storage"]="S3",["Files:S3:Endpoint"]=c.Endpoint,["Files:S3:Bucket"]=c.Bucket,["Files:S3:Region"]="us-east-1",["Files:S3:AccessKey"]=c.AccessKey,["Files:S3:SecretKey"]=c.SecretKey,["Files:ClamAvHost"]=c.ClamHost,["Files:ClamAvPort"]=c.ClamPort.ToString(CultureInfo.InvariantCulture),["Files:ScanTimeoutSeconds"]="10"};
    private static void Check(bool value,string stage){if(!value)throw new InvalidOperationException("Private storage QA failed: "+stage);}
    private static async Task<JsonNode> Json(HttpResponseMessage response,string name,string directory)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Check(response.StatusCode==HttpStatusCode.OK,"http_"+name+"_"+(int)response.StatusCode);await File.WriteAllTextAsync(Path.Combine(directory,name+".json"),raw);await File.WriteAllTextAsync(Path.Combine(directory,name+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,actualS3AndClamAv=true,status=(int)response.StatusCode,method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,cacheControl=response.Headers.CacheControl?.ToString()}));return JsonNode.Parse(raw)!;}
    }
    public static async Task RunAsync()
    {
        if(Environment.GetEnvironmentVariables().Keys.Cast<string>().Any(k=>k.StartsWith("SHOP_UI_",StringComparison.Ordinal)&&k is not("SHOP_UI_ROOT"or"SHOP_UI_VERIFY_PRIVATE_STORAGE"or"SHOP_UI_PRIVATE_STORAGE_EVIDENCE")&&Environment.GetEnvironmentVariable(k)is{Length:>0}))throw new InvalidOperationException("Storage verification cannot be combined with other UI modes.");
        var evidence=Environment.GetEnvironmentVariable("SHOP_UI_PRIVATE_STORAGE_EVIDENCE")??"private-files-real-services";if(!System.Text.RegularExpressions.Regex.IsMatch(evidence,"^[a-z][a-z0-9-]{0,79}$"))throw new InvalidOperationException("Use an owned plain evidence name.");
        var (meta,credentials,root)=ReadServices();var directory=Path.Combine(root,"artifacts/checks/"+evidence+"-wire");if(Directory.Exists(directory))throw new InvalidOperationException("Use a new evidence directory.");Directory.CreateDirectory(directory);
        var reportPath=Path.Combine(root,"artifacts/checks/"+evidence+".json");if(File.Exists(reportPath))throw new InvalidOperationException("Do not overwrite service acceptance.");
        string version;using(var client=new TcpClient()){using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));await client.ConnectAsync(credentials.ClamHost,credentials.ClamPort,timeout.Token);await using var stream=client.GetStream();await stream.WriteAsync("zVERSION\0"u8.ToArray(),timeout.Token);var bytes=new List<byte>();var one=new byte[1];while(bytes.Count<512&&await stream.ReadAsync(one,timeout.Token)>0&&one[0]!=0)bytes.Add(one[0]);version=Encoding.ASCII.GetString(bytes.ToArray());}
        var parts=version.Split('/');Check(parts.Length==3&&parts[0].StartsWith("ClamAV ",StringComparison.Ordinal),"clam_version");Check(DateTimeOffset.TryParseExact(parts[2],["ddd MMM dd HH:mm:ss yyyy","ddd MMM  d HH:mm:ss yyyy","ddd MMM d HH:mm:ss yyyy"],CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var definitions),"clam_definition_date");Check(definitions<=DateTimeOffset.UtcNow&&DateTimeOffset.UtcNow-definitions<TimeSpan.FromHours(48),"fresh_clam_definitions");
        var scanner=new ClamAvPrivateFileScanner(new(credentials.ClamHost,credentials.ClamPort));var document=Document();await scanner.ScanAsync(document,default);
        var eicar=Encoding.ASCII.GetBytes(@"X5O!P%@AP[4\PZX54(P^)7CC)7}$"+"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");Check(eicar.Length==68,"eicar_probe_length");var rejected=false;try{await scanner.ScanAsync(eicar,default);}catch(BusinessException e)when(e.Code=="private_file_rejected"){rejected=true;}Check(rejected,"actual_engine_rejected_eicar");CryptographicOperations.ZeroMemory(eicar);
        var sql=new SqlFixture{ContentRoot=Path.Combine(root,"backend/src/Shop.Api")};await sql.InitializeAsync();var database=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(sql.Connection).InitialCatalog;string? fileId=null;var cleaned=false;
        try{
            using var factory=sql.Factory.WithWebHostBuilder(builder=>builder.ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(Configuration(credentials))));
            await using(var scope=factory.Services.CreateAsyncScope()){Check(scope.ServiceProvider.GetRequiredService<IPrivateFileStore>()is S3PrivateFileStore,"actual_s3_adapter");Check(scope.ServiceProvider.GetRequiredService<IPrivateFileScanner>()is ClamAvPrivateFileScanner,"actual_clam_adapter");}
            string token;await using(var scope=factory.Services.CreateAsyncScope()){var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="storageqa"+Guid.NewGuid().ToString("N");var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true};Check((await users.CreateAsync(user,sql.Password)).Succeeded,"generated_customer");token=(await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,sql.Password),true,true,false,default)).AccessToken;}
            using var http=factory.CreateClient(new(){HandleCookies=false});http.DefaultRequestHeaders.Authorization=new("Bearer",token);http.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");token="";
            var created=await Json(await http.PostAsJsonAsync("/api/support/tickets/commands/"+Guid.NewGuid().ToString("N"),new CreateTicketInput("تیکت ساختگی آزمون ذخیره‌ساز واقعی","فقط فایل ساختگی QA؛ بدون دادهٔ مشتری","fa")),"ticket",directory);var ticket=created["ticket"]!["id"]!.GetValue<string>();var command=Guid.NewGuid().ToString("N");var path=$"/api/support/tickets/{ticket}/attachments/{command}";
            MultipartFormDataContent Form(){var form=new MultipartFormDataContent();form.Add(new StringContent(created["ticket"]!["version"]!.GetValue<string>()),"version");form.Add(new StringContent("مدرک ساختگی برای S3 و ClamAV واقعی"),"body");form.Add(new StringContent("fa"),"locale");form.Add(new StringContent(PrivateFileRules.Hash(document)),"sha256");var data=new ByteArrayContent(document);data.Headers.ContentType=new("application/pdf");form.Add(data,"file","مدرک ساختگی.pdf");return form;}
            using(var form=Form())await Json(await http.PostAsync(path,form),"upload",directory);using(var form=Form()){var replay=await Json(await http.PostAsync(path,form),"replay",directory);Check(replay["replayed"]!.GetValue<bool>(),"historical_upload_replay");}
            await Json(await http.GetAsync("/api/support/files/capabilities"),"capabilities",directory);var page=await Json(await http.GetAsync($"/api/support/tickets/{ticket}/attachments"),"attachments",directory);Check(page["items"]!.AsArray().Count==1,"one_private_file");fileId=page["items"]![0]!["id"]!.GetValue<string>();
            using(var response=await http.GetAsync($"/api/support/tickets/{ticket}/attachments/{fileId}")){Check(response.StatusCode==HttpStatusCode.OK,"authorized_download");var downloaded=await response.Content.ReadAsByteArrayAsync();Check(document.AsSpan().SequenceEqual(downloaded),"exact_decrypted_document");Check(response.Headers.GetValues("X-Sayman-Private-File").Single()==fileId&&response.Content.Headers.ContentDisposition?.DispositionType=="attachment","private_download_headers");}
            using var s3=new AmazonS3Client(new BasicAWSCredentials(credentials.AccessKey,credentials.SecretKey),new AmazonS3Config{ServiceURL=credentials.Endpoint,ForcePathStyle=true,AuthenticationRegion="us-east-1"});using var store=new S3PrivateFileStore(s3,credentials.Bucket);byte[] ciphertext;
            using(var response=await s3.GetObjectAsync(credentials.Bucket,PrivateFileRules.Key(fileId))){ciphertext=await PrivateFileRead.BoundedAsync(response.ResponseStream,document.Length+32,default);}
            Check(ciphertext.AsSpan().IndexOf(document)<0&&ciphertext.AsSpan(0,4).SequenceEqual("SPF1"u8),"only_authenticated_ciphertext_in_s3");Check(!await store.CreateAsync(fileId,new byte[ciphertext.Length],default),"conditional_create_prevents_overwrite");var unchanged=await store.ReadAsync(fileId,ciphertext.Length,default);Check(unchanged is not null&&ciphertext.AsSpan().SequenceEqual(unchanged),"ciphertext_unchanged_after_rejected_overwrite");
            using(var anonymous=new HttpClient()){using var denied=await anonymous.GetAsync(credentials.Endpoint+"/"+credentials.Bucket+"/"+PrivateFileRules.Key(fileId));Check(denied.StatusCode==HttpStatusCode.Forbidden,"anonymous_object_denied");}
            await using(var scope=factory.Services.CreateAsyncScope()){var row=await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Objects.AsNoTracking().SingleAsync(x=>x.Id==fileId);Check(row.State=="Attached"&&row.CiphertextHash==PrivateFileRules.Hash(ciphertext)&&row.PlaintextHash==PrivateFileRules.Hash(document),"real_sql_object_binding");Check(row.ProtectedFilename.AsSpan().IndexOf(Encoding.UTF8.GetBytes("مدرک ساختگی.pdf"))<0,"protected_filename_in_sql");}
        }finally{await sql.DisposeAsync();cleaned=true;}
        var report=new{passed=true,actualS3=true,actualClamAv=true,clamVersion=version,definitionsAtUtc=definitions,definitionsYoungerThan48Hours=true,eicarRejected=true,cleanPdfRoundTrip=true,conditionalOverwriteRejected=true,anonymousObjectReadForbidden=true,plainFilenameAndKeyNotStoredInObject=true,actualSqlDatabase=database,databaseCleanup=cleaned,generatedFileId=fileId,servicesStillOwnedForBrowserQa=true,productionConfigured=false,nativeLinuxAccepted=false,serviceMetadata="tmp/private-files-services-current.json"};await File.WriteAllTextAsync(reportPath,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine("Actual private S3 / ClamAV / SQL round trip, EICAR rejection and conditional-create passed; owned SQL/keys cleaned, services retained only for browser QA.");
    }
}
