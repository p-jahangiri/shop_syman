using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Market;

namespace Shop.UiHarness;
internal static class MarketAttributeHarnessSeed
{
    internal static async Task RunAsync(IServiceProvider services,string database,string directory)
    {
        if(!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database||Environment.GetEnvironmentVariable("SHOP_UI_MARKET_ATTRIBUTES_QA")!="1"||Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN") is not null)throw new InvalidOperationException("Fresh owned Development typed market QA required.");
        var db=services.GetRequiredService<CatalogDbContext>();var market=services.GetRequiredService<MarketDbContext>();var prefix="ui"+Guid.NewGuid().ToString("N")[..16];var category=prefix+"c";string Attr(string key)=>prefix+"-"+key;
        var fields=new[]{("memory",AttributeDataType.Number,"حافظه عددی","Numeric storage"),("ram",AttributeDataType.Select,"حافظه رم نمونه","Sample RAM"),("5g",AttributeDataType.Bool,"پشتیبانی 5G نمونه","Sample 5G support"),("chip",AttributeDataType.Text,"پردازنده نمونه","Sample chipset"),("ports",AttributeDataType.MultiSelect,"ارتباط‌های نمونه","Sample connectivity"),("weight",AttributeDataType.Number,"وزن نمونه","Sample weight"),("os",AttributeDataType.Text,"سیستم عامل نمونه","Sample OS"),("wireless",AttributeDataType.Bool,"شارژ بی‌سیم نمونه","Sample wireless charging")};
        foreach(var (key,type,fa,en) in fields)db.AttributeDefinitions.Add(new(){Id=Attr(key),Key=Attr(key),DataType=type,Unit=key=="memory"?"GB":key=="weight"?"g":null,Translations=[new(){Locale="fa",Name=fa},new(){Locale="en",Name=en}],Options=type is AttributeDataType.Select or AttributeDataType.MultiSelect?Enumerable.Range(0,3).Select(i=>new AttributeOption{Id=Attr(key)+i,Value="sample-"+i,LabelFa=key=="ram"?new[]{"۸ گیگابایت نمونه","۱۶ گیگابایت نمونه","۳۲ گیگابایت نمونه"}[i]:new[]{"USB-C نمونه","Wi-Fi نمونه","Bluetooth نمونه"}[i],LabelEn=key=="ram"?new[]{"Sample 8 GB","Sample 16 GB","Sample 32 GB"}[i]:new[]{"Sample USB-C","Sample Wi-Fi","Sample Bluetooth"}[i],SortOrder=i}).ToList():[]});
        db.Categories.Add(new(){Id=category,Slug="sample-typed-market-"+prefix,Translations=[new(){Locale="fa",Name="مدل‌های تست ویژگی (نمونه)"},new(){Locale="en",Name="Attribute test models (sample)"}],Attributes=fields.Select(f=>new CategoryAttribute{AttributeId=Attr(f.Item1),IsFilterable=true}).ToList()});
        var ids=new List<string>();
        for(var i=0;i<4;i++){
            var id=prefix+i;ids.Add(id);var attributes=new List<ProductAttributeValue>{new(){AttributeId=Attr("memory"),ValueNumber=i is 0 or 3?99999999999999999999.12345678m:i==1?0:0.00000001m},new(){AttributeId=Attr("ram"),ValueOptionId=Attr("ram")+(i%2)},new(){AttributeId=Attr("chip"),ValueTextFa=i%2==0?"تراشه نمونه الف":"تراشه نمونه ب",ValueTextEn=i%2==0?"Sample chip A":"Sample chip B"},new(){AttributeId=Attr("ports"),Selections=i==3?[new(){OptionId=Attr("ports")+0},new(){OptionId=Attr("ports")+1}]:[new(){OptionId=Attr("ports")+(i%2)}]},new(){AttributeId=Attr("weight"),ValueNumber=i==0?0:i},new(){AttributeId=Attr("os"),ValueTextFa="سیستم نمونه",ValueTextEn="Sample system"},new(){AttributeId=Attr("wireless"),ValueBool=i%2==0}};
            if(i!=2)attributes.Add(new(){AttributeId=Attr("5g"),ValueBool=i==1});
            db.Products.Add(new(){Id=id,Slug="sample-typed-"+id,CategoryId=category,BrandId=i==1?"apple":"samsung",Translations=[new(){Locale="fa",Name="مدل نمونه ویژگی "+(char)('A'+i),Description="این مدل و مشخصات فقط نمونهٔ QA هستند؛ موجودی یا مشخصات واقعی بازار نیستند."},new(){Locale="en",Name="Sample attribute model "+(char)('A'+i),Description="Synthetic QA model and specifications; no real market availability."}],Attributes=attributes,Media=[new(){Url="/products/phone-green.svg"}]});
            market.Listings.Add(new(){Id=id,ModelId=id,Status="Published",SourceKey="qa-typed-ui",SourceItemKey=id,SourceNameFa="نمونهٔ آزمون رابط",SourceNameEn="Synthetic UI samples",IsDemo=true});
        }
        await db.SaveChangesAsync();await market.SaveChangesAsync();
        await UiHarnessProgram.WritePrivate(Path.Combine(directory,"market-attributes.json"),new{Database=database,SyntheticQaOnly=true,CategoryId=category,ModelIds=ids,AttributeKeys=fields.ToDictionary(f=>f.Item1,f=>Attr(f.Item1)),FilterCount=8,StockChanged=false,FinancialPoliciesConfigured=false});
    }
}
