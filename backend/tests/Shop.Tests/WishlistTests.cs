using System.Text.Json;
using Shop.Modules.Sales;
using Xunit;
namespace Shop.Tests;
public sealed class WishlistTests
{
    [Fact]public void ProductSelectionRejectsDuplicatesUnknownShapesAndExcessCapacity()
    {
        Assert.Throws<Shop.SharedKernel.BusinessException>(()=>WishlistRules.Products(["Phone","phone"]));Assert.Throws<Shop.SharedKernel.BusinessException>(()=>WishlistRules.Products(["../private"]));Assert.Throws<Shop.SharedKernel.BusinessException>(()=>WishlistRules.Products(Enumerable.Range(0,201).Select(i=>"p"+i).ToArray()));Assert.Equal(new[]{"a","z"},WishlistRules.Products(["Z","a"]));
    }
    [Fact]public void VersionRequiresCanonicalEightByteSqlTokenAndEmptyIsExplicitNull()
    {
        WishlistRules.Version(null);WishlistRules.Version("AAAAAAAAAAE=");Assert.Throws<Shop.SharedKernel.BusinessException>(()=>WishlistRules.Version("AAAAAAAAAAF="));Assert.Throws<Shop.SharedKernel.BusinessException>(()=>WishlistRules.Version(""));var json=JsonSerializer.Serialize(new WishlistData(1,"OWNER",200,null,[]),new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull});Assert.Contains("\"version\":null",json);
    }
}
