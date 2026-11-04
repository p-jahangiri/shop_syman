using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;
using Shop.Modules.Catalog.Infrastructure;
using Xunit;
namespace Shop.SqlTests;

public sealed class ProductWorkspaceSchemaSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    [Fact]
    public async Task ActualSqlSchemaMatchesModelAndExportsReviewedMetadata()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Equal("20261101224803_ProductWorkspace", (await db.Database.GetAppliedMigrationsAsync()).Last());
        await db.Database.OpenConnectionAsync();
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0 AND schema_id=SCHEMA_ID(N'catalog')";
        var catalogTableCount = Convert.ToInt32(await command.ExecuteScalarAsync());
        var modelTableCount = db.Model.GetRelationalModel().Tables.Count(t => t.Schema == "catalog");
        Assert.Equal(modelTableCount + 1, catalogTableCount); // includes __EFMigrationsHistory
        var output = Environment.GetEnvironmentVariable("SHOP_D70_WIRE_DIR");
        if (!string.IsNullOrWhiteSpace(output))
        {
            string? sqlPath = null;
            foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
            for (var parent = new DirectoryInfo(start); parent is not null && sqlPath is null; parent = parent.Parent)
            foreach (var relative in new[] { "backend/tests/fixtures/catalog-video/schema-metadata.sql", "tests/fixtures/catalog-video/schema-metadata.sql" })
            if (File.Exists(Path.Combine(parent.FullName, relative)))
                sqlPath = Path.Combine(parent.FullName, relative);
            Assert.NotNull(sqlPath);
            command.CommandText = "SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0";
            var tableCount = Convert.ToInt32(await command.ExecuteScalarAsync());
            command.CommandText = await File.ReadAllTextAsync(sqlPath);
            await using var reader = await command.ExecuteReaderAsync();
            var parts = new List<string>();
            while (await reader.ReadAsync())
                parts.Add(reader.GetString(0));
            using var document = JsonDocument.Parse(string.Concat(parts));
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output, "schema-contract.json"), JsonSerializer.Serialize(new
            {
                status = "disposable-catalog-workspace-accepted",
                tableCount,
                catalogTableCount,
                metadata = document.RootElement
            }));
        }
    }
    [Fact]
    public async Task DownRefusesToEraseWorkspaceHistoryOrConfiguration()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        db.Add(new ProductFormConfiguration { UpdatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        var previous = db.Database.GetMigrations().Reverse().Skip(1).First();
        var error = await Assert.ThrowsAsync<SqlException>(() => db.GetService<IMigrator>().MigrateAsync(previous));
        Assert.Contains("forward-only", error.Message);
        Assert.Equal("20261101224803_ProductWorkspace", (await db.Database.GetAppliedMigrationsAsync()).Last());
        Assert.True(await db.Set<ProductFormConfiguration>().AnyAsync());
    }
}
