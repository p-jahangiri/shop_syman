using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Files;
using Shop.SharedKernel;

public sealed class DataProtectionPrivateFiles(IDataProtectionProvider provider):IPrivateFileProtection
{
    public byte[] Protect(string purpose,byte[] value)=>provider.CreateProtector(purpose).Protect(value);
    public byte[] Unprotect(string purpose,byte[] value)=>provider.CreateProtector(purpose).Unprotect(value);
}
public static class PrivateFilesConfiguration
{
    public static void AddPrivateFiles(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<PrivateFileSlots>();builder.Services.AddSingleton<IPrivateFileProtection,DataProtectionPrivateFiles>();builder.Services.AddSingleton<PrivateFileCrypto>();builder.Services.AddScoped<IPrivateFileVault,PrivateFileVault>();
        builder.Services.AddSingleton(s=>{var c=s.GetRequiredService<IConfiguration>();return new PrivateFileScanOptions(c["Files:ClamAvHost"],c.GetValue("Files:ClamAvPort",3310),c.GetValue("Files:ScanTimeoutSeconds",10));});builder.Services.AddSingleton<IPrivateFileScanner,ClamAvPrivateFileScanner>();
        builder.Services.AddSingleton<IPrivateFileStore>(s=>{
            var c=s.GetRequiredService<IConfiguration>();var env=s.GetRequiredService<IHostEnvironment>();var mode=c["Files:Storage"]??"Disabled";
            if(mode=="Disabled")return new DisabledPrivateFileStore();
            if(mode=="Filesystem"){
                if(!env.IsDevelopment())throw new InvalidOperationException("Filesystem private documents are unavailable outside Development.");var directory=c["Files:Directory"]??throw new InvalidOperationException("Files__Directory is required.");
                var root=Path.GetFullPath(directory);var web=s.GetRequiredService<IWebHostEnvironment>();var webroot=Path.GetFullPath(web.WebRootPath??Path.Combine(web.ContentRootPath,"wwwroot"));if(root==webroot||root.StartsWith(webroot+Path.DirectorySeparatorChar,StringComparison.Ordinal))throw new InvalidOperationException("Private documents cannot be stored inside the public web root.");return new DevelopmentPrivateFileStore(root,true);
            }
            if(mode!="S3")throw new InvalidOperationException("Files__Storage must be Disabled, Filesystem or S3.");
            var endpoint=c["Files:S3:Endpoint"];var bucket=c["Files:S3:Bucket"];var region=c["Files:S3:Region"]??"us-east-1";var key=c["Files:S3:AccessKey"];var secret=c["Files:S3:SecretKey"];
            if(!Uri.TryCreate(endpoint,UriKind.Absolute,out var uri)||uri.UserInfo.Length>0||uri.Query.Length>0||uri.Fragment.Length>0||uri.AbsolutePath!="/"||uri.Scheme!="https"&&!(env.IsDevelopment()&&uri.Scheme=="http"&&uri.IsLoopback)||string.IsNullOrWhiteSpace(bucket)||!System.Text.RegularExpressions.Regex.IsMatch(bucket,"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")||string.IsNullOrWhiteSpace(region)||string.IsNullOrWhiteSpace(key)||string.IsNullOrWhiteSpace(secret))throw new InvalidOperationException("Configure private S3 endpoint, bucket, region and credentials; Production requires HTTPS.");
            return new S3PrivateFileStore(new AmazonS3Client(new BasicAWSCredentials(key,secret),new AmazonS3Config{ServiceURL=endpoint,ForcePathStyle=true,AuthenticationRegion=region}),bucket,true);
        });
    }
}
