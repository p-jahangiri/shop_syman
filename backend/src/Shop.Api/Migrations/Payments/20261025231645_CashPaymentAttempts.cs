using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Payments
{
    /// <inheritdoc />
    public partial class CashPaymentAttempts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CashPaymentAttempts",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    MethodId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProviderKey = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    AccountKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "varchar(3)", unicode: false, maxLength: 3, nullable: false),
                    SnapshotFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OriginalOrderVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    OrderExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    State = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    AuthorityHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    ProtectedAuthority = table.Column<byte[]>(type: "varbinary(4096)", maxLength: 4096, nullable: true),
                    RedirectUri = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: true),
                    LeaseId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    LeaseUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashPaymentAttempts", x => x.Id);
                    table.CheckConstraint("CK_CashAttempt_Amount", "[AmountRial]>0 AND [Currency]='IRR'");
                    table.CheckConstraint("CK_CashAttempt_Authority", "([AuthorityHash] IS NULL AND [ProtectedAuthority] IS NULL AND [RedirectUri] IS NULL) OR ([AuthorityHash] IS NOT NULL AND [ProtectedAuthority] IS NOT NULL AND LEN([AuthorityHash])=64 AND DATALENGTH([ProtectedAuthority]) BETWEEN 1 AND 4096 AND [RedirectUri] IS NOT NULL)");
                    table.CheckConstraint("CK_CashAttempt_Dates", "[CreatedAt]<[OrderExpiresAt] AND [ChangedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_CashAttempt_Identity", "LEN([Id])=32 AND LEN([RequestId])=32 AND LEN([OrderId])=32 AND LEN([PayloadHash])=64 AND LEN([SnapshotFingerprint])=64");
                    table.CheckConstraint("CK_CashAttempt_PendingAuthority", "[State] NOT IN ('pending','verified') OR [AuthorityHash] IS NOT NULL");
                    table.CheckConstraint("CK_CashAttempt_Lease", "([LeaseId] IS NULL AND [LeaseUntil] IS NULL) OR ([LeaseId] IS NOT NULL AND LEN([LeaseId])=32 AND [LeaseUntil] IS NOT NULL)");
                    table.CheckConstraint("CK_CashAttempt_State", "[State] IN ('created','initiating','pending','verified','review','failed','cancelled')");
                });

            migrationBuilder.CreateTable(
                name: "CashPaymentEvents",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AttemptId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Reason = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashPaymentEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CashPaymentEvents_CashPaymentAttempts_AttemptId",
                        column: x => x.AttemptId,
                        principalSchema: "payments",
                        principalTable: "CashPaymentAttempts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CashPaymentVerifications",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AttemptId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ProviderKey = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    AccountKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AuthorityHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ReferenceHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ProofHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Disposition = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    Reason = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ResponseJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ResponseHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashPaymentVerifications", x => x.Id);
                    table.CheckConstraint("CK_CashVerification_Amount", "[AmountRial]>0");
                    table.CheckConstraint("CK_CashVerification_Disposition", "[Disposition] IN ('applied','requires_review')");
                    table.CheckConstraint("CK_CashVerification_Identity", "LEN([Id])=32 AND LEN([AttemptId])=32 AND LEN([AuthorityHash])=64 AND LEN([ReferenceHash])=64 AND LEN([ProofHash])=64 AND LEN([ResponseHash])=64");
                    table.CheckConstraint("CK_CashVerification_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=16384");
                    table.ForeignKey(
                        name: "FK_CashPaymentVerifications_CashPaymentAttempts_AttemptId",
                        column: x => x.AttemptId,
                        principalSchema: "payments",
                        principalTable: "CashPaymentAttempts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentAttempts_OwnerId_CreatedAt_Id",
                schema: "payments",
                table: "CashPaymentAttempts",
                columns: new[] { "OwnerId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentAttempts_OwnerId_RequestId",
                schema: "payments",
                table: "CashPaymentAttempts",
                columns: new[] { "OwnerId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentAttempts_ProviderKey_AccountKey_AuthorityHash",
                schema: "payments",
                table: "CashPaymentAttempts",
                columns: new[] { "ProviderKey", "AccountKey", "AuthorityHash" },
                unique: true,
                filter: "[AuthorityHash] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentAttempts_State_ChangedAt_Id",
                schema: "payments",
                table: "CashPaymentAttempts",
                columns: new[] { "State", "ChangedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentEvents_AttemptId_Id",
                schema: "payments",
                table: "CashPaymentEvents",
                columns: new[] { "AttemptId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentVerifications_AttemptId",
                schema: "payments",
                table: "CashPaymentVerifications",
                column: "AttemptId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CashPaymentVerifications_ProviderKey_AccountKey_ReferenceHash",
                schema: "payments",
                table: "CashPaymentVerifications",
                columns: new[] { "ProviderKey", "AccountKey", "ReferenceHash" },
                unique: true,
                filter: "[Disposition]='applied'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [payments].[CashPaymentAttempts]) OR EXISTS(SELECT 1 FROM [payments].[CashPaymentEvents]) OR EXISTS(SELECT 1 FROM [payments].[CashPaymentVerifications]) THROW 51000, 'Payment attempts, gateway verification and reconciliation history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "CashPaymentEvents",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "CashPaymentVerifications",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "CashPaymentAttempts",
                schema: "payments");
        }
    }
}
