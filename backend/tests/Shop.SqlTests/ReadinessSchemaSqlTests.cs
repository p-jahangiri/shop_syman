using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Shop.SqlTests;

public sealed class ReadinessSchemaSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly string[] Schemas = ["identity", "payments", "credit", "cms", "inventory", "catalog", "sales", "market", "reviews", "support", "notifications", "files"];
    private const string FutureId = "20991231235959_OwnedReadinessQaOnly";
    private sealed record HistoryRow(string Id, string Version);

    private SqlConnection Connection()
    {
        var settings = new SqlConnectionStringBuilder(fixture.Connection);
        Assert.Matches(new Regex("^SaymanTest_[a-f0-9]{32}$"), settings.InitialCatalog);
        return new(settings.ConnectionString);
    }

    private static void Schema(string schema) => Assert.Contains(schema, Schemas);

    private async Task<HistoryRow[]> History(string schema)
    {
        Schema(schema);
        await using var sql = Connection();
        await sql.OpenAsync();
        await using var command = sql.CreateCommand();
        command.CommandText = $"SELECT [MigrationId],[ProductVersion] FROM [{schema}].[__EFMigrationsHistory] ORDER BY [MigrationId]";
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<HistoryRow>();
        while (await reader.ReadAsync()) rows.Add(new(reader.GetString(0), reader.GetString(1)));
        return rows.ToArray();
    }

    private async Task WriteHistory(string schema, HistoryRow row, bool insert)
    {
        Schema(schema);
        await using var sql = Connection();
        await sql.OpenAsync();
        await using var command = sql.CreateCommand();
        command.CommandText = insert
            ? $"INSERT [{schema}].[__EFMigrationsHistory] ([MigrationId],[ProductVersion]) VALUES (@id,@version)"
            : $"DELETE FROM [{schema}].[__EFMigrationsHistory] WHERE [MigrationId]=@id AND [ProductVersion]=@version";
        command.Parameters.AddWithValue("@id", row.Id);
        command.Parameters.AddWithValue("@version", row.Version);
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
    }

    private static async Task Probe(HttpClient client, string path, HttpStatusCode expected)
    {
        using var response = await client.GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(expected, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal("noindex, nofollow", Assert.Single(response.Headers.GetValues("X-Robots-Tag")));
        Assert.DoesNotContain("SaymanTest_", body);
        Assert.DoesNotContain("MigrationId", body);
    }

    [Theory]
    [InlineData("identity")][InlineData("payments")][InlineData("credit")][InlineData("cms")]
    [InlineData("inventory")][InlineData("catalog")][InlineData("sales")][InlineData("market")]
    [InlineData("reviews")][InlineData("support")][InlineData("notifications")][InlineData("files")]
    public async Task NewerModuleHistoryRejectsOldExecutableReadinessWithoutDroppingAnyHistory(string schema)
    {
        using var client = fixture.Factory.CreateClient();
        await Probe(client, "/health/ready", HttpStatusCode.OK);
        var before = await History(schema);
        var future = new HistoryRow(FutureId, "10.0.0");
        await WriteHistory(schema, future, true);
        try {
            await Probe(client, "/health/ready", HttpStatusCode.ServiceUnavailable);
            await Probe(client, "/health/live", HttpStatusCode.OK);
            Assert.Equal(before.Append(future), await History(schema));
        } finally {
            await WriteHistory(schema, future, false);
        }
        Assert.Equal(before, await History(schema));
        await Probe(client, "/health/ready", HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("identity")][InlineData("payments")][InlineData("credit")][InlineData("cms")]
    [InlineData("inventory")][InlineData("catalog")][InlineData("sales")][InlineData("market")]
    [InlineData("reviews")][InlineData("support")][InlineData("notifications")][InlineData("files")]
    public async Task MissingModuleHistoryIsNotHealthyAndRestoringExactVersionRestoresReadiness(string schema)
    {
        using var client = fixture.Factory.CreateClient();
        var before = await History(schema);
        Assert.NotEmpty(before);
        var missing = before[0];
        await WriteHistory(schema, missing, false);
        try {
            await Probe(client, "/health/ready", HttpStatusCode.ServiceUnavailable);
            Assert.Equal(before.Skip(1), await History(schema));
        } finally {
            await WriteHistory(schema, missing, true);
        }
        Assert.Equal(before, await History(schema));
        await Probe(client, "/health/ready", HttpStatusCode.OK);
    }

    [Fact]
    public async Task UnreachableDatabaseIsUnavailableWhileLivenessDoesNotDependOnSql()
    {
        var settings = new SqlConnectionStringBuilder(fixture.Connection) { DataSource = "127.0.0.1,1", ConnectTimeout = 1, ConnectRetryCount = 0 };
        using var unavailable = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Shop"] = settings.ConnectionString })));
        using var client = unavailable.CreateClient();
        await Probe(client, "/health/ready", HttpStatusCode.ServiceUnavailable);
        await Probe(client, "/health/live", HttpStatusCode.OK);
        using var healthy = fixture.Factory.CreateClient();
        await Probe(healthy, "/health/ready", HttpStatusCode.OK);
    }
}
