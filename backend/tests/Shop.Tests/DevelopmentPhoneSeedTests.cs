using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Shop.Tests;

public sealed class DevelopmentPhoneSeedTests
{
    [Fact]public async Task ProductionRejectsThePhoneSeedBeforeResolvingServicesOrReadingFiles()
    {
        var error=await Assert.ThrowsAsync<InvalidOperationException>(()=>DevelopmentPhoneDiscoverySeed.RunAsync(new RejectServices(),new Production(),"/missing-reviewed-dataset",default));
        Assert.Contains("outside Development",error.Message,StringComparison.Ordinal);
    }
    [Fact]public async Task AnUnreviewedDatasetIsRejectedBeforeResolvingAnyDatabaseServices()
    {
        var root=Path.Combine(Path.GetTempPath(),"SaymanPhoneSeedUnit_"+Guid.NewGuid().ToString("N"));var path=Path.Combine(root,DevelopmentPhoneDiscoverySeed.DatasetRelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        try{
            await File.WriteAllTextAsync(path,"{}");
            var error=await Assert.ThrowsAsync<InvalidOperationException>(()=>DevelopmentPhoneDiscoverySeed.RunAsync(new RejectServices(),new Production{EnvironmentName="Development"},root,default));
            Assert.Contains("reviewed version and hash",error.Message,StringComparison.Ordinal);
        }finally{Directory.Delete(root,true);}
    }
    private sealed class RejectServices:IServiceProvider{public object? GetService(Type type)=>throw new Xunit.Sdk.XunitException("Production seed attempted to resolve "+type.Name);}
    private sealed class Production:IHostEnvironment
    {
        public string EnvironmentName{get;set;}="Production";
        public string ApplicationName{get;set;}="Shop.Api";
        public string ContentRootPath{get;set;}="";
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
    }
}
