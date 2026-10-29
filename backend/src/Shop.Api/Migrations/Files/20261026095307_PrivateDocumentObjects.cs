using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Files
{
    /// <inheritdoc />
    public partial class PrivateDocumentObjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "files");

            migrationBuilder.CreateTable(
                name: "PrivateObjects",
                schema: "files",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ResourceId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ResourceVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    IntentHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PlaintextHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CiphertextHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ContentType = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Bytes = table.Column<int>(type: "int", nullable: false),
                    Nonce = table.Column<byte[]>(type: "varbinary(12)", maxLength: 12, nullable: false),
                    ProtectedKey = table.Column<byte[]>(type: "varbinary(4096)", maxLength: 4096, nullable: false),
                    ProtectedFilename = table.Column<byte[]>(type: "varbinary(4096)", maxLength: 4096, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    StoredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AttachedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrivateObjects", x => x.Id);
                    table.CheckConstraint("CK_PrivateObject_Bytes", "[Bytes] BETWEEN 16 AND 8388608 AND DATALENGTH([Nonce])=12 AND DATALENGTH([ProtectedKey]) BETWEEN 1 AND 4096 AND DATALENGTH([ProtectedFilename]) BETWEEN 1 AND 4096");
                    table.CheckConstraint("CK_PrivateObject_ContentType", "[ContentType] IN ('image/jpeg','image/png','image/webp','application/pdf')");
                    table.CheckConstraint("CK_PrivateObject_Kind", "[Kind] IN ('support','credit')");
                    table.CheckConstraint("CK_PrivateObject_State", "([State]='Staged' AND [StoredAt] IS NULL AND [AttachedAt] IS NULL) OR ([State]='Stored' AND [StoredAt] IS NOT NULL AND [StoredAt]>=[CreatedAt] AND [AttachedAt] IS NULL) OR ([State]='Attached' AND [StoredAt] IS NOT NULL AND [AttachedAt] IS NOT NULL AND [StoredAt]>=[CreatedAt] AND [AttachedAt]>=[StoredAt])");
                });

            migrationBuilder.CreateIndex(
                name: "IX_PrivateObjects_ActorId_CommandId",
                schema: "files",
                table: "PrivateObjects",
                columns: new[] { "ActorId", "CommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PrivateObjects_ActorId_State",
                schema: "files",
                table: "PrivateObjects",
                columns: new[] { "ActorId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_PrivateObjects_Kind_ResourceId_State",
                schema: "files",
                table: "PrivateObjects",
                columns: new[] { "Kind", "ResourceId", "State" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [files].[PrivateObjects]) THROW 51000, 'Private document metadata and key history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "PrivateObjects",
                schema: "files");
        }
    }
}
