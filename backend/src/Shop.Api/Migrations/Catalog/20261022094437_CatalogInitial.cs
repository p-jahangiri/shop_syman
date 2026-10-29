using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class CatalogInitial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "catalog");

            migrationBuilder.CreateTable(
                name: "AttributeDefinitions",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Key = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    DataType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AttributeDefinitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Brands",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    LogoUrl = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Brands", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Categories",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    ParentId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    ImageUrl = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Categories_Categories_ParentId",
                        column: x => x.ParentId,
                        principalSchema: "catalog",
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AttributeOptions",
                schema: "catalog",
                columns: table => new
                {
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Value = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AttributeOptions", x => new { x.AttributeId, x.Id });
                    table.ForeignKey(
                        name: "FK_AttributeOptions_AttributeDefinitions_AttributeId",
                        column: x => x.AttributeId,
                        principalSchema: "catalog",
                        principalTable: "AttributeDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AttributeTranslation",
                schema: "catalog",
                columns: table => new
                {
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AttributeTranslation", x => new { x.AttributeId, x.Locale });
                    table.ForeignKey(
                        name: "FK_AttributeTranslation_AttributeDefinitions_AttributeId",
                        column: x => x.AttributeId,
                        principalSchema: "catalog",
                        principalTable: "AttributeDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CategoryAttributes",
                schema: "catalog",
                columns: table => new
                {
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    IsRequired = table.Column<bool>(type: "bit", nullable: false),
                    IsFilterable = table.Column<bool>(type: "bit", nullable: false),
                    IsComparable = table.Column<bool>(type: "bit", nullable: false),
                    ShowInSpecs = table.Column<bool>(type: "bit", nullable: false),
                    IsVariantAxis = table.Column<bool>(type: "bit", nullable: false),
                    GroupName = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategoryAttributes", x => new { x.CategoryId, x.AttributeId });
                    table.ForeignKey(
                        name: "FK_CategoryAttributes_AttributeDefinitions_AttributeId",
                        column: x => x.AttributeId,
                        principalSchema: "catalog",
                        principalTable: "AttributeDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CategoryAttributes_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "catalog",
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CategoryTranslation",
                schema: "catalog",
                columns: table => new
                {
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    SeoTitle = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    SeoDescription = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategoryTranslation", x => new { x.CategoryId, x.Locale });
                    table.ForeignKey(
                        name: "FK_CategoryTranslation_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "catalog",
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SellerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    BrandId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    IsDigital = table.Column<bool>(type: "bit", nullable: false),
                    Featured = table.Column<bool>(type: "bit", nullable: false),
                    PublishAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                    table.CheckConstraint("CK_Product_Status", "[Status] IN ('Draft','Published','Hidden')");
                    table.ForeignKey(
                        name: "FK_Products_Brands_BrandId",
                        column: x => x.BrandId,
                        principalSchema: "catalog",
                        principalTable: "Brands",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Products_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "catalog",
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProductAttributeValue",
                schema: "catalog",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ValueTextFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ValueTextEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ValueNumber = table.Column<decimal>(type: "decimal(28,8)", precision: 28, scale: 8, nullable: true),
                    ValueBool = table.Column<bool>(type: "bit", nullable: true),
                    ValueOptionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductAttributeValue", x => new { x.ProductId, x.AttributeId });
                    table.ForeignKey(
                        name: "FK_ProductAttributeValue_AttributeDefinitions_AttributeId",
                        column: x => x.AttributeId,
                        principalSchema: "catalog",
                        principalTable: "AttributeDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProductAttributeValue_AttributeOptions_AttributeId_ValueOptionId",
                        columns: x => new { x.AttributeId, x.ValueOptionId },
                        principalSchema: "catalog",
                        principalTable: "AttributeOptions",
                        principalColumns: new[] { "AttributeId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProductAttributeValue_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProductCreditPlan",
                schema: "catalog",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlanId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductCreditPlan", x => new { x.ProductId, x.PlanId });
                    table.ForeignKey(
                        name: "FK_ProductCreditPlan_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProductMedia",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    Url = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: false),
                    Type = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductMedia", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductMedia_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProductPurchaseMethod",
                schema: "catalog",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    MethodId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductPurchaseMethod", x => new { x.ProductId, x.MethodId });
                    table.ForeignKey(
                        name: "FK_ProductPurchaseMethod_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProductTranslation",
                schema: "catalog",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    Badge = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductTranslation", x => new { x.ProductId, x.Locale });
                    table.ForeignKey(
                        name: "FK_ProductTranslation_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Variants",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Barcode = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    PriceRial = table.Column<long>(type: "bigint", nullable: false),
                    CompareAtPriceRial = table.Column<long>(type: "bigint", nullable: true),
                    Color = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ColorNameFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ColorNameEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    WarrantyFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    WarrantyEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Variants", x => x.Id);
                    table.CheckConstraint("CK_Variant_CompareAt", "[CompareAtPriceRial] IS NULL OR [CompareAtPriceRial] >= [PriceRial]");
                    table.CheckConstraint("CK_Variant_Price", "[PriceRial] >= 0");
                    table.ForeignKey(
                        name: "FK_Variants_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProductAttributeSelection",
                schema: "catalog",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OptionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductAttributeSelection", x => new { x.ProductId, x.AttributeId, x.OptionId });
                    table.ForeignKey(
                        name: "FK_ProductAttributeSelection_AttributeOptions_AttributeId_OptionId",
                        columns: x => new { x.AttributeId, x.OptionId },
                        principalSchema: "catalog",
                        principalTable: "AttributeOptions",
                        principalColumns: new[] { "AttributeId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProductAttributeSelection_ProductAttributeValue_ProductId_AttributeId",
                        columns: x => new { x.ProductId, x.AttributeId },
                        principalSchema: "catalog",
                        principalTable: "ProductAttributeValue",
                        principalColumns: new[] { "ProductId", "AttributeId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PriceHistory",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OldPrice = table.Column<long>(type: "bigint", nullable: false),
                    NewPrice = table.Column<long>(type: "bigint", nullable: false),
                    ChangedBy = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PriceHistory_Variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "catalog",
                        principalTable: "Variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VariantAttributeValue",
                schema: "catalog",
                columns: table => new
                {
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ValueTextFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ValueTextEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ValueNumber = table.Column<decimal>(type: "decimal(28,8)", precision: 28, scale: 8, nullable: true),
                    ValueBool = table.Column<bool>(type: "bit", nullable: true),
                    ValueOptionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VariantAttributeValue", x => new { x.VariantId, x.AttributeId });
                    table.ForeignKey(
                        name: "FK_VariantAttributeValue_AttributeDefinitions_AttributeId",
                        column: x => x.AttributeId,
                        principalSchema: "catalog",
                        principalTable: "AttributeDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VariantAttributeValue_AttributeOptions_AttributeId_ValueOptionId",
                        columns: x => new { x.AttributeId, x.ValueOptionId },
                        principalSchema: "catalog",
                        principalTable: "AttributeOptions",
                        principalColumns: new[] { "AttributeId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VariantAttributeValue_Variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "catalog",
                        principalTable: "Variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VariantPurchaseMethod",
                schema: "catalog",
                columns: table => new
                {
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    MethodId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VariantPurchaseMethod", x => new { x.VariantId, x.MethodId });
                    table.ForeignKey(
                        name: "FK_VariantPurchaseMethod_Variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "catalog",
                        principalTable: "Variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AttributeDefinitions_Key",
                schema: "catalog",
                table: "AttributeDefinitions",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AttributeOptions_AttributeId_Value",
                schema: "catalog",
                table: "AttributeOptions",
                columns: new[] { "AttributeId", "Value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Brands_Slug",
                schema: "catalog",
                table: "Brands",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Categories_ParentId",
                schema: "catalog",
                table: "Categories",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_Categories_Slug",
                schema: "catalog",
                table: "Categories",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CategoryAttributes_AttributeId",
                schema: "catalog",
                table: "CategoryAttributes",
                column: "AttributeId");

            migrationBuilder.CreateIndex(
                name: "IX_PriceHistory_VariantId",
                schema: "catalog",
                table: "PriceHistory",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductAttributeSelection_AttributeId_OptionId",
                schema: "catalog",
                table: "ProductAttributeSelection",
                columns: new[] { "AttributeId", "OptionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProductAttributeValue_AttributeId_ValueBool",
                schema: "catalog",
                table: "ProductAttributeValue",
                columns: new[] { "AttributeId", "ValueBool" });

            migrationBuilder.CreateIndex(
                name: "IX_ProductAttributeValue_AttributeId_ValueNumber",
                schema: "catalog",
                table: "ProductAttributeValue",
                columns: new[] { "AttributeId", "ValueNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_ProductAttributeValue_AttributeId_ValueOptionId",
                schema: "catalog",
                table: "ProductAttributeValue",
                columns: new[] { "AttributeId", "ValueOptionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProductMedia_ProductId",
                schema: "catalog",
                table: "ProductMedia",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_BrandId",
                schema: "catalog",
                table: "Products",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_CategoryId_Status",
                schema: "catalog",
                table: "Products",
                columns: new[] { "CategoryId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Products_Slug",
                schema: "catalog",
                table: "Products",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductTranslation_Name",
                schema: "catalog",
                table: "ProductTranslation",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_VariantAttributeValue_AttributeId_ValueNumber",
                schema: "catalog",
                table: "VariantAttributeValue",
                columns: new[] { "AttributeId", "ValueNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_VariantAttributeValue_AttributeId_ValueOptionId",
                schema: "catalog",
                table: "VariantAttributeValue",
                columns: new[] { "AttributeId", "ValueOptionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Variants_ProductId",
                schema: "catalog",
                table: "Variants",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Variants_Sku",
                schema: "catalog",
                table: "Variants",
                column: "Sku",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AttributeTranslation",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "CategoryAttributes",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "CategoryTranslation",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "PriceHistory",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductAttributeSelection",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductCreditPlan",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductMedia",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductPurchaseMethod",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductTranslation",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "VariantAttributeValue",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "VariantPurchaseMethod",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductAttributeValue",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "Variants",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "AttributeOptions",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "Products",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "AttributeDefinitions",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "Brands",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "Categories",
                schema: "catalog");
        }
    }
}
