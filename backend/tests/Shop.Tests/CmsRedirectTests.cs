using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CmsRedirectTests
{
    [Theory][InlineData("/fa/pages/about", "/fa/catalog")][InlineData("/en/product/old-phone", "/en/product/new-phone")][InlineData("/en/pages/about", "/en")]
    public void PublicPathsAndExplicitStatusesAreSupported(string source,string target){CmsRedirectRules.Draft(source,target,301);CmsRedirectRules.Draft(source,target,302);CmsRedirectRules.Draft(source,null,null);}
    [Theory][InlineData("/fa/pages/a\n")][InlineData("/fa/account/a")][InlineData("//evil.test")][InlineData("/FA/pages/a")][InlineData("/fa/pages/a?x=1")][InlineData("/fa/pages/%61")][InlineData("/fa/pages/a/")][InlineData("/fa/product/a#x")]
    public void SourceRejectsPrivateAmbiguousOrUnboundedPaths(string source)=>Assert.Throws<BusinessException>(()=>CmsRedirectRules.Source(source));
    [Theory][InlineData("/en/catalog")][InlineData("/fa/pages/a")][InlineData("/fa/support\n")][InlineData("https://evil.test")][InlineData("/fa/cart")][InlineData("/fa/catalog?category=phone")][InlineData("/fa/product/%61")]
    public void TargetMustBeAnotherPublicPathInTheSameLocale(string target)=>Assert.Throws<BusinessException>(()=>CmsRedirectRules.Target("/fa/pages/a",target));
    [Fact]public void DraftNeverInventsStatusAndOperationsDoNotDefaultToPublication()
    {
        CmsRedirectRules.Input(new("Create",SourcePath:"/fa/pages/a",IsDemo:true),true);var v=Convert.ToBase64String(new byte[8]);CmsRedirectRules.Input(new("Save",v),false);CmsRedirectRules.Input(new("Publish",v,Confirmed:true),false);
        foreach(var i in new[]{new CmsRedirectWrite("Create",SourcePath:"/fa/pages/a"),new("Create",SourcePath:"/fa/pages/a",IsDemo:true,Status:307),new("Publish",v),new("Restore",v,Confirmed:true),new("Save",v,SourcePath:"/fa/pages/new"),new("Publish",v,TargetPath:"/fa/catalog",Confirmed:true)})Assert.Throws<BusinessException>(()=>CmsRedirectRules.Input(i,i.Action=="Create"));
        Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CmsRedirectWrite>("{\"action\":\"Create\",\"status\":\"301\"}",CmsPageRules.Json));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CmsRedirectWrite>("{\"action\":\"Create\",\"paid\":true}",CmsPageRules.Json));
    }
    [Fact]public void GraphValidatesAncestorsCyclesAndFiveHopsWithoutFlattening()
    {
        var g=Enumerable.Range(0,5).ToDictionary(i=>"/fa/pages/a"+i,i=>"/fa/pages/a"+(i+1));Assert.Empty(CmsRedirectRules.Graph(g));g["/fa/pages/a5"]="/fa/catalog";Assert.Contains("chain_too_long",CmsRedirectRules.Graph(g));g.Remove("/fa/pages/a5");g["/fa/pages/a4"]="/fa/pages/a0";Assert.Contains("cycle",CmsRedirectRules.Graph(g));Assert.Equal(6,CmsRedirectRules.Chain("/fa/pages/a0",g).Count);
        var large=Enumerable.Range(0,10000).ToDictionary(i=>"/fa/pages/a"+i,i=>"/fa/pages/a"+(i+1));Assert.Equal(new[]{"chain_too_long"},CmsRedirectRules.Graph(large));large["/fa/pages/a9999"]="/fa/pages/a0";Assert.Contains("cycle",CmsRedirectRules.Graph(large));large["/fa/pages/overflow"]="/fa/catalog";Assert.Throws<BusinessException>(()=>CmsRedirectRules.Graph(large));
    }
    [Fact]public void FactsBindStatusAndSourceAndHistoryIsImmutableBeforeSql()
    {
        Assert.NotEqual(CmsRedirectRules.FactsHash("/fa/pages/a","/fa/catalog",301),CmsRedirectRules.FactsHash("/fa/pages/a","/fa/catalog",302));using var db=new CmsDbContext(new DbContextOptionsBuilder<CmsDbContext>().UseSqlServer("Server=unused;Database=unused").Options);var c=new CmsRedirectCommand{ActorId="staff",CommandId=Guid.NewGuid().ToString("N"),RedirectId=Guid.NewGuid().ToString("N")};db.Attach(c);db.Remove(c);Assert.Equal("cms_redirect_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);
    }
}
