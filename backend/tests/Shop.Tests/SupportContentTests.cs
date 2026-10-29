using System.Text.Json.Nodes;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class SupportContentTests
{
    public static JsonObject Content() => new() { ["schemaVersion"]=1,["isDemo"]=true,["eyebrow"]="راهنمای نمونه",["title"]="پشتیبانی نمونه",["description"]="توضیح نمونه؛ سیاست تجاری نیست",["ticketsAction"]="ثبت درخواست",["faqTitle"]="پرسش‌ها",["faqDescription"]="",["faqs"]=new JsonArray(new JsonObject{["id"]=new string('a',32),["question"]="پرسش نمونه؟",["answer"]="<b>متن ساده</b>\nخط دوم",["enabled"]=true}) };
    [Fact]public void BoundedTypedContentRetainsPlainTextAndBothLocalesAreIndependent()
    {
        var content=Content();var value=SupportContentRules.Read(content);Assert.True(value.IsDemo);Assert.Equal("<b>متن ساده</b>\nخط دوم",Assert.Single(value.Faqs).Answer);ContentService.Validate("support","fa",content);ContentService.Validate("support","en",content);Assert.Throws<BusinessException>(()=>ContentService.Validate("support","de",content));
    }
    [Theory][InlineData("ownerId")][InlineData("publishedBy")][InlineData("redirectUrl")][InlineData("Title")]
    public void UnknownFieldsCannotBeSilentlyAccepted(string field){var content=Content();content[field]="unexpected";Assert.Equal("invalid_support_content",Assert.Throws<BusinessException>(()=>SupportContentRules.Read(content)).Code);}
    [Fact]public void IdentifiersFlagsAndSchemaVersionMustHaveTheirActualTypes()
    {
        foreach(var mutate in new Action<JsonObject>[] { x=>x["schemaVersion"]="1",x=>x["isDemo"]="true",x=>x["faqs"]![0]!["enabled"]="true",x=>x["faqs"]![0]!["id"]=new string('0',32),x=>x["faqs"]![0]!["id"]=Guid.NewGuid().ToString(),x=>x["faqs"]!.AsArray().Add(x["faqs"]![0]!.DeepClone()),x=>x["title"]=null }){var content=Content();mutate(content);Assert.Throws<BusinessException>(()=>SupportContentRules.Read(content));}
    }
    [Theory][InlineData("\u202eprivate")][InlineData("\u0000")][InlineData(" leading")][InlineData("trailing ")]
    public void InvisibleControlsAndUntrimmedBusinessCopyAreRejected(string answer){var content=Content();content["faqs"]![0]!["answer"]=answer;Assert.Throws<BusinessException>(()=>SupportContentRules.Read(content));}
    [Fact]public void EmptyFaqIsAllowedButLargeArraysAndDocumentsAreRejected()
    {
        var empty=Content();empty["faqs"]=new JsonArray();Assert.Empty(SupportContentRules.Read(empty).Faqs);
        var many=Content();var rows=new JsonArray();for(var n=0;n<31;n++)rows.Add(new JsonObject{["id"]=Guid.NewGuid().ToString("N"),["question"]="Question?",["answer"]="Answer",["enabled"]=true});many["faqs"]=rows;Assert.Throws<BusinessException>(()=>SupportContentRules.Read(many));
        rows.RemoveAt(30);foreach(var row in rows)row!["answer"]=new string('a',4000);Assert.Throws<BusinessException>(()=>SupportContentRules.Read(many));
    }
}
