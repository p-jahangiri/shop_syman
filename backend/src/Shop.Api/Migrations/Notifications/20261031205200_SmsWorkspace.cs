using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Notifications
{
    /// <inheritdoc />
    public partial class SmsWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SmsConnections",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Provider = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Mode = table.Column<string>(type: "varchar(10)", unicode: false, maxLength: 10, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    KeyRevision = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ProtectedApiKey = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: true),
                    LegacyKeyProtection = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsConnections", x => x.Id);
                    table.CheckConstraint("CK_SmsConnection_Key", "[ProtectedApiKey] IS NULL OR DATALENGTH([ProtectedApiKey]) BETWEEN 1 AND 32768");
                    table.CheckConstraint("CK_SmsConnection_Provider", "([Provider]='smsIr' AND [Mode] IN ('live','sandbox')) OR ([Provider]='kavenegar' AND [Mode]='live')");
                });

            migrationBuilder.CreateTable(
                name: "SmsMessages",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Source = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SourceId = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ProtectedPayload = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
                    ConnectionName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Provider = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: true),
                    TemplateName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AttemptedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Reason = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsMessages", x => x.Id);
                    table.CheckConstraint("CK_SmsMessage_Payload", "DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 32768");
                    table.CheckConstraint("CK_SmsMessage_State", "[State] IN ('queued','dispatching','accepted','rejected','unknown','skipped')");
                });

            migrationBuilder.CreateTable(
                name: "SmsWorkspace",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OtpGeneration = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    LifetimeSeconds = table.Column<int>(type: "int", nullable: false),
                    ResendSeconds = table.Column<int>(type: "int", nullable: false),
                    MaxAttempts = table.Column<int>(type: "int", nullable: false),
                    PhoneHourlyLimit = table.Column<int>(type: "int", nullable: false),
                    PhoneDailyLimit = table.Column<int>(type: "int", nullable: false),
                    GlobalHourlyLimit = table.Column<int>(type: "int", nullable: false),
                    GlobalDailyLimit = table.Column<int>(type: "int", nullable: false),
                    NotificationHourlyLimit = table.Column<int>(type: "int", nullable: false),
                    NotificationDailyLimit = table.Column<int>(type: "int", nullable: false),
                    GenericName = table.Column<string>(type: "nvarchar(25)", maxLength: 25, nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsWorkspace", x => x.Id);
                    table.CheckConstraint("CK_SmsWorkspace_Policy", "[LifetimeSeconds] BETWEEN 60 AND 600 AND [ResendSeconds] BETWEEN 30 AND 300 AND [ResendSeconds]<[LifetimeSeconds] AND [MaxAttempts] BETWEEN 1 AND 10 AND [PhoneHourlyLimit] BETWEEN 1 AND 20 AND [PhoneDailyLimit] BETWEEN [PhoneHourlyLimit] AND 100 AND [GlobalHourlyLimit] BETWEEN [PhoneHourlyLimit] AND 10000 AND [GlobalDailyLimit] BETWEEN [GlobalHourlyLimit] AND 100000 AND [GlobalDailyLimit]>=[PhoneDailyLimit] AND [NotificationHourlyLimit] BETWEEN 1 AND 10000 AND [NotificationDailyLimit] BETWEEN [NotificationHourlyLimit] AND 100000");
                    table.CheckConstraint("CK_SmsWorkspace_Singleton", "[Id]='messaging'");
                });

            migrationBuilder.CreateTable(
                name: "SmsWorkspaceCommands",
                schema: "notifications",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    RequestId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ProtectedFingerprint = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
                    ProtectedReceipt = table.Column<byte[]>(type: "varbinary(max)", maxLength: 524288, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsWorkspaceCommands", x => new { x.ActorId, x.RequestId })
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateTable(
                name: "SmsTemplates",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    ConnectionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ProviderTemplate = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: false),
                    Approved = table.Column<bool>(type: "bit", nullable: false),
                    PreviewText = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsTemplates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SmsTemplates_SmsConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalSchema: "notifications",
                        principalTable: "SmsConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SmsEventRoutes",
                schema: "notifications",
                columns: table => new
                {
                    Event = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    TemplateId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    EnabledSince = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsEventRoutes", x => x.Event);
                    table.CheckConstraint("CK_SmsRoute_Enabled", "([Enabled]=0) OR ([TemplateId] IS NOT NULL AND [EnabledSince] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_SmsEventRoutes_SmsTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalSchema: "notifications",
                        principalTable: "SmsTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SmsTemplateParameters",
                schema: "notifications",
                columns: table => new
                {
                    TemplateId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "varchar(50)", unicode: false, maxLength: 50, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Source = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    Constant = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsTemplateParameters", x => new { x.TemplateId, x.Name });
                    table.ForeignKey(
                        name: "FK_SmsTemplateParameters_SmsTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalSchema: "notifications",
                        principalTable: "SmsTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SmsEventRoutes_TemplateId",
                schema: "notifications",
                table: "SmsEventRoutes",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_SmsMessages_AttemptedAt",
                schema: "notifications",
                table: "SmsMessages",
                column: "AttemptedAt");

            migrationBuilder.CreateIndex(
                name: "IX_SmsMessages_Sequence",
                schema: "notifications",
                table: "SmsMessages",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SmsMessages_Source_SourceId",
                schema: "notifications",
                table: "SmsMessages",
                columns: new[] { "Source", "SourceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SmsMessages_State_Sequence",
                schema: "notifications",
                table: "SmsMessages",
                columns: new[] { "State", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_SmsTemplates_ConnectionId",
                schema: "notifications",
                table: "SmsTemplates",
                column: "ConnectionId");
            // Retain the live configuration without decrypting or re-wrapping
            // its key. The existing challenge generation stays valid.
            migrationBuilder.Sql("""
                IF OBJECT_ID(N'identity.CustomerSmsSettings',N'U') IS NOT NULL
                BEGIN
                    INSERT [notifications].[SmsWorkspace]
                        ([Id],[OtpGeneration],[LifetimeSeconds],[ResendSeconds],[MaxAttempts],
                         [PhoneHourlyLimit],[PhoneDailyLimit],[GlobalHourlyLimit],[GlobalDailyLimit],
                         [NotificationHourlyLimit],[NotificationDailyLimit],[GenericName],[ChangedAt])
                    SELECT 'messaging',[KeyRevision],300,60,5,5,20,100,1000,100,1000,
                        CASE WHEN LEN([GenericName])=0 THEN N'کاربر سایمان' ELSE [GenericName] END,SYSUTCDATETIME()
                    FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms';
                    INSERT [notifications].[SmsConnections]
                        ([Id],[Name],[Provider],[Mode],[Enabled],[KeyRevision],[ProtectedApiKey],[LegacyKeyProtection])
                    SELECT 'd6900000000000000000000000000001',N'اتصال اصلی SMS.ir','smsIr',[Mode],[Enabled],
                        [KeyRevision],[ProtectedApiKey],1 FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms';
                    INSERT [notifications].[SmsTemplates]
                        ([Id],[Name],[Kind],[ConnectionId],[ProviderTemplate],[Approved],[PreviewText])
                    SELECT 'd6900000000000000000000000000002',N'کد ورود مشتری','otp',
                        'd6900000000000000000000000000001',CONVERT(varchar(100),[TemplateId]),
                        CASE WHEN [Mode]='live' THEN 1 ELSE 0 END,N''
                    FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms';
                    INSERT [notifications].[SmsTemplateParameters] ([TemplateId],[Name],[Source],[Constant])
                    SELECT 'd6900000000000000000000000000002',[CodeParameterName],'code',NULL
                    FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms';
                    INSERT [notifications].[SmsTemplateParameters] ([TemplateId],[Name],[Source],[Constant])
                    SELECT 'd6900000000000000000000000000002',[NameParameterName],'genericName',NULL
                    FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms' AND [NameParameterName] IS NOT NULL;
                    INSERT [notifications].[SmsEventRoutes] ([Event],[Enabled],[TemplateId],[EnabledSince])
                    SELECT 'otp',CASE WHEN [Enabled]=1 AND [Mode]='live' AND [ProtectedApiKey] IS NOT NULL THEN 1 ELSE 0 END,
                        'd6900000000000000000000000000002',CONVERT(datetimeoffset,'1970-01-01T00:00:00+00:00')
                    FROM [identity].[CustomerSmsSettings] WHERE [Id]='customer-sms';
                    INSERT [notifications].[SmsEventRoutes] ([Event],[Enabled],[TemplateId],[EnabledSince])
                    SELECT [Event],0,NULL,NULL FROM (VALUES ('orderCreated'),('orderPaid'),('orderShipped'),('orderCancelled'),
                        ('creditApproved'),('orderDigitalReady'),('chequeReminder')) AS Kinds([Event])
                    WHERE EXISTS (SELECT 1 FROM [notifications].[SmsWorkspace]);
                END
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [notifications].[SmsWorkspace])
                    OR EXISTS (SELECT 1 FROM [notifications].[SmsMessages])
                    OR EXISTS (SELECT 1 FROM [notifications].[SmsWorkspaceCommands])
                    OR EXISTS (SELECT 1 FROM [notifications].[SmsConnections])
                    OR EXISTS (SELECT 1 FROM [notifications].[SmsTemplates])
                    OR EXISTS (SELECT 1 FROM [notifications].[SmsEventRoutes])
                    THROW 51069,'Retained SMS settings and delivery history require forward-compatible recovery.',1;
                """);
            migrationBuilder.DropTable(
                name: "SmsEventRoutes",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsMessages",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsTemplateParameters",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsWorkspace",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsWorkspaceCommands",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsTemplates",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "SmsConnections",
                schema: "notifications");
        }
    }
}
