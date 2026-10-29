using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Cms;
using Xunit;

namespace Shop.SqlTests;
public sealed class DevelopmentCollectionSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private sealed class ProductionEnvironment:IHostEnvironment
    {
        public string EnvironmentName {get;set;}="Production";
        public string ApplicationName {get;set;}="Shop.Api";
        public string ContentRootPath {get;set;}="";
        public IFileProvider ContentRootFileProvider {get;set;}=new NullFileProvider();
    }
    [Fact] public async Task SampleInsertionRejectsProductionAndUnpublishedDraftAndIsAtomicAndIdempotent()
    {
        var environment=fixture.Factory.Services.GetRequiredService<IWebHostEnvironment>();
        await Assert.ThrowsAsync<InvalidOperationException>(()=>DevelopmentSeed.AddMomentsAsync(fixture.Factory.Services,new ProductionEnvironment(),environment.ContentRootPath,CancellationToken.None));
        await using(var setup=fixture.Factory.Services.CreateAsyncScope()){
            var db=setup.ServiceProvider.GetRequiredService<CmsDbContext>();
            foreach(var doc in await db.Documents.Where(d=>d.Key=="site").ToListAsync()){
                var site=JsonNode.Parse(doc.PublishedJson!)!.AsObject();var blocks=site["homeBlocks"]!.AsArray();
                foreach(var block in blocks.Where(b=>b?["kind"]?.ToString()=="spotlight").ToArray())blocks.Remove(block);
                var nav=site["nav"]!.AsArray();foreach(var item in nav.Where(n=>n?["href"]?.ToString()=="/moments").ToArray())nav.Remove(item);
                doc.PublishedJson=site.ToJsonString();doc.DraftJson=doc.PublishedJson;
                if(doc.Locale=="en"){site["announcement"]="Unpublished operator draft";doc.DraftJson=site.ToJsonString();}
            }
            await db.SaveChangesAsync();
        }
        await using(var attempt=fixture.Factory.Services.CreateAsyncScope())
            await Assert.ThrowsAsync<InvalidOperationException>(()=>DevelopmentSeed.AddMomentsAsync(attempt.ServiceProvider,environment,environment.ContentRootPath,CancellationToken.None));
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){
            var db=check.ServiceProvider.GetRequiredService<CmsDbContext>();
            foreach(var doc in await db.Documents.Where(d=>d.Key=="site").ToListAsync()){
                Assert.DoesNotContain(JsonNode.Parse(doc.PublishedJson!)!["homeBlocks"]!.AsArray(),b=>b?["kind"]?.ToString()=="spotlight");
                Assert.Equal(1,doc.Revision);
                if(doc.Locale=="en"){Assert.Equal("Unpublished operator draft",JsonNode.Parse(doc.DraftJson)!["announcement"]!.GetValue<string>());doc.DraftJson=doc.PublishedJson!;}
            }
            await db.SaveChangesAsync();
        }
        await using(var apply=fixture.Factory.Services.CreateAsyncScope())
            await DevelopmentSeed.AddMomentsAsync(apply.ServiceProvider,environment,environment.ContentRootPath,CancellationToken.None);
        Dictionary<string,(string Json,int Revision,string Version)> before;
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){
            var docs=await check.ServiceProvider.GetRequiredService<CmsDbContext>().Documents.AsNoTracking().Where(d=>d.Key=="site").ToListAsync();
            Assert.Equal(2,docs.Count);foreach(var doc in docs){Assert.Equal(2,doc.Revision);Assert.Equal(doc.DraftJson,doc.PublishedJson);Assert.Single(JsonNode.Parse(doc.PublishedJson!)!["homeBlocks"]!.AsArray(),b=>b?["kind"]?.ToString()=="spotlight");}
            before=docs.ToDictionary(d=>d.Locale,d=>(d.PublishedJson!,d.Revision,Convert.ToBase64String(d.Version)));
        }
        await using(var repeat=fixture.Factory.Services.CreateAsyncScope())
            await DevelopmentSeed.AddMomentsAsync(repeat.ServiceProvider,environment,environment.ContentRootPath,CancellationToken.None);
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){
            foreach(var doc in await check.ServiceProvider.GetRequiredService<CmsDbContext>().Documents.AsNoTracking().Where(d=>d.Key=="site").ToListAsync())
                Assert.Equal(before[doc.Locale],(doc.PublishedJson!,doc.Revision,Convert.ToBase64String(doc.Version)));
        }
    }
}
