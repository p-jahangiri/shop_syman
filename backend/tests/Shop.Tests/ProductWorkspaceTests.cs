using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;

public sealed class ProductWorkspaceTests
{
    [Theory]
    [InlineData("../../file.mp4")]
    [InlineData("http://example.test/clip.mp4")]
    [InlineData("https://user:secret@example.test/clip.mp4")]
    [InlineData("https://example.test/clip.mp4#fragment")]
    [InlineData("https://example.test/page")]
    [InlineData("/media/videos/../clip.mp4")]
    [InlineData("https://localhost/clip.mp4")]
    public void VideoLinksMustBeIssuedOrDirectHttps(string url) => Assert.False(PublicVideoPaths.ValidUrl(url));
    [Theory]
    [InlineData("https://example.test/clip.mp4?version=1")]
    [InlineData("https://cdn.example.test/clip.webm")]
    [InlineData("/media/videos/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/clip.mp4")]
    public void ValidVideoLinksDoNotNeedServerFetching(string url) => Assert.True(PublicVideoPaths.ValidUrl(url));
    [Fact]
    public void WorkspaceFiltersAreBoundedAndNormalizePersianText()
    {
        var filter = ProductWorkspaceFilter.Create(" گوشی ي۱۲۸ ", sort: "price", direction: "asc", pageSize: 100);
        Assert.Equal("گوشی ی128", filter.Search);
        Assert.False(filter.Descending);
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(pageSize: 500));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(sort: ";DROP TABLE"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create("a b c d e f g h i"));
    }
    [Fact]
    public void ColumnFilterRejectsReversedInvalidAndOverflowingBounds()
    {
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(minPriceRial: "21", maxPriceRial: "20"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(minStock: "-1"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(maxVariants: "2147483648"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(updatedFrom: "2026-02-29T00:00:00.000Z"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(updatedFrom: "2026-01-01T00:00:00.000Z", updatedBefore: "2026-01-01T00:00:00.000Z"));
        var filter = ProductWorkspaceFilter.Create(minPriceRial: "9007199254740993", maxStock: "0", name: "ي۱۲۸");
        Assert.Equal(9007199254740993L, filter.MinPriceRial);
        Assert.Equal(0L, filter.MaxStock);
        Assert.Equal("ی128", filter.Name);
    }
    [Fact]
    public void MultiSelectRejectsDuplicateMalformedAndOverlongLists()
    {
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(categoryIds: "a,A"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(brandIds: "a,,b"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(brandIds: "a,b b"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(statuses: "all,Hidden"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(categoryIds: string.Join(',', Enumerable.Range(0, 33))));
        Assert.Throws<BusinessException>(() => ProductWorkspaceFilter.Create(categoryIds: new string('x', 65)));
    }
    [Fact]
    public void FormFieldsCannotHideEssentialControlsOrAcceptUnknownKeys()
    {
        var fields = ProductFormFieldRules.Defaults().Select(f => new ProductFormFieldInput(f.Key, f.Label, f.Help, f.Visible, f.SortOrder)).ToArray();
        ProductFormFieldRules.Validate(fields);
        Assert.Throws<BusinessException>(() => ProductFormFieldRules.Validate(fields.Select(f => f.Key == "price" ? f with { Visible = false } : f).ToArray()));
        Assert.Throws<BusinessException>(() => ProductFormFieldRules.Validate(fields.Select(f => f.Key == "color" ? f with { Key = "adminPassword" } : f).ToArray()));
    }
    [Fact]
    public void ExactRialAndDiscountBoundsDoNotUseFloatingPoint()
    {
        ProductWorkspaceRules.Price(long.MaxValue.ToString(), null);
        Assert.Throws<BusinessException>(() => ProductWorkspaceRules.Price("100", "99"));
        Assert.Throws<BusinessException>(() => ProductWorkspaceRules.Price("9223372036854775808", null));
        Assert.Throws<BusinessException>(() => ProductWorkspaceRules.Price("1.2", null));
    }
    [Fact]
    public async Task VideoReadNeverAcceptsOversizedOrTruncatedObjects()
    {
        await Assert.ThrowsAsync<BusinessException>(() => BoundedVideoRead.ReadAsync(new MemoryStream(new byte[12]), 13, CancellationToken.None));
        await Assert.ThrowsAsync<BusinessException>(() => BoundedVideoRead.ReadAsync(new MemoryStream(new byte[14]), 13, CancellationToken.None));
    }
    private static string Fixture(string name)
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
            for (var p = new DirectoryInfo(start); p is not null; p = p.Parent)
            {
                var file = Path.Combine(p.FullName, "backend/tests/fixtures/catalog-video", name);
                if (File.Exists(file))
                    return file;
                var containerFile = Path.Combine(p.FullName, "tests/fixtures/catalog-video", name);
                if (File.Exists(containerFile))
                    return containerFile;
            }
        throw new InvalidOperationException("Video fixture is missing.");
    }
    [Theory]
    [InlineData("mp4", "video/mp4")]
    [InlineData("webm", "video/webm")]
    public async Task RealFfmpegPreservesSupportedVideoAndStripsInputMetadata(string extension, string mime)
    {
        var path = Fixture("valid." + extension);
        var input = await File.ReadAllBytesAsync(path);
        Assert.Equal(extension, VideoLimits.Extension(input, path, mime));
        var tools = new VideoToolOptions(OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg", OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
        var sanitizer = new FfmpegVideoSanitizer(tools);
        Assert.True(sanitizer.Configured, "Install FFmpeg/ffprobe for real video acceptance.");
        var clean = await sanitizer.SanitizeAsync(input, extension, CancellationToken.None);
        Assert.Equal(320, clean.Width);
        Assert.Equal(180, clean.Height);
        Assert.InRange(clean.DurationMilliseconds, 990, 1050);
        Assert.DoesNotContain("PrivateFixtureMetadata", System.Text.Encoding.UTF8.GetString(clean.Bytes));
        Assert.Equal(extension, clean.Extension);
        Assert.Equal(64, clean.Sha256.Length);
    }
    [Fact]
    public async Task WrongMagicAndTruncatedVideoAreRejected()
    {
        var bytes = await File.ReadAllBytesAsync(Fixture("valid.mp4"));
        Assert.Throws<BusinessException>(() => VideoLimits.Extension(bytes, "image.webm", "video/webm"));
        Assert.Throws<BusinessException>(() => VideoLimits.Extension(new byte[64], "file.mp4", "video/mp4"));
        var tools = new VideoToolOptions(OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg", OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
        await Assert.ThrowsAsync<BusinessException>(() => new FfmpegVideoSanitizer(tools).SanitizeAsync(bytes[..64], "mp4", CancellationToken.None));
    }
    [Fact]
    public async Task ConcurrentVideoReadsAreBoundedAndReleaseTheirSlot()
    {
        var slots = new VideoDownloadSlots();
        var leases = new List<IDisposable>();
        for (var i = 0; i < 4; i++)
            leases.Add(Assert.IsAssignableFrom<IDisposable>(await slots.TryEnterAsync(CancellationToken.None)));
        Assert.Null(await slots.TryEnterAsync(CancellationToken.None));
        leases[0].Dispose();
        using var next = Assert.IsAssignableFrom<IDisposable>(await slots.TryEnterAsync(CancellationToken.None));
        foreach (var lease in leases)
            lease.Dispose();
    }
}
