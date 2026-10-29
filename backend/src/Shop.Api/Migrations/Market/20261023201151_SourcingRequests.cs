using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class SourcingRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourcingCommandReceipts",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TargetId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingCommandReceipts", x => new { x.ActorId, x.Operation, x.RequestId });
                    table.CheckConstraint("CK_SourcingReceipt_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequests",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SubmitRequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    SubmittedCartVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ProtectedNote = table.Column<string>(type: "varchar(max)", unicode: false, maxLength: 32768, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequests", x => x.Id);
                    table.CheckConstraint("CK_SourcingRequest_Dates", "[ChangedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_SourcingRequest_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_SourcingRequest_Note", "LEN([ProtectedNote]) BETWEEN 1 AND 32768");
                    table.CheckConstraint("CK_SourcingRequest_State", "[State] IN ('Submitted','Reviewing','Unavailable','Cancelled')");
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequestEvents",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorKind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    StateBefore = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    StateAfter = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ReasonCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PublicMessage = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequestEvents", x => x.Id);
                    table.CheckConstraint("CK_SourcingEvent_Actor", "[ActorKind] IN ('customer','staff','system')");
                    table.CheckConstraint("CK_SourcingEvent_State", "([StateBefore] IS NULL OR [StateBefore] IN ('Submitted','Reviewing','Unavailable','Cancelled')) AND [StateAfter] IN ('Submitted','Reviewing','Unavailable','Cancelled')");
                    table.ForeignKey(
                        name: "FK_SourcingRequestEvents_SourcingRequests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "market",
                        principalTable: "SourcingRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequestLines",
                schema: "market",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ModelId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CategoryNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CategoryNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    BrandId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Brand = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    SearchText = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    DescriptionFa = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    DescriptionEn = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    ModelVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    ModelFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ListingVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    SelectionFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    SourceKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SourceItemKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    SourceNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SourceNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SourceUrl = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: true),
                    Availability = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ValidUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ReferencePriceRial = table.Column<long>(type: "bigint", nullable: true),
                    ReferencePriceCurrent = table.Column<bool>(type: "bit", nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequestLines", x => new { x.RequestId, x.ListingId });
                    table.CheckConstraint("CK_SourcingLine_Availability", "[Availability] IN ('unknown','available','unavailable','stale')");
                    table.CheckConstraint("CK_SourcingLine_Observation", "([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL AND [ReferencePriceCurrent]=0) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");
                    table.CheckConstraint("CK_SourcingLine_Price", "[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                    table.CheckConstraint("CK_SourcingLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_SourcingRequestLines_SourcingRequests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "market",
                        principalTable: "SourcingRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequestAttributes",
                schema: "market",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Key = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    DataType = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    UnitFa = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    UnitEn = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    TextFa = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    TextEn = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    Number = table.Column<decimal>(type: "decimal(28,8)", precision: 28, scale: 8, nullable: true),
                    Bool = table.Column<bool>(type: "bit", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequestAttributes", x => new { x.RequestId, x.ListingId, x.AttributeId });
                    table.CheckConstraint("CK_SourcingAttribute_Type", "[DataType] IN ('Text','Number','Bool','Select','MultiSelect')");
                    table.CheckConstraint("CK_SourcingAttribute_Value", "([DataType]='Text' AND [TextFa] IS NOT NULL AND [TextEn] IS NOT NULL AND [Number] IS NULL AND [Bool] IS NULL) OR ([DataType]='Number' AND [Number] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Bool] IS NULL) OR ([DataType]='Bool' AND [Bool] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL) OR ([DataType] IN ('Select','MultiSelect') AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL AND [Bool] IS NULL)");
                    table.ForeignKey(
                        name: "FK_SourcingRequestAttributes_SourcingRequestLines_RequestId_ListingId",
                        columns: x => new { x.RequestId, x.ListingId },
                        principalSchema: "market",
                        principalTable: "SourcingRequestLines",
                        principalColumns: new[] { "RequestId", "ListingId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequestImages",
                schema: "market",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Url = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequestImages", x => new { x.RequestId, x.ListingId, x.SortOrder });
                    table.CheckConstraint("CK_SourcingImage_Order", "[SortOrder] BETWEEN 0 AND 23");
                    table.ForeignKey(
                        name: "FK_SourcingRequestImages_SourcingRequestLines_RequestId_ListingId",
                        columns: x => new { x.RequestId, x.ListingId },
                        principalSchema: "market",
                        principalTable: "SourcingRequestLines",
                        principalColumns: new[] { "RequestId", "ListingId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingRequestOptions",
                schema: "market",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OptionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingRequestOptions", x => new { x.RequestId, x.ListingId, x.AttributeId, x.OptionId });
                    table.ForeignKey(
                        name: "FK_SourcingRequestOptions_SourcingRequestAttributes_RequestId_ListingId_AttributeId",
                        columns: x => new { x.RequestId, x.ListingId, x.AttributeId },
                        principalSchema: "market",
                        principalTable: "SourcingRequestAttributes",
                        principalColumns: new[] { "RequestId", "ListingId", "AttributeId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequestEvents_RequestId_Id",
                schema: "market",
                table: "SourcingRequestEvents",
                columns: new[] { "RequestId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequests_CartId_SubmittedCartVersion",
                schema: "market",
                table: "SourcingRequests",
                columns: new[] { "CartId", "SubmittedCartVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequests_Number",
                schema: "market",
                table: "SourcingRequests",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequests_OwnerId_CreatedAt_Id",
                schema: "market",
                table: "SourcingRequests",
                columns: new[] { "OwnerId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequests_OwnerId_SubmitRequestId",
                schema: "market",
                table: "SourcingRequests",
                columns: new[] { "OwnerId", "SubmitRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingRequests_State_CreatedAt_Id",
                schema: "market",
                table: "SourcingRequests",
                columns: new[] { "State", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SourcingCommandReceipts",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequestEvents",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequestImages",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequestOptions",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequestAttributes",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequestLines",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingRequests",
                schema: "market");
        }
    }
}
