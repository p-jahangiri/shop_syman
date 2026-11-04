using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Identity
{
    /// <inheritdoc />
    public partial class CustomerSmsOtp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CanonicalPhone",
                schema: "identity",
                table: "AspNetUsers",
                type: "varchar(13)",
                unicode: false,
                maxLength: 13,
                nullable: true,
                collation: "Latin1_General_100_BIN2");

            // Bind existing contacts without confirming, merging, or changing
            // credentials. Every identity row participates in collision checks,
            // including staff, inactive users, and unconfirmed contacts. EF's
            // migration transaction must encompass this preflight and the index.
            migrationBuilder.Sql("""
                IF @@TRANCOUNT=0
                    THROW 51067,'Canonical mobile preflight requires a transaction.',1;

                DECLARE @TrimCharacters nvarchar(32)=
                    NCHAR(9)+NCHAR(10)+NCHAR(11)+NCHAR(12)+NCHAR(13)+NCHAR(32)
                    +NCHAR(133)+NCHAR(160)+NCHAR(5760)
                    +NCHAR(8192)+NCHAR(8193)+NCHAR(8194)+NCHAR(8195)+NCHAR(8196)
                    +NCHAR(8197)+NCHAR(8198)+NCHAR(8199)+NCHAR(8200)+NCHAR(8201)+NCHAR(8202)
                    +NCHAR(8232)+NCHAR(8233)+NCHAR(8239)+NCHAR(8287)+NCHAR(12288);

                ;WITH Normalized AS
                (
                    SELECT [Id],TRIM(@TrimCharacters FROM
                        TRANSLATE([PhoneNumber] COLLATE Latin1_General_100_BIN2,
                            N'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',N'01234567890123456789')) AS [Value]
                    FROM [identity].[AspNetUsers] WITH (TABLOCKX,HOLDLOCK)
                    WHERE [PhoneNumber] IS NOT NULL AND DATALENGTH([PhoneNumber]) BETWEEN 2 AND 64
                ), Candidates AS
                (
                    SELECT [Id],CASE
                        WHEN LEN([Value])=11 AND LEFT([Value],2)=N'09' THEN N'+98'+SUBSTRING([Value],2,10)
                        WHEN LEN([Value])=13 AND LEFT([Value],4)=N'+989' THEN [Value]
                        WHEN LEN([Value])=14 AND LEFT([Value],5)=N'00989' THEN N'+98'+SUBSTRING([Value],5,10)
                        WHEN LEN([Value])=12 AND LEFT([Value],3)=N'989' THEN N'+'+[Value]
                        ELSE NULL END AS [Canonical]
                    FROM Normalized
                )
                SELECT [Id],CONVERT(varchar(13),[Canonical]) COLLATE Latin1_General_100_BIN2 AS [Canonical]
                INTO #Sayman_CustomerSmsOtp_20261031172618
                FROM Candidates
                WHERE DATALENGTH([Canonical])=26 AND LEFT([Canonical],4)=N'+989'
                    AND NOT EXISTS
                    (
                        SELECT 1 FROM (VALUES(5),(6),(7),(8),(9),(10),(11),(12),(13)) AS Digits([Position])
                        WHERE UNICODE(SUBSTRING([Canonical],Digits.[Position],1)) NOT BETWEEN 48 AND 57
                    );

                IF EXISTS
                (
                    SELECT [Canonical] FROM #Sayman_CustomerSmsOtp_20261031172618
                    GROUP BY [Canonical] HAVING COUNT_BIG(*)>1
                )
                    THROW 51067,'Canonical mobile collision; review existing account contacts before enabling customer SMS.',1;

                UPDATE Users SET [CanonicalPhone]=Phones.[Canonical]
                FROM [identity].[AspNetUsers] AS Users
                JOIN #Sayman_CustomerSmsOtp_20261031172618 AS Phones ON Phones.[Id]=Users.[Id];

                DROP TABLE #Sayman_CustomerSmsOtp_20261031172618;
                """);

            migrationBuilder.CreateTable(
                name: "CustomerOtpChallenges",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false, collation: "Latin1_General_100_BIN2"),
                    RequestId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    CanonicalPhone = table.Column<string>(type: "varchar(13)", unicode: false, maxLength: 13, nullable: false),
                    ProtectedCode = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
                    SettingsKeyRevision = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ProviderMessageId = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: true),
                    FailedAttempts = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ResendAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ConsumedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    SupersededAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerOtpChallenges", x => x.Id);
                    table.CheckConstraint("CK_CustomerOtp_Attempts", "[FailedAttempts] BETWEEN 0 AND 5");
                    table.CheckConstraint("CK_CustomerOtp_Code", "DATALENGTH([ProtectedCode]) BETWEEN 1 AND 32768");
                    table.CheckConstraint("CK_CustomerOtp_State", "[State] IN ('Prepared','Dispatching','Accepted','Rejected','Unknown')");
                    table.CheckConstraint("CK_CustomerOtp_Timing", "[ExpiresAt]=DATEADD(second,300,[CreatedAt]) AND [ResendAt]=DATEADD(second,60,[CreatedAt])");
                });

            migrationBuilder.CreateTable(
                name: "CustomerSmsSettings",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    Mode = table.Column<string>(type: "varchar(10)", unicode: false, maxLength: 10, nullable: false),
                    TemplateId = table.Column<int>(type: "int", nullable: false),
                    CodeParameterName = table.Column<string>(type: "varchar(50)", unicode: false, maxLength: 50, nullable: false),
                    NameParameterName = table.Column<string>(type: "varchar(50)", unicode: false, maxLength: 50, nullable: true),
                    GenericName = table.Column<string>(type: "nvarchar(25)", maxLength: 25, nullable: false),
                    KeyRevision = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ProtectedApiKey = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerSmsSettings", x => x.Id);
                    table.CheckConstraint("CK_CustomerSms_Key", "[ProtectedApiKey] IS NULL OR DATALENGTH([ProtectedApiKey]) BETWEEN 1 AND 32768");
                    table.CheckConstraint("CK_CustomerSms_Mode", "([Mode]='live' AND [TemplateId]>0 AND [TemplateId]<>123456) OR ([Mode]='sandbox' AND [TemplateId]=123456 AND [CodeParameterName]='Code' AND [NameParameterName] IS NULL)");
                    table.CheckConstraint("CK_CustomerSms_Singleton", "[Id]='customer-sms'");
                });

            migrationBuilder.CreateTable(
                name: "CustomerSmsSettingsCommands",
                schema: "identity",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    RequestId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ProtectedFingerprint = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
                    ProtectedReceipt = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerSmsSettingsCommands", x => new { x.ActorId, x.RequestId })
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_CanonicalPhone",
                schema: "identity",
                table: "AspNetUsers",
                column: "CanonicalPhone",
                unique: true,
                filter: "[CanonicalPhone] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOtpChallenges_CanonicalPhone_CreatedAt",
                schema: "identity",
                table: "CustomerOtpChallenges",
                columns: new[] { "CanonicalPhone", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOtpChallenges_CreatedAt",
                schema: "identity",
                table: "CustomerOtpChallenges",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOtpChallenges_RequestId",
                schema: "identity",
                table: "CustomerOtpChallenges",
                column: "RequestId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerOtpChallenges",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "CustomerSmsSettings",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "CustomerSmsSettingsCommands",
                schema: "identity");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_CanonicalPhone",
                schema: "identity",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "CanonicalPhone",
                schema: "identity",
                table: "AspNetUsers");
        }
    }
}
