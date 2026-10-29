using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class PublicImageUrlRulesTests
{
    [Theory]
    [InlineData("/products/phone.svg")]
    [InlineData("/products/phones/phone_Black-1.jpeg")]
    [InlineData("/products/laptop.avif")]
    [InlineData("/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp")]
    [InlineData("https://images.example.test/products/phone.jpg?w=1280&fit=crop")]
    public void AcceptsOnlyBundledIssuedOrCredentialFreeHttpsImages(string value)
        => Assert.True(PublicImageUrlRules.IsValid(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/products/not-an-image.html")]
    [InlineData("/products/phone.svg?script=1")]
    [InlineData("/products/phone.svg#image")]
    [InlineData("/products/../phone.png")]
    [InlineData("/products//phone.png")]
    [InlineData("/products/phone..png")]
    [InlineData("/products/%70hone.png")]
    [InlineData("/products/phone.png\n")]
    [InlineData("/products/phone image.png")]
    [InlineData("/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp\n")]
    [InlineData("/media/catalog/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/card.webp")]
    [InlineData("/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/original.png")]
    [InlineData("/media/not-issued.png")]
    [InlineData("//images.example.test/phone.png")]
    [InlineData("http://images.example.test/phone.png")]
    [InlineData("https://user:password@images.example.test/phone.png")]
    [InlineData("https://user@images.example.test/phone.png")]
    [InlineData("https://images.example.test/phone.png#image")]
    [InlineData("https://images.example.test/phone image.png")]
    [InlineData("https://images.example.test/phone.png\u007f")]
    [InlineData("https:\\images.example.test\\phone.png")]
    public void RejectsCredentialUrlsMalformedLocalPathsAndUnusablePreviewValues(string? value)
        => Assert.False(PublicImageUrlRules.IsValid(value));

    [Fact]
    public void RejectsOverlongUrlsBeforeUriParsing()
        => Assert.False(PublicImageUrlRules.IsValid("https://images.example.test/" + new string('a', 1500)));
}
