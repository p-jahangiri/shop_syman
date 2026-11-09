using System.Text.Json.Nodes;
using System.Xml.Linq;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class ShoppingContentTests
{
    [Fact]
    public void ProductHelpRejectsSelfLinksAndDoesNotPublishDevelopmentExamplesInProduction()
    {
        var key = ProductHelpRules.Key("p1");
        var input = JsonNode.Parse("""
          {"accessoriesEnabled":true,"accessoryIds":["p12"],"questions":[{"question":"Which cable?","answer":"Check the port."}],"isDemo":true}
          """)!.AsObject();
        Assert.Equal("p12", Assert.Single(ProductHelpRules.Read(key, input).AccessoryIds));
        ProductHelpRules.RequireEnvironment(input, true);
        Assert.Throws<BusinessException>(() => ProductHelpRules.RequireEnvironment(input, false));
        input["accessoryIds"] = new JsonArray("P1");
        Assert.Throws<BusinessException>(() => ContentService.Validate(key, "fa", input));
        input["accessoryIds"] = new JsonArray("p12", "P12");
        Assert.Throws<BusinessException>(() => ContentService.Validate(key, "fa", input));
    }

    [Fact]
    public void AtomIncludesOnlyOfficialPhoneHeadlinesWithoutTrackingOrDuplicates()
    {
        var doc = XDocument.Parse("""
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry><title>iPhone update</title><link href="https://www.apple.com/newsroom/2026/11/iphone/?ref=feed"/><published>2026-11-01T10:00:00Z</published></entry>
              <entry><title>iPhone update duplicate</title><link href="https://www.apple.com/newsroom/2026/11/iphone/"/><updated>2026-11-01T09:00:00Z</updated></entry>
              <entry><title>iOS external</title><link href="https://www.apple.com.example.invalid/newsroom/ios/"/><updated>2026-11-01T10:00:00Z</updated></entry>
              <entry><title>Mac update</title><link href="https://www.apple.com/newsroom/mac/"/><updated>2026-11-01T10:00:00Z</updated></entry>
            </feed>
            """);
        var item = Assert.Single(OfficialNewsFeed.Parse(doc));
        Assert.Equal("iPhone update", item.Title);
        Assert.Equal("https://www.apple.com/newsroom/2026/11/iphone/", item.Url);
    }
    [Fact]
    public void PersianFeedKeepsRelevantHeadlinesAndOnlyLinksBackToThePublisher()
    {
        var doc = XDocument.Parse("""
            <rss><channel>
              <item><title>راهنمای شارژ گوشی</title><link>https://www.zoomit.ir/mobile/example/?ref=rss</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0000</pubDate><description>متن دارای محدودیت بازنشر</description></item>
              <item><title>اخبار خودرو</title><link>https://www.zoomit.ir/car/example/</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0000</pubDate></item>
              <item><title>گوشی تازه</title><link>https://www.zoomit.ir.example.test/mobile/</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0000</pubDate></item>
            </channel></rss>
            """);
        var item = Assert.Single(OfficialNewsFeed.ParsePersian(doc, "www.zoomit.ir", "زومیت"));
        Assert.Equal("زومیت", item.Source);
        Assert.Equal("https://www.zoomit.ir/mobile/example/", item.Url);
        Assert.Null(item.Summary);
        Assert.Null(item.ImageUrl);
    }

    [Fact]
    public void MobileFeedUsesPlainTeasersAndOnlyPublisherThumbnailPaths()
    {
        var doc = XDocument.Parse("""
            <rss><channel>
              <item><title>بررسی یک مدل جدید</title><link>http://www.mobile.ir/news/view-1.aspx?ref=rss</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0000</pubDate>
                <description><![CDATA[<img src="//s.mobile.ir/Static/cache/newsthumbs/1.jpg?ref=feed"> واحد خبر mobile.ir : <b>مدل جدید</b> با یک ظرفیت دیگر معرفی شد.&nbsp; نوشته نسخهٔ آزمایشی]]></description>
              </item>
              <item><title>گوشی تازه</title><link>https://www.mobile.ir/news/view-2.aspx</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0000</pubDate>
                <description><![CDATA[<img src="https://s.mobile.ir.example.test/Static/cache/newsthumbs/2.jpg"> توضیح آزمایشی دربارهٔ مدل دوم گوشی.]]></description>
              </item>
            </channel></rss>
            """);
        var items = OfficialNewsFeed.ParsePersian(doc, "www.mobile.ir", "مرجع موبایل ایران");
        Assert.Equal(2, items.Count);
        Assert.Equal("https://www.mobile.ir/news/view-1.aspx", items[0].Url);
        Assert.Equal("مدل جدید با یک ظرفیت دیگر معرفی شد.", items[0].Summary);
        Assert.Equal("https://s.mobile.ir/Static/cache/newsthumbs/1.jpg", items[0].ImageUrl);
        Assert.Null(items[1].ImageUrl);
    }
}
