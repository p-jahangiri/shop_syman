using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class UsedItemInspections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UsedInspectionId",
                schema: "catalog",
                table: "Variants",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "UsedItemCommands",
                schema: "catalog",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsedItemCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_UsedItem_CommandJson", "ISJSON([ResultJson])=1");
                });

            migrationBuilder.CreateTable(
                name: "UsedItemInspections",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TechnicalState = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    BatteryState = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    BatteryHealthPercent = table.Column<int>(type: "int", nullable: true),
                    ScreenState = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    BodyState = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    RepairState = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    NotesFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    NotesEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    InspectedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsedItemInspections", x => x.Id);
                    table.UniqueConstraint("AK_UsedItemInspections_VariantId_Id", x => new { x.VariantId, x.Id });
                    table.CheckConstraint("CK_UsedItem_Battery", "([BatteryState] IN ('unknown','notApplicable') AND [BatteryHealthPercent] IS NULL) OR ([BatteryState]='measured' AND [BatteryHealthPercent] IS NOT NULL AND [BatteryHealthPercent] BETWEEN 0 AND 100)");
                    table.CheckConstraint("CK_UsedItem_Exterior", "[ScreenState] IN ('unknown','intact','worn','damaged') AND [BodyState] IN ('unknown','intact','worn','damaged')");
                    table.CheckConstraint("CK_UsedItem_Repair", "[RepairState] IN ('unknown','noKnownRepair','repaired')");
                    table.CheckConstraint("CK_UsedItem_Technical", "[TechnicalState] IN ('unknown','passed','needsRepair')");
                    table.CheckConstraint("CK_UsedItem_Time", "[InspectedAt]<=[RecordedAt]");
                    table.ForeignKey(
                        name: "FK_UsedItemInspections_Variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "catalog",
                        principalTable: "Variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Variants_Id_UsedInspectionId",
                schema: "catalog",
                table: "Variants",
                columns: new[] { "Id", "UsedInspectionId" });

            migrationBuilder.CreateIndex(
                name: "IX_UsedItemInspections_VariantId_RecordedAt_Id",
                schema: "catalog",
                table: "UsedItemInspections",
                columns: new[] { "VariantId", "RecordedAt", "Id" });

            migrationBuilder.AddForeignKey(
                name: "FK_Variants_UsedItemInspections_Id_UsedInspectionId",
                schema: "catalog",
                table: "Variants",
                columns: new[] { "Id", "UsedInspectionId" },
                principalSchema: "catalog",
                principalTable: "UsedItemInspections",
                principalColumns: new[] { "VariantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [catalog].[UsedItemInspections]) OR EXISTS (SELECT 1 FROM [catalog].[UsedItemCommands]) OR EXISTS (SELECT 1 FROM [catalog].[Variants] WHERE [UsedInspectionId] IS NOT NULL) THROW 51000, 'Used-device inspection history must be preserved; downgrade refused.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_Variants_UsedItemInspections_Id_UsedInspectionId",
                schema: "catalog",
                table: "Variants");

            migrationBuilder.DropTable(
                name: "UsedItemCommands",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "UsedItemInspections",
                schema: "catalog");

            migrationBuilder.DropIndex(
                name: "IX_Variants_Id_UsedInspectionId",
                schema: "catalog",
                table: "Variants");

            migrationBuilder.DropColumn(
                name: "UsedInspectionId",
                schema: "catalog",
                table: "Variants");
        }
    }
}
