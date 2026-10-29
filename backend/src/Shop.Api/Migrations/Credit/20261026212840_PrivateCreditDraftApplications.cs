using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class PrivateCreditDraftApplications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Applications",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlanId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlanVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    RequestedAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ProtectedPlan = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    PlanHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Applications", x => x.Id);
                    table.CheckConstraint("CK_CreditApplication_Amount", "[RequestedAmountRial]>0");
                    table.CheckConstraint("CK_CreditApplication_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditApplication_Plan", "DATALENGTH([ProtectedPlan]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditApplication_State", "[State] IN ('Draft','Cancelled')");
                    table.CheckConstraint("CK_CreditApplication_Time", "[ChangedAt]>=[CreatedAt] AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ChangedAt])=0");
                    table.ForeignKey(
                        name: "FK_Applications_Plans_PlanId",
                        column: x => x.PlanId,
                        principalSchema: "credit",
                        principalTable: "Plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ApplicationCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApplicationCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditApplicationCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.ForeignKey(
                        name: "FK_ApplicationCommands_Applications_ApplicationId",
                        column: x => x.ApplicationId,
                        principalSchema: "credit",
                        principalTable: "Applications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ApplicationEvents",
                schema: "credit",
                columns: table => new
                {
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApplicationEvents", x => x.Sequence);
                    table.CheckConstraint("CK_CreditApplicationEvent_Action", "[Action] IN ('Created','Cancelled')");
                    table.CheckConstraint("CK_CreditApplicationEvent_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ApplicationEvents_Applications_ApplicationId",
                        column: x => x.ApplicationId,
                        principalSchema: "credit",
                        principalTable: "Applications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationCommands_ApplicationId",
                schema: "credit",
                table: "ApplicationCommands",
                column: "ApplicationId");

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationEvents_ApplicationId_Sequence",
                schema: "credit",
                table: "ApplicationEvents",
                columns: new[] { "ApplicationId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_OwnerId_State_Sequence",
                schema: "credit",
                table: "Applications",
                columns: new[] { "OwnerId", "State", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_PlanId",
                schema: "credit",
                table: "Applications",
                column: "PlanId");

            migrationBuilder.CreateIndex(
                name: "IX_Applications_Sequence",
                schema: "credit",
                table: "Applications",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Applications_State_Sequence",
                schema: "credit",
                table: "Applications",
                columns: new[] { "State", "Sequence" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[Applications]) OR EXISTS(SELECT 1 FROM [credit].[ApplicationEvents]) OR EXISTS(SELECT 1 FROM [credit].[ApplicationCommands]) THROW 51000, 'Private credit application and consent history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "ApplicationCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ApplicationEvents",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "Applications",
                schema: "credit");
        }
    }
}
