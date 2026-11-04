using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales;
public partial class PrivateReturnRequests : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "RmaPolicyRevisions", schema: "sales", columns: table => new
        {
            Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            Revision = table.Column<int>(type: "int", nullable: false),
            Enabled = table.Column<bool>(type: "bit", nullable: false),
            PhysicalReturns = table.Column<bool>(type: "bit", nullable: false),
            DigitalComplaints = table.Column<bool>(type: "bit", nullable: false),
            ConditionsFa = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
            ConditionsEn = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
            WindowMode = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
            WindowDays = table.Column<int>(type: "int", nullable: true),
            MaxOpenPerOwner = table.Column<int>(type: "int", nullable: true),
            ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            ProtectedNote = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
            At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
            Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaPolicyRevisions", x => x.Id);
            table.CheckConstraint("CK_RmaPolicy_Facts", "[Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384 AND LEN([ConditionsFa])>0 AND LEN([ConditionsEn])>0 AND ([Enabled]=0 OR [PhysicalReturns]=1 OR [DigitalComplaints]=1)");
            table.CheckConstraint("CK_RmaPolicy_Window", "([WindowMode]='manualReview' AND [WindowDays] IS NULL) OR ([WindowMode]='deliveryDays' AND [WindowDays] BETWEEN 1 AND 3650 AND [WindowDays] IS NOT NULL)");
            table.CheckConstraint("CK_RmaPolicy_Capacity", "[MaxOpenPerOwner] IS NULL OR [MaxOpenPerOwner] BETWEEN 1 AND 10000");
        });
        migrationBuilder.CreateIndex(name: "IX_RmaPolicyRevisions_Revision", schema: "sales", table: "RmaPolicyRevisions", column: "Revision", unique: true);
        migrationBuilder.CreateTable(name: "RmaCases", schema: "sales", columns: table => new
        {
            Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            Number = table.Column<long>(type: "bigint", nullable: false).Annotation("SqlServer:Identity", "1, 1"),
            OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
            Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
            Kind = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
            State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
            Outcome = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: true),
            IsOpen = table.Column<bool>(type: "bit", nullable: false),
            OriginalSnapshotVersion = table.Column<int>(type: "int", nullable: false),
            SnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
            PolicyRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            ProtectedRequest = table.Column<byte[]>(type: "varbinary(max)", maxLength: 32768, nullable: false),
            ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
            CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
            ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
            Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaCases", x => x.Id);
            table.CheckConstraint("CK_RmaCase_Facts", "[OriginalSnapshotVersion] IN(1,2) AND [Kind] IN('physicalReturn','digitalComplaint') AND [Locale] IN('fa','en') AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ChangedAt])=0 AND [ChangedAt]>=[CreatedAt] AND DATALENGTH([ProtectedRequest]) BETWEEN 1 AND 32768");
            table.CheckConstraint("CK_RmaCase_State", "([State] IN('submitted','reviewing') AND [Outcome] IS NULL AND [IsOpen]=1) OR ([State]='reviewed' AND (([Outcome]='followUp' AND [IsOpen]=1) OR ([Outcome]='declined' AND [IsOpen]=0))) OR ([State]='withdrawn' AND [Outcome] IS NULL AND [IsOpen]=0)");
            table.ForeignKey(name: "FK_RmaCases_Orders_OrderId", column: x => x.OrderId, principalSchema: "sales", principalTable: "Orders", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            table.ForeignKey(name: "FK_RmaCases_RmaPolicyRevisions_PolicyRevisionId", column: x => x.PolicyRevisionId, principalSchema: "sales", principalTable: "RmaPolicyRevisions", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateIndex(name: "IX_RmaCases_Number", schema: "sales", table: "RmaCases", column: "Number", unique: true);
        migrationBuilder.CreateIndex(name: "IX_RmaCases_OrderId_IsOpen", schema: "sales", table: "RmaCases", columns: new[] { "OrderId","IsOpen" }, unique: true, filter: "[IsOpen]=1");
        migrationBuilder.CreateIndex(name: "IX_RmaCases_OrderId", schema: "sales", table: "RmaCases", column: "OrderId");
        migrationBuilder.CreateIndex(name: "IX_RmaCases_PolicyRevisionId", schema: "sales", table: "RmaCases", column: "PolicyRevisionId");
        migrationBuilder.CreateIndex(name: "IX_RmaCases_OwnerId_Number", schema: "sales", table: "RmaCases", columns: new[] { "OwnerId","Number" });
        migrationBuilder.CreateIndex(name: "IX_RmaCases_OwnerId_IsOpen", schema: "sales", table: "RmaCases", columns: new[] { "OwnerId","IsOpen" });
        migrationBuilder.CreateIndex(name: "IX_RmaCases_State_Number", schema: "sales", table: "RmaCases", columns: new[] { "State","Number" });
        migrationBuilder.CreateTable(name: "RmaPolicyCommands", schema: "sales", columns: table => new
        {
            ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
            ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
            ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 2097152, nullable: false),
            At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaPolicyCommands", x => new { x.ActorId, x.CommandId });
            table.CheckConstraint("CK_RmaPolicyCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 2097152");
            table.ForeignKey(name: "FK_RmaPolicyCommands_RmaPolicyRevisions_RevisionId", column: x => x.RevisionId, principalSchema: "sales", principalTable: "RmaPolicyRevisions", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateIndex(name: "IX_RmaPolicyCommands_RevisionId", schema: "sales", table: "RmaPolicyCommands", column: "RevisionId", unique: true);
        migrationBuilder.CreateTable(name: "RmaCaseLines", schema: "sales", columns: table => new
        {
            CaseId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
            Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
            Label = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
            IsDigital = table.Column<bool>(type: "bit", nullable: false),
            OrderedQuantity = table.Column<int>(type: "int", nullable: false),
            Quantity = table.Column<int>(type: "int", nullable: false),
            HandedOffOrAvailableQuantity = table.Column<int>(type: "int", nullable: false),
            ProtectedFacts = table.Column<byte[]>(type: "varbinary(max)", maxLength: 131072, nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaCaseLines", x => new { x.CaseId, x.LineKey });
            table.CheckConstraint("CK_RmaCaseLine_Quantity", "[OrderedQuantity] BETWEEN 1 AND 1000000 AND [Quantity] BETWEEN 1 AND [HandedOffOrAvailableQuantity] AND [HandedOffOrAvailableQuantity]<=[OrderedQuantity] AND DATALENGTH([ProtectedFacts]) BETWEEN 1 AND 131072");
            table.ForeignKey(name: "FK_RmaCaseLines_RmaCases_CaseId", column: x => x.CaseId, principalSchema: "sales", principalTable: "RmaCases", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateTable(name: "RmaCaseEvents", schema: "sales", columns: table => new
        {
            Id = table.Column<long>(type: "bigint", nullable: false).Annotation("SqlServer:Identity", "1, 1"),
            CaseId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            Author = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
            Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
            State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
            Outcome = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: true),
            At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
            ProtectedText = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaCaseEvents", x => x.Id);
            table.CheckConstraint("CK_RmaCaseEvent_Facts", "[Author] IN('customer','staff') AND [Action] IN('submitted','startReview','completeReview','withdrawn') AND [State] IN('submitted','reviewing','reviewed','withdrawn') AND ([Outcome] IS NULL OR [Outcome] IN('followUp','declined')) AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedText]) BETWEEN 1 AND 65536");
            table.ForeignKey(name: "FK_RmaCaseEvents_RmaCases_CaseId", column: x => x.CaseId, principalSchema: "sales", principalTable: "RmaCases", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateIndex(name: "IX_RmaCaseEvents_CaseId_Id", schema: "sales", table: "RmaCaseEvents", columns: new[] { "CaseId","Id" });
        migrationBuilder.CreateIndex(name: "IX_RmaCaseEvents_CaseId_Action", schema: "sales", table: "RmaCaseEvents", columns: new[] { "CaseId","Action" }, unique: true);
        migrationBuilder.CreateTable(name: "RmaCaseCommands", schema: "sales", columns: table => new
        {
            ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            CaseId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
            OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
            Audience = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
            PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
            ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
            ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 2097152, nullable: false),
            ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
            At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_RmaCaseCommands", x => new { x.ActorId, x.CommandId });
            table.CheckConstraint("CK_RmaCaseCommand_Facts", "[Audience] IN('customer','staff') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 2097152");
            table.ForeignKey(name: "FK_RmaCaseCommands_RmaCases_CaseId", column: x => x.CaseId, principalSchema: "sales", principalTable: "RmaCases", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateIndex(name: "IX_RmaCaseCommands_CaseId", schema: "sales", table: "RmaCaseCommands", column: "CaseId");
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[RmaPolicyRevisions]) OR EXISTS(SELECT 1 FROM [sales].[RmaCases]) OR EXISTS(SELECT 1 FROM [sales].[RmaPolicyCommands]) OR EXISTS(SELECT 1 FROM [sales].[RmaCaseLines]) OR EXISTS(SELECT 1 FROM [sales].[RmaCaseEvents]) OR EXISTS(SELECT 1 FROM [sales].[RmaCaseCommands]) THROW 51000, 'Retained private return-request history exists; retain compatible code and recover forward.', 1;");
        migrationBuilder.DropTable(name: "RmaCaseCommands", schema: "sales");
        migrationBuilder.DropTable(name: "RmaCaseEvents", schema: "sales");
        migrationBuilder.DropTable(name: "RmaCaseLines", schema: "sales");
        migrationBuilder.DropTable(name: "RmaPolicyCommands", schema: "sales");
        migrationBuilder.DropTable(name: "RmaCases", schema: "sales");
        migrationBuilder.DropTable(name: "RmaPolicyRevisions", schema: "sales");
    }
}
