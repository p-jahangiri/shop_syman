using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
namespace Shop.UiHarness;
internal static class UsedItemHarnessSeed
{
    internal static async Task RunAsync(IServiceProvider services,string database,string directory)
    {
        if(!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database)throw new InvalidOperationException("Fresh owned Development used-device QA required.");
        var db=services.GetRequiredService<CatalogDbContext>();var stock=services.GetRequiredService<InventoryDbContext>();if(await db.Set<UsedItemInspection>().AnyAsync()||await db.Set<UsedItemCommand>().AnyAsync()||await stock.Stock.AnyAsync(s=>s.IsSingleUnit))throw new InvalidOperationException("Used-device QA needs an empty inspection baseline.");
        var product=await db.Products.Include(p=>p.Variants).SingleAsync(p=>p.Id=="p1");var original=product.Variants.First();var key=Guid.NewGuid().ToString("N");
        ProductVariant Make(string suffix,int price)=>new(){Id=key+suffix,ProductId=product.Id,Sku="USED-QA-"+suffix+"-"+key,IsActive=true,PriceRial=price,LabelFa="دستگاه کارکردهٔ نمونه "+suffix,LabelEn="Sample used unit "+suffix,Color="#31433b",ColorNameFa="سبز",ColorNameEn="Green",WarrantyFa="توضیح نمونهٔ گارانتی",WarrantyEn="Sample warranty note"};
        var inspected=Make("a",689000001);var unknown=Make("b",589000009);db.Variants.AddRange(inspected,unknown);await db.SaveChangesAsync();stock.Stock.AddRange(new StockItem{VariantId=inspected.Id,OnHand=1},new StockItem{VariantId=unknown.Id,OnHand=1});await stock.SaveChangesAsync();
        await UiHarnessProgram.WritePrivate(Path.Combine(directory,"used-items.json"),new{Database=database,SyntheticQaOnly=true,ProductId=product.Id,product.Slug,InspectedVariantId=inspected.Id,UnknownVariantId=unknown.Id,InspectedSku=inspected.Sku,UnknownSku=unknown.Sku,OriginalVariantId=original.Id,OriginalStock=await stock.Stock.Where(s=>s.VariantId==original.Id).Select(s=>s.OnHand).SingleAsync(),InspectionRows=0});
    }
}
