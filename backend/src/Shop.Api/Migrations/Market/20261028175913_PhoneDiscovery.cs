using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class PhoneDiscovery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PhoneConfigurationJson",
                schema: "market",
                table: "SourcingRequestLines",
                type: "nvarchar(max)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PhoneConfigurations",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    RamGb = table.Column<int>(type: "int", nullable: false),
                    StorageGb = table.Column<int>(type: "int", nullable: false),
                    ColorKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ColorNameFa = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    ColorNameEn = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    ColorHex = table.Column<string>(type: "nvarchar(7)", maxLength: 7, nullable: true),
                    ImageUrl = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: true),
                    LinkedVariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhoneConfigurations", x => x.Id);
                    table.CheckConstraint("CK_PhoneConfiguration_Color", "LEN([ColorKey]) BETWEEN 1 AND 64 AND LEN([ColorNameFa]) BETWEEN 1 AND 120 AND LEN([ColorNameEn]) BETWEEN 1 AND 120");
                    table.CheckConstraint("CK_PhoneConfiguration_Memory", "[RamGb] BETWEEN 1 AND 128 AND [StorageGb] BETWEEN 1 AND 32768");
                    table.ForeignKey(
                        name: "FK_PhoneConfigurations_Listings_ListingId",
                        column: x => x.ListingId,
                        principalSchema: "market",
                        principalTable: "Listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PhoneDiscoveryCommands",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhoneDiscoveryCommands", x => new { x.ActorId, x.Operation, x.RequestId });
                    table.CheckConstraint("CK_PhoneDiscoveryCommand_Json", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=32000");
                });

            migrationBuilder.CreateTable(
                name: "PhoneInterests",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ConfigurationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ConfigurationJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Generation = table.Column<int>(type: "int", nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    ModelNameFa = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    ModelNameEn = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhoneInterests", x => x.Id);
                    table.CheckConstraint("CK_PhoneInterest_Snapshot", "ISJSON([ConfigurationJson])=1 AND DATALENGTH([ConfigurationJson])<=16000");
                    table.CheckConstraint("CK_PhoneInterest_State", "[State] IN ('Active','Cancelled','Notified') AND [Generation]>0");
                    table.CheckConstraint("CK_PhoneInterest_Time", "[ChangedAt]>=[CreatedAt]");
                    table.ForeignKey(
                        name: "FK_PhoneInterests_PhoneConfigurations_ConfigurationId",
                        column: x => x.ConfigurationId,
                        principalSchema: "market",
                        principalTable: "PhoneConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_SourcingLine_PhoneConfiguration",
                schema: "market",
                table: "SourcingRequestLines",
                sql: "[PhoneConfigurationJson] IS NULL OR (ISJSON([PhoneConfigurationJson])=1 AND DATALENGTH([PhoneConfigurationJson])<=16000)");

            migrationBuilder.CreateIndex(
                name: "IX_PhoneConfigurations_ListingId_RamGb_StorageGb_ColorKey",
                schema: "market",
                table: "PhoneConfigurations",
                columns: new[] { "ListingId", "RamGb", "StorageGb", "ColorKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInterests_ConfigurationId",
                schema: "market",
                table: "PhoneInterests",
                column: "ConfigurationId");

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInterests_OwnerId_Id",
                schema: "market",
                table: "PhoneInterests",
                columns: new[] { "OwnerId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInterests_OwnerId_ListingId_ConfigurationId",
                schema: "market",
                table: "PhoneInterests",
                columns: new[] { "OwnerId", "ListingId", "ConfigurationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInterests_State_Id",
                schema: "market",
                table: "PhoneInterests",
                columns: new[] { "State", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [market].[PhoneConfigurations]) OR EXISTS (SELECT 1 FROM [market].[PhoneInterests]) OR EXISTS (SELECT 1 FROM [market].[PhoneDiscoveryCommands]) OR EXISTS (SELECT 1 FROM [market].[SourcingRequestLines] WHERE [PhoneConfigurationJson] IS NOT NULL) THROW 51000, 'Phone configuration and customer interest history must not be discarded.', 1;");
            migrationBuilder.DropTable(
                name: "PhoneDiscoveryCommands",
                schema: "market");

            migrationBuilder.DropTable(
                name: "PhoneInterests",
                schema: "market");

            migrationBuilder.DropTable(
                name: "PhoneConfigurations",
                schema: "market");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SourcingLine_PhoneConfiguration",
                schema: "market",
                table: "SourcingRequestLines");

            migrationBuilder.DropColumn(
                name: "PhoneConfigurationJson",
                schema: "market",
                table: "SourcingRequestLines");
        }
    }
}
