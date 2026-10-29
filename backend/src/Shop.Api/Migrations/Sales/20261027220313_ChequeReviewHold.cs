using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class ChequeReviewHold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChequeReviewHoldCommands",
                schema: "sales",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PolicyId = table.Column<int>(type: "int", nullable: false),
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeReviewHoldCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ChequeReviewHoldCommand_Facts", "[PolicyId]=1 AND DATALENGTH([ResultJson]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[At])=0");
                });

            migrationBuilder.CreateTable(
                name: "ChequeReviewHoldPolicies",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    PublishedRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeReviewHoldPolicies", x => x.Id);
                    table.CheckConstraint("CK_ChequeReviewHoldPolicy_Singleton", "[Id]=1");
                });

            migrationBuilder.CreateTable(
                name: "ChequeReviewHoldRevisions",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PolicyId = table.Column<int>(type: "int", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    Minutes = table.Column<int>(type: "int", nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeReviewHoldRevisions", x => x.Id);
                    table.UniqueConstraint("AK_ChequeReviewHoldRevisions_PolicyId_Id", x => new { x.PolicyId, x.Id });
                    table.CheckConstraint("CK_ChequeReviewHoldRevision_Facts", "[PolicyId]=1 AND [Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[CreatedAt])=0");
                    table.CheckConstraint("CK_ChequeReviewHoldRevision_Limit", "([Enabled]=1 AND [Minutes] IS NOT NULL AND [Minutes] BETWEEN 1 AND 60) OR ([Enabled]=0 AND [Minutes] IS NULL)");
                    table.ForeignKey(
                        name: "FK_ChequeReviewHoldRevisions_ChequeReviewHoldPolicies_PolicyId",
                        column: x => x.PolicyId,
                        principalSchema: "sales",
                        principalTable: "ChequeReviewHoldPolicies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CreditOrderReviewHolds",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PolicyRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PolicyVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Minutes = table.Column<int>(type: "int", nullable: false),
                    QuoteExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreditOrderReviewHolds", x => x.OrderId);
                    table.CheckConstraint("CK_CreditOrderReviewHold_Facts", "[Minutes] BETWEEN 1 AND 60 AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[QuoteExpiresAt])=0 AND DATEPART(TZOFFSET,[ExpiresAt])=0 AND [CreatedAt]<[QuoteExpiresAt] AND [CreatedAt]<[ExpiresAt] AND [ExpiresAt]<=DATEADD(MINUTE,[Minutes],[CreatedAt])");
                    table.ForeignKey(
                        name: "FK_CreditOrderReviewHolds_ChequeReviewHoldRevisions_PolicyRevisionId",
                        column: x => x.PolicyRevisionId,
                        principalSchema: "sales",
                        principalTable: "ChequeReviewHoldRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CreditOrderReviewHolds_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeReviewHoldCommands_PolicyId_RevisionId",
                schema: "sales",
                table: "ChequeReviewHoldCommands",
                columns: new[] { "PolicyId", "RevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeReviewHoldCommands_RevisionId",
                schema: "sales",
                table: "ChequeReviewHoldCommands",
                column: "RevisionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeReviewHoldPolicies_Id_PublishedRevisionId",
                schema: "sales",
                table: "ChequeReviewHoldPolicies",
                columns: new[] { "Id", "PublishedRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeReviewHoldRevisions_PolicyId_Revision",
                schema: "sales",
                table: "ChequeReviewHoldRevisions",
                columns: new[] { "PolicyId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CreditOrderReviewHolds_PolicyRevisionId",
                schema: "sales",
                table: "CreditOrderReviewHolds",
                column: "PolicyRevisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_ChequeReviewHoldCommands_ChequeReviewHoldRevisions_PolicyId_RevisionId",
                schema: "sales",
                table: "ChequeReviewHoldCommands",
                columns: new[] { "PolicyId", "RevisionId" },
                principalSchema: "sales",
                principalTable: "ChequeReviewHoldRevisions",
                principalColumns: new[] { "PolicyId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ChequeReviewHoldPolicies_ChequeReviewHoldRevisions_Id_PublishedRevisionId",
                schema: "sales",
                table: "ChequeReviewHoldPolicies",
                columns: new[] { "Id", "PublishedRevisionId" },
                principalSchema: "sales",
                principalTable: "ChequeReviewHoldRevisions",
                principalColumns: new[] { "PolicyId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[ChequeReviewHoldPolicies]) OR EXISTS(SELECT 1 FROM [sales].[ChequeReviewHoldRevisions]) OR EXISTS(SELECT 1 FROM [sales].[ChequeReviewHoldCommands]) OR EXISTS(SELECT 1 FROM [sales].[CreditOrderReviewHolds]) THROW 51000, 'Cheque review-hold policy and original order history cannot be removed.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_ChequeReviewHoldPolicies_ChequeReviewHoldRevisions_Id_PublishedRevisionId",
                schema: "sales",
                table: "ChequeReviewHoldPolicies");

            migrationBuilder.DropTable(
                name: "ChequeReviewHoldCommands",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "CreditOrderReviewHolds",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "ChequeReviewHoldRevisions",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "ChequeReviewHoldPolicies",
                schema: "sales");
        }
    }
}
