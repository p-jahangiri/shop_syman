using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Media;
using SkiaSharp;
using Xunit;
namespace Shop.Tests;

public sealed class PublicImageApiTests
{
    [Theory][InlineData("Filesystem","Filesystem image storage is unavailable outside Development.")][InlineData("S3","production requires HTTPS")]
    public void ProductionMediaGuardsRemainActiveAfterConfigurationIsResolved(string mode,string expected)
    {
        var builder=WebApplication.CreateBuilder(new WebApplicationOptions{EnvironmentName="Production",Args=[]});
        builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{["Inventory:ExpiryEnabled"]="false",["Media:Storage"]=mode,["Media:CleanupEnabled"]="false",["Media:Directory"]="/private/tmp/sayman-test-must-not-use",["Media:S3:Endpoint"]="http://127.0.0.1:1",["Media:S3:Bucket"]="test-images",["Media:S3:AccessKey"]="test-only",["Media:S3:SecretKey"]="test-only"});
        builder.AddPublicMedia();using var services=builder.Services.BuildServiceProvider();var error=Assert.Throws<InvalidOperationException>(()=>services.GetRequiredService<IPublicImageStore>());Assert.Contains(expected,error.Message);
    }
    [Theory][InlineData(null,null,null,401)][InlineData("mfa_pending","catalog.write","CatalogManager",403)][InlineData("staff_password_change","cms.write","ContentManager",403)][InlineData("access","cms.write",null,403)][InlineData("access","catalog.read","CatalogManager",403)][InlineData("access","support.write","SupportAgent",403)]
    public async Task UploadNeedsCompletedMfaKnownStaffRoleAndPublicImageWritePermission(string? kind,string? permission,string? role,int expected){using var factory=new ImageApiFactory();using var client=factory.CreateClient();if(kind is not null)client.DefaultRequestHeaders.Add("X-Test-Kind",kind);if(permission is not null)client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);if(role is not null)client.DefaultRequestHeaders.Add("X-Test-Roles",role);using var form=File(PublicImageTests.Image());Assert.Equal(expected,(int)(await client.PostAsync("/api/admin/media/images",form)).StatusCode);Assert.Empty(factory.Repository.Assets);}
    [Theory][InlineData(SKEncodedImageFormat.Png,"تصویر کالا.png","image/png")][InlineData(SKEncodedImageFormat.Jpeg,"تصویر کالا.jpg","image/jpeg")][InlineData(SKEncodedImageFormat.Webp,"تصویر کالا.webp","image/webp")]
    public async Task MultipartUploadAcceptsEverySupportedFormatAndUnicodeFilename(SKEncodedImageFormat format,string filename,string type){using var factory=new ImageApiFactory();using var client=Admin(factory);using var form=File(PublicImageTests.Image(format),type,filename);using var response=await client.PostAsync("/api/admin/media/images",form);Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Equal(3,factory.Store.Objects.Count);Assert.Equal("Ready",Assert.Single(factory.Repository.Assets).Value.Status);}
    [Fact] public async Task ContentManagerCanUploadPublicCmsImagesWithoutCatalogOrPrivateFileAuthority(){using var factory=new ImageApiFactory();using var client=Admin(factory,"cms.write","ContentManager");Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/admin/media/capabilities")).StatusCode);using(var form=File(PublicImageTests.Image()))Assert.Equal(HttpStatusCode.OK,(await client.PostAsync("/api/admin/media/images",form)).StatusCode);using var json=new StringContent("{}",System.Text.Encoding.UTF8,"application/json");Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsync("/api/admin/brands",json)).StatusCode);var id=new string('a',32);Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync($"/api/admin/credit/applications/{id}/documents")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync($"/api/admin/support/tickets/{id}/attachments")).StatusCode);}
    [Fact] public async Task AuthenticatedMultipartUploadOverOldLimitReturnsOnlySanitizedAnonymousImages(){using var factory=new ImageApiFactory();using var client=Admin(factory);var input=PublicImageTests.Image();Array.Resize(ref input,600000);using var form=File(input);using var response=await client.PostAsync("/api/admin/media/images",form);var json=await response.Content.ReadAsStringAsync();Assert.Equal(HttpStatusCode.OK,response.StatusCode);var dto=JsonNode.Parse(json)!;var id=dto["id"]!.GetValue<string>();Assert.Equal($"/media/catalog/{id}/card.webp",dto["url"]!.GetValue<string>());Assert.Equal(3,dto["variants"]!.AsArray().Count);Assert.DoesNotContain(Convert.ToHexStringLower(SHA256.HashData(input)),json);Assert.DoesNotContain("local-private-filename",json);using var anonymous=factory.CreateClient();using var image=await anonymous.GetAsync("/api"+dto["url"]!.GetValue<string>());Assert.Equal(HttpStatusCode.OK,image.StatusCode);Assert.Equal("image/webp",image.Content.Headers.ContentType!.MediaType);Assert.True(image.Headers.CacheControl!.Public);Assert.Equal("catalog-image-v1",image.Headers.GetValues("X-Shop-Public-Resource").Single());Assert.Equal("RIFF",System.Text.Encoding.ASCII.GetString((await image.Content.ReadAsByteArrayAsync())[..4]));Assert.Equal(HttpStatusCode.NotFound,(await anonymous.GetAsync($"/api/media/catalog/{id}/original.png")).StatusCode);}
    [Fact] public async Task BadFileMultipartCountAndOriginCannotCreateReadyMetadata(){using var factory=new ImageApiFactory();using var client=Admin(factory);using(var form=File(PublicImageTests.Image(),"image/svg+xml")){Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync("/api/admin/media/images",form)).StatusCode);}using(var form=File(PublicImageTests.Image())){form.Add(new StringContent("not allowed"),"extra");Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync("/api/admin/media/images",form)).StatusCode);}client.DefaultRequestHeaders.Add("Origin","https://unrelated.example");using(var form=File(PublicImageTests.Image())){Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync("/api/admin/media/images",form)).StatusCode);}Assert.Empty(factory.Repository.Assets);}
    [Fact] public async Task UnknownLengthMultipartEpilogueCannotBypassTheAggregateUploadLimit(){using var factory=new ImageApiFactory();using var client=Admin(factory);using var form=File(PublicImageTests.Image());var normal=await form.ReadAsByteArrayAsync();var oversized=new byte[normal.Length+ImageLimits.MaxRequestBytes];normal.CopyTo(oversized,0);using var content=new UnknownLengthContent(oversized,form.Headers.ContentType!.ToString());using var response=await client.PostAsync("/api/admin/media/images",content);Assert.Equal(HttpStatusCode.RequestEntityTooLarge,response.StatusCode);Assert.Empty(factory.Repository.Assets);Assert.Empty(factory.Store.Objects);}
    [Fact] public async Task UnknownLengthOversizedFileCannotReachTheScannerOrStore(){using var factory=new ImageApiFactory();using var client=Admin(factory);using var form=File(new byte[ImageLimits.MaxInputBytes+1]);using var content=new UnknownLengthContent(await form.ReadAsByteArrayAsync(),form.Headers.ContentType!.ToString());using var response=await client.PostAsync("/api/admin/media/images",content);Assert.Equal(HttpStatusCode.RequestEntityTooLarge,response.StatusCode);Assert.Empty(factory.Repository.Assets);Assert.Empty(factory.Store.Objects);}
    [Fact] public async Task UnconfiguredScanningDoesNotPretendTheUploadSucceeded(){using var factory=new ImageApiFactory(false);using var client=Admin(factory);using var form=File(PublicImageTests.Image());var response=await client.PostAsync("/api/admin/media/images",form);Assert.Equal(HttpStatusCode.ServiceUnavailable,response.StatusCode);Assert.Empty(factory.Repository.Assets);Assert.Empty(factory.Store.Objects);}
    [Fact] public async Task S3AdapterUsesOnlyItsFixedBucketAndIssuedVariantKeys(){using var capture=new CapturingS3();var store=new S3ImageStore(capture,"public-images");var variant=new SkiaImageSanitizer().Sanitize(PublicImageTests.Image(),"p.png","image/png",default).Variants[0];var id=Guid.NewGuid().ToString("N");await store.PutAsync(id,variant,default);Assert.Equal("public-images",capture.Bucket);Assert.Equal(PublicImagePaths.Key(id,"thumb"),capture.Key);Assert.Equal(ChecksumAlgorithm.SHA256,capture.Checksum);Assert.Equal(variant.Bytes,await store.ReadAsync(id,"thumb",variant.Bytes.Length,default));await store.DeleteAsync(id,"thumb",default);Assert.Equal(PublicImagePaths.Key(id,"thumb"),capture.Deleted);}
    private static HttpClient Admin(ImageApiFactory factory,string permission="catalog.write",string role="CatalogManager"){var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind","access");client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);client.DefaultRequestHeaders.Add("X-Test-Roles",role);return client;}
    private static MultipartFormDataContent File(byte[] bytes,string type="image/png",string filename="local-private-filename.png"){var form=new MultipartFormDataContent();var content=new ByteArrayContent(bytes);content.Headers.ContentType=new MediaTypeHeaderValue(type);form.Add(content,"file",filename);return form;}
    private sealed class ImageApiFactory(bool scanning=true):WebApplicationFactory<Program>
    {
        public PublicImageTests.MemoryImages Repository{get;}=new();public PublicImageTests.MemoryStore Store{get;}=new();
        protected override void ConfigureWebHost(IWebHostBuilder builder){builder.UseEnvironment("Testing");builder.ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(new Dictionary<string,string?>{["Inventory:ExpiryEnabled"]="false",["Media:Storage"]="Disabled",["Media:CleanupEnabled"]="false",["Media:ClamAvHost"]="",["ConnectionStrings:Shop"]="Server=127.0.0.1,1;Database=unused;User Id=unused;Password=unused;Connect Timeout=1",["Auth:SigningKey"]=new string('t',80)}));builder.ConfigureTestServices(s=>{s.AddAuthentication(o=>{o.DefaultAuthenticateScheme="ImageTest";o.DefaultChallengeScheme="ImageTest";o.DefaultForbidScheme="ImageTest";}).AddScheme<AuthenticationSchemeOptions,TestAuthentication>("ImageTest",_=>{});s.AddSingleton<IPublicImageRepository>(Repository);s.AddSingleton<IPublicImageStore>(Store);s.AddSingleton<IImageScanner>(new PublicImageTests.Scanner{Configured=scanning});});}
    }
    private sealed class UnknownLengthContent:HttpContent
    {
        private readonly byte[] bytes;
        public UnknownLengthContent(byte[] bytes,string contentType){this.bytes=bytes;Headers.ContentType=MediaTypeHeaderValue.Parse(contentType);}
        protected override Task SerializeToStreamAsync(Stream stream,TransportContext? context)=>stream.WriteAsync(bytes).AsTask();
        protected override bool TryComputeLength(out long length){length=0;return false;}
    }
    private sealed class CapturingS3:AmazonS3Client
    {
        public string? Bucket;public string? Key;public string? Deleted;public ChecksumAlgorithm? Checksum;private byte[] bytes=[];
        public CapturingS3():base(new AnonymousAWSCredentials(),new AmazonS3Config{ServiceURL="http://127.0.0.1:1",ForcePathStyle=true}){}
        public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request,CancellationToken ct=default){Bucket=request.BucketName;Key=request.Key;Checksum=request.ChecksumAlgorithm;using var output=new MemoryStream();await request.InputStream.CopyToAsync(output,ct);bytes=output.ToArray();return new(){HttpStatusCode=HttpStatusCode.OK};}
        public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest request,CancellationToken ct=default){Assert.Equal(Bucket,request.BucketName);Assert.Equal(Key,request.Key);return Task.FromResult(new GetObjectResponse{ContentLength=bytes.Length,ResponseStream=new MemoryStream(bytes,false)});}
        public override Task<DeleteObjectResponse> DeleteObjectAsync(DeleteObjectRequest request,CancellationToken ct=default){Deleted=request.Key;return Task.FromResult(new DeleteObjectResponse());}
    }
}
