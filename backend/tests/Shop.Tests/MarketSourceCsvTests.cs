using System.Text;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class MarketSourceCsvTests
{
    private static string Csv(params string[] rows)=>"\uFEFF"+string.Join(',',MarketSourceCsv.Columns)+"\r\n"+string.Join("\r\n",rows);
    private static string Row(string name="منبع نمونه")=>string.Join(',',new[]{"listing-sample","","manual","item-sample","Published",MarketCsv.Escape(name),"Sample source","","unknown","","","","true"});
    [Fact] public void ExtraSourceTemplatePreservesEmptyIdentityAndQuotedUnicodeWithoutModelFields()
    {
        var table=MarketSourceCsv.Parse(Csv(Row("منبع، \"نمونه\"\nدوم")));var row=Assert.Single(table.Rows);Assert.Equal(2,row.Number);Assert.Equal("",row.Cells["source_id"]);Assert.Equal("منبع، \"نمونه\"\nدوم",row.Cells["source_name_fa"]);Assert.DoesNotContain("model_id",table.Headers);Assert.DoesNotContain("image_urls",table.Headers);Assert.Equal(13,table.Headers.Length);
    }
    [Theory]
    [InlineData("stock")]
    [InlineData("sku")]
    [InlineData("model_id")]
    [InlineData("attr.ram.option_id")]
    [InlineData("listing_id")]
    public void CatalogueStockAttributesAndDuplicateHeadersCannotEnterTheReportTemplate(string extra)
    {
        var csv=string.Join(',',MarketSourceCsv.Columns)+","+extra+"\n"+Row()+",untrusted";Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(csv));
    }
    [Fact] public void MissingRequiredSnapshotColumnOrInvalidUtf8ReplacementIsRejected()
    {
        Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(string.Join(',',MarketSourceCsv.Columns.Skip(1))+"\n"+Row()));Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(Csv(Row("bad\uFFFDtext"))));Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(Csv(Row("bad\0text")))) ;
    }
    [Fact] public void WholeFileAndRowBoundsApplyBeforeAnyDatabaseUse()
    {
        Assert.Equal(50,MarketSourceCsv.Parse(Csv(Enumerable.Repeat(Row(),50).ToArray())).Rows.Length);Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(Csv(Enumerable.Repeat(Row(),51).ToArray())));Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(Csv(Row(new string('x',8001)))));Assert.Throws<BusinessException>(()=>MarketSourceCsv.Parse(Csv(Enumerable.Repeat(Row(new string('x',8000)),18).ToArray())));Assert.True(Encoding.UTF8.GetByteCount(Csv(Row()))<MarketCsv.MaxBytes);
    }
}
