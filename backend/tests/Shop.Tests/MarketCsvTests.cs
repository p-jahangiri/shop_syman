using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class MarketCsvTests
{
    private static string Csv(string name="Sample",string extraHeader="",string extraValue="")=>string.Join(',',MarketCsv.Columns)+extraHeader+"\r\n"+string.Join(',',MarketCsv.Columns.Select(h=>MarketCsv.Escape(h switch{"source_key"=>"manual","source_item_key"=>"sample-1","status"=>"Draft","source_name_fa"=>"نمونه","source_name_en"=>"Sample","availability"=>"unknown","is_demo"=>"true","category_id"=>"phones","brand_id"=>"samsung","slug"=>"sample-phone","name_fa"=>"نمونه","name_en"=>name,"image_urls"=>"/products/phone-green.svg",_=>""})))+extraValue;
    [Fact] public void QuotedCommasNewlinesAndEscapedQuotesStayInOneLogicalRecord()
    {
        const string value="A, B\r\nA \"quoted\" phone";var table=MarketCsv.Parse("\uFEFF"+Csv(value));Assert.Single(table.Rows);Assert.Equal(value,table.Rows[0].Cells["name_en"]);Assert.Equal(2,table.Rows[0].Number);
    }
    [Theory]
    [InlineData("\"unfinished")][InlineData("\"closed\"x")][InlineData("unquoted\"quote")]
    public void InvalidQuoteStructureIsRejected(string body)=>Assert.Throws<BusinessException>(()=>MarketCsv.Parse(string.Join(',',MarketCsv.Columns)+"\n"+body));
    [Fact] public void UnknownDuplicateAndMissingHeadersAreRejected()
    {
        foreach(var csv in new[]{Csv(extraHeader:",stock",extraValue:",1"),Csv(extraHeader:",NAME_FA",extraValue:",x"),Csv().Replace("source_item_key,",""),Csv()+",wrong-count"})Assert.Throws<BusinessException>(()=>MarketCsv.Parse(csv));
    }
    [Fact] public void FileRowsColumnsAndCellsAreBounded()
    {
        Assert.Throws<BusinessException>(()=>MarketCsv.Parse(new string('a',MarketCsv.MaxBytes+1)));
        Assert.Throws<BusinessException>(()=>MarketCsv.Parse(Csv(new string('a',8001))));
        var csv=Csv();var row=csv[(csv.IndexOf('\n')+1)..];Assert.Throws<BusinessException>(()=>MarketCsv.Parse(string.Join(',',MarketCsv.Columns)+"\n"+string.Join('\n',Enumerable.Repeat(row,51))));
        Assert.Throws<BusinessException>(()=>MarketCsv.Parse(Csv()+"\0"));Assert.Throws<BusinessException>(()=>MarketCsv.Parse(Csv()+"\uFFFD"));
    }
    [Fact] public void TypedDynamicColumnsAndFalseZeroArePreserved()
    {
        var table=MarketCsv.Parse(Csv(extraHeader:",attr.nfc.bool,attr.weight.number,attr.storage.clear",extraValue:",false,۰,true"));Assert.Equal("false",table.Rows[0].Cells["attr.nfc.bool"]);Assert.False(MarketCsv.Boolean("false"));Assert.Equal(0m,MarketCsv.Number("۰"));Assert.Equal(12.5m,MarketCsv.Number("۱۲٫۵"));Assert.Equal("123456",MarketCsv.Digits("۱۲٣٤۵۶"));Assert.Equal(("storage","clear"),MarketCsv.Attribute("attr.storage.clear"));Assert.Null(MarketCsv.Attribute("attr.storage.script"));
    }
    [Theory]
    [InlineData("1e3")][InlineData("1,000")][InlineData("NaN")]
    public void AttributeNumbersRejectExponentsAndGrouping(string number)=>Assert.Throws<BusinessException>(()=>MarketCsv.Number(number));
    [Fact] public void DatesRequireTimezoneAndNormalizeToUtc()
    {
        Assert.Null(MarketCsv.Date(""));Assert.Equal(DateTimeOffset.Parse("2026-10-23T08:30:00Z"),MarketCsv.Date("2026-10-23T12:00:00+03:30"));Assert.Throws<BusinessException>(()=>MarketCsv.Date("2026-10-23T12:00:00"));Assert.Throws<BusinessException>(()=>MarketCsv.Date("10/23/2026"));
    }
}
