using System.Text.Json.Nodes;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public class SpotlightTests
{
    private static JsonObject Site(JsonObject block) => new() {
        ["name"]="Sample",["latinName"]="Sample",["tagline"]="Sample",["announcement"]="Sample",["about"]="Sample",["chequeDisclaimer"]="Sample",
        ["hero"]=new JsonObject{["eyebrow"]="Sample",["title"]="Sample",["description"]="Sample",["action"]="Sample",["secondary"]="Sample"},
        ["nav"]=new JsonArray(),["homeBlocks"]=new JsonArray(block)
    };
    [Theory]
    [InlineData("{\"id\":\"m\",\"kind\":\"spotlight\",\"enabled\":true,\"title\":\"Sample\",\"productIds\":[]}")]
    [InlineData("{\"id\":\"m\",\"kind\":\"spotlight\",\"enabled\":true,\"title\":\" \",\"productIds\":[\"p1\"]}")]
    [InlineData("{\"id\":\"m\",\"kind\":\"spotlight\",\"enabled\":true,\"title\":\"Sample\",\"productIds\":[\"p1\",\"p1\"]}")]
    public void EnabledSpotlightRejectsAmbiguousMembership(string json) => Assert.Throws<BusinessException>(()=>ContentService.Validate("site","fa",Site(JsonNode.Parse(json)!.AsObject())));
    [Fact] public void BothLanguagesAcceptExplicitSelectionAndIncompleteDisabledDraft()
    {
        foreach(var locale in new[]{"fa","en"}){
            ContentService.Validate("site",locale,Site(new(){["id"]="m",["kind"]="spotlight",["enabled"]=true,["title"]="Sample picks",["productIds"]=new JsonArray("p2","p1"),["startsAt"]="2026-10-23T00:00:00Z",["endsAt"]="2026-10-24T00:00:00Z"}));
            ContentService.Validate("site",locale,Site(new(){["id"]="m",["kind"]="spotlight",["enabled"]=false}));
        }
    }
}
