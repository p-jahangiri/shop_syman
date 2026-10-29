IF OBJECT_ID(N'[catalog].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'catalog') IS NULL EXEC(N'CREATE SCHEMA [catalog];');
    CREATE TABLE [catalog].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    IF SCHEMA_ID(N'catalog') IS NULL EXEC(N'CREATE SCHEMA [catalog];');
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[AttributeDefinitions] (
        [Id] nvarchar(64) NOT NULL,
        [Key] nvarchar(150) NOT NULL,
        [DataType] nvarchar(20) NOT NULL,
        [Unit] nvarchar(80) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_AttributeDefinitions] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[Brands] (
        [Id] nvarchar(64) NOT NULL,
        [Name] nvarchar(120) NOT NULL,
        [Slug] nvarchar(150) NOT NULL,
        [LogoUrl] nvarchar(2000) NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Brands] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[Categories] (
        [Id] nvarchar(64) NOT NULL,
        [Slug] nvarchar(150) NOT NULL,
        [ParentId] nvarchar(64) NULL,
        [ImageUrl] nvarchar(2000) NOT NULL,
        [SortOrder] int NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Categories] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Categories_Categories_ParentId] FOREIGN KEY ([ParentId]) REFERENCES [catalog].[Categories] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[AttributeOptions] (
        [AttributeId] nvarchar(64) NOT NULL,
        [Id] nvarchar(64) NOT NULL,
        [Value] nvarchar(400) NOT NULL,
        [LabelFa] nvarchar(2000) NOT NULL,
        [LabelEn] nvarchar(2000) NOT NULL,
        [SortOrder] int NOT NULL,
        CONSTRAINT [PK_AttributeOptions] PRIMARY KEY ([AttributeId], [Id]),
        CONSTRAINT [FK_AttributeOptions_AttributeDefinitions_AttributeId] FOREIGN KEY ([AttributeId]) REFERENCES [catalog].[AttributeDefinitions] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[AttributeTranslation] (
        [AttributeId] nvarchar(64) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [Name] nvarchar(2000) NOT NULL,
        [Unit] nvarchar(2000) NULL,
        CONSTRAINT [PK_AttributeTranslation] PRIMARY KEY ([AttributeId], [Locale]),
        CONSTRAINT [FK_AttributeTranslation_AttributeDefinitions_AttributeId] FOREIGN KEY ([AttributeId]) REFERENCES [catalog].[AttributeDefinitions] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[CategoryAttributes] (
        [CategoryId] nvarchar(64) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [IsRequired] bit NOT NULL,
        [IsFilterable] bit NOT NULL,
        [IsComparable] bit NOT NULL,
        [ShowInSpecs] bit NOT NULL,
        [IsVariantAxis] bit NOT NULL,
        [GroupName] nvarchar(2000) NOT NULL,
        [SortOrder] int NOT NULL,
        CONSTRAINT [PK_CategoryAttributes] PRIMARY KEY ([CategoryId], [AttributeId]),
        CONSTRAINT [FK_CategoryAttributes_AttributeDefinitions_AttributeId] FOREIGN KEY ([AttributeId]) REFERENCES [catalog].[AttributeDefinitions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_CategoryAttributes_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [catalog].[Categories] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[CategoryTranslation] (
        [CategoryId] nvarchar(64) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [Name] nvarchar(200) NOT NULL,
        [Description] nvarchar(max) NOT NULL,
        [SeoTitle] nvarchar(2000) NOT NULL,
        [SeoDescription] nvarchar(max) NOT NULL,
        CONSTRAINT [PK_CategoryTranslation] PRIMARY KEY ([CategoryId], [Locale]),
        CONSTRAINT [FK_CategoryTranslation_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [catalog].[Categories] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[Products] (
        [Id] nvarchar(64) NOT NULL,
        [SellerId] nvarchar(64) NOT NULL,
        [CategoryId] nvarchar(64) NOT NULL,
        [BrandId] nvarchar(64) NOT NULL,
        [Slug] nvarchar(150) NOT NULL,
        [Status] nvarchar(20) NOT NULL,
        [IsDigital] bit NOT NULL,
        [Featured] bit NOT NULL,
        [PublishAt] datetimeoffset NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Products] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Product_Status] CHECK ([Status] IN ('Draft','Published','Hidden')),
        CONSTRAINT [FK_Products_Brands_BrandId] FOREIGN KEY ([BrandId]) REFERENCES [catalog].[Brands] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Products_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [catalog].[Categories] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductAttributeValue] (
        [ProductId] nvarchar(64) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [ValueTextFa] nvarchar(2000) NULL,
        [ValueTextEn] nvarchar(2000) NULL,
        [ValueNumber] decimal(28,8) NULL,
        [ValueBool] bit NULL,
        [ValueOptionId] nvarchar(64) NULL,
        CONSTRAINT [PK_ProductAttributeValue] PRIMARY KEY ([ProductId], [AttributeId]),
        CONSTRAINT [FK_ProductAttributeValue_AttributeDefinitions_AttributeId] FOREIGN KEY ([AttributeId]) REFERENCES [catalog].[AttributeDefinitions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ProductAttributeValue_AttributeOptions_AttributeId_ValueOptionId] FOREIGN KEY ([AttributeId], [ValueOptionId]) REFERENCES [catalog].[AttributeOptions] ([AttributeId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ProductAttributeValue_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductCreditPlan] (
        [ProductId] nvarchar(64) NOT NULL,
        [PlanId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_ProductCreditPlan] PRIMARY KEY ([ProductId], [PlanId]),
        CONSTRAINT [FK_ProductCreditPlan_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductMedia] (
        [Id] nvarchar(64) NOT NULL,
        [ProductId] nvarchar(64) NOT NULL,
        [VariantId] nvarchar(64) NULL,
        [Url] nvarchar(1500) NOT NULL,
        [Type] nvarchar(2000) NOT NULL,
        [SortOrder] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_ProductMedia] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ProductMedia_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductPurchaseMethod] (
        [ProductId] nvarchar(64) NOT NULL,
        [MethodId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_ProductPurchaseMethod] PRIMARY KEY ([ProductId], [MethodId]),
        CONSTRAINT [FK_ProductPurchaseMethod_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductTranslation] (
        [ProductId] nvarchar(64) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [Name] nvarchar(250) NOT NULL,
        [Description] nvarchar(max) NOT NULL,
        [Badge] nvarchar(2000) NULL,
        CONSTRAINT [PK_ProductTranslation] PRIMARY KEY ([ProductId], [Locale]),
        CONSTRAINT [FK_ProductTranslation_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[Variants] (
        [Id] nvarchar(64) NOT NULL,
        [ProductId] nvarchar(64) NOT NULL,
        [Sku] nvarchar(80) NOT NULL,
        [Barcode] nvarchar(2000) NULL,
        [PriceRial] bigint NOT NULL,
        [CompareAtPriceRial] bigint NULL,
        [Color] nvarchar(2000) NOT NULL,
        [ColorNameFa] nvarchar(2000) NOT NULL,
        [ColorNameEn] nvarchar(2000) NOT NULL,
        [LabelFa] nvarchar(2000) NOT NULL,
        [LabelEn] nvarchar(2000) NOT NULL,
        [WarrantyFa] nvarchar(2000) NOT NULL,
        [WarrantyEn] nvarchar(2000) NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Variants] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Variant_CompareAt] CHECK ([CompareAtPriceRial] IS NULL OR [CompareAtPriceRial] >= [PriceRial]),
        CONSTRAINT [CK_Variant_Price] CHECK ([PriceRial] >= 0),
        CONSTRAINT [FK_Variants_Products_ProductId] FOREIGN KEY ([ProductId]) REFERENCES [catalog].[Products] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[ProductAttributeSelection] (
        [ProductId] nvarchar(64) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [OptionId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_ProductAttributeSelection] PRIMARY KEY ([ProductId], [AttributeId], [OptionId]),
        CONSTRAINT [FK_ProductAttributeSelection_AttributeOptions_AttributeId_OptionId] FOREIGN KEY ([AttributeId], [OptionId]) REFERENCES [catalog].[AttributeOptions] ([AttributeId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ProductAttributeSelection_ProductAttributeValue_ProductId_AttributeId] FOREIGN KEY ([ProductId], [AttributeId]) REFERENCES [catalog].[ProductAttributeValue] ([ProductId], [AttributeId]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[PriceHistory] (
        [Id] nvarchar(64) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [OldPrice] bigint NOT NULL,
        [NewPrice] bigint NOT NULL,
        [ChangedBy] nvarchar(2000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_PriceHistory] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_PriceHistory_Variants_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [catalog].[Variants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[VariantAttributeValue] (
        [VariantId] nvarchar(64) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [ValueTextFa] nvarchar(2000) NULL,
        [ValueTextEn] nvarchar(2000) NULL,
        [ValueNumber] decimal(28,8) NULL,
        [ValueBool] bit NULL,
        [ValueOptionId] nvarchar(64) NULL,
        CONSTRAINT [PK_VariantAttributeValue] PRIMARY KEY ([VariantId], [AttributeId]),
        CONSTRAINT [FK_VariantAttributeValue_AttributeDefinitions_AttributeId] FOREIGN KEY ([AttributeId]) REFERENCES [catalog].[AttributeDefinitions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_VariantAttributeValue_AttributeOptions_AttributeId_ValueOptionId] FOREIGN KEY ([AttributeId], [ValueOptionId]) REFERENCES [catalog].[AttributeOptions] ([AttributeId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_VariantAttributeValue_Variants_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [catalog].[Variants] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE TABLE [catalog].[VariantPurchaseMethod] (
        [VariantId] nvarchar(64) NOT NULL,
        [MethodId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_VariantPurchaseMethod] PRIMARY KEY ([VariantId], [MethodId]),
        CONSTRAINT [FK_VariantPurchaseMethod_Variants_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [catalog].[Variants] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AttributeDefinitions_Key] ON [catalog].[AttributeDefinitions] ([Key]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AttributeOptions_AttributeId_Value] ON [catalog].[AttributeOptions] ([AttributeId], [Value]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Brands_Slug] ON [catalog].[Brands] ([Slug]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_Categories_ParentId] ON [catalog].[Categories] ([ParentId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Categories_Slug] ON [catalog].[Categories] ([Slug]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_CategoryAttributes_AttributeId] ON [catalog].[CategoryAttributes] ([AttributeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_PriceHistory_VariantId] ON [catalog].[PriceHistory] ([VariantId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductAttributeSelection_AttributeId_OptionId] ON [catalog].[ProductAttributeSelection] ([AttributeId], [OptionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductAttributeValue_AttributeId_ValueBool] ON [catalog].[ProductAttributeValue] ([AttributeId], [ValueBool]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductAttributeValue_AttributeId_ValueNumber] ON [catalog].[ProductAttributeValue] ([AttributeId], [ValueNumber]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductAttributeValue_AttributeId_ValueOptionId] ON [catalog].[ProductAttributeValue] ([AttributeId], [ValueOptionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductMedia_ProductId] ON [catalog].[ProductMedia] ([ProductId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_Products_BrandId] ON [catalog].[Products] ([BrandId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_Products_CategoryId_Status] ON [catalog].[Products] ([CategoryId], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Products_Slug] ON [catalog].[Products] ([Slug]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_ProductTranslation_Name] ON [catalog].[ProductTranslation] ([Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_VariantAttributeValue_AttributeId_ValueNumber] ON [catalog].[VariantAttributeValue] ([AttributeId], [ValueNumber]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_VariantAttributeValue_AttributeId_ValueOptionId] ON [catalog].[VariantAttributeValue] ([AttributeId], [ValueOptionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE INDEX [IX_Variants_ProductId] ON [catalog].[Variants] ([ProductId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Variants_Sku] ON [catalog].[Variants] ([Sku]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094437_CatalogInitial'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094437_CatalogInitial', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[Variants] ADD [SearchSku] nvarchar(500) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[ProductTranslation] ADD [SearchName] nvarchar(500) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[Brands] ADD [SearchName] nvarchar(500) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    CREATE INDEX [IX_Variants_SearchSku] ON [catalog].[Variants] ([SearchSku]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    CREATE INDEX [IX_ProductTranslation_SearchName] ON [catalog].[ProductTranslation] ([SearchName]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    CREATE INDEX [IX_Brands_SearchName] ON [catalog].[Brands] ([SearchName]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113015_CatalogSearchFields'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022113015_CatalogSearchFields', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022131256_FacetSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[VariantAttributeValue] ADD [FacetSearch] nvarchar(max) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022131256_FacetSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[ProductAttributeValue] ADD [FacetSearch] nvarchar(max) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022131256_FacetSearchFields'
)
BEGIN
    ALTER TABLE [catalog].[AttributeOptions] ADD [FacetSearch] nvarchar(max) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022131256_FacetSearchFields'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022131256_FacetSearchFields', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    ALTER TABLE [catalog].[ProductMedia] ADD [AssetId] nvarchar(32) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    CREATE TABLE [catalog].[PublicImages] (
        [Id] nvarchar(32) NOT NULL,
        [CreatedBy] nvarchar(64) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [Status] nvarchar(16) NOT NULL,
        [OriginalSha256] nvarchar(64) NOT NULL,
        [InputBytes] int NOT NULL,
        [Width] int NOT NULL,
        [Height] int NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_PublicImages] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_PublicImage_Size] CHECK ([InputBytes] > 0 AND [InputBytes] <= 8388608 AND [Width] > 0 AND [Height] > 0),
        CONSTRAINT [CK_PublicImage_Status] CHECK ([Status] IN ('Staged','Ready','Failed'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    CREATE TABLE [catalog].[PublicImageVariants] (
        [AssetId] nvarchar(32) NOT NULL,
        [Name] nvarchar(8) NOT NULL,
        [Width] int NOT NULL,
        [Height] int NOT NULL,
        [Bytes] int NOT NULL,
        [Sha256] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_PublicImageVariants] PRIMARY KEY ([AssetId], [Name]),
        CONSTRAINT [CK_PublicImageVariant_Name] CHECK ([Name] IN ('thumb','card','zoom')),
        CONSTRAINT [CK_PublicImageVariant_Size] CHECK ([Bytes] > 0 AND [Bytes] <= 8388608 AND [Width] > 0 AND [Height] > 0),
        CONSTRAINT [FK_PublicImageVariants_PublicImages_AssetId] FOREIGN KEY ([AssetId]) REFERENCES [catalog].[PublicImages] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    CREATE INDEX [IX_ProductMedia_AssetId] ON [catalog].[ProductMedia] ([AssetId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    CREATE INDEX [IX_PublicImages_Status_CreatedAt] ON [catalog].[PublicImages] ([Status], [CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    ALTER TABLE [catalog].[ProductMedia] ADD CONSTRAINT [FK_ProductMedia_PublicImages_AssetId] FOREIGN KEY ([AssetId]) REFERENCES [catalog].[PublicImages] ([Id]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022141130_PublicCatalogueImages'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022141130_PublicCatalogueImages', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    ALTER TABLE [catalog].[PublicImages] DROP CONSTRAINT [CK_PublicImage_Status];
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    ALTER TABLE [catalog].[PublicImages] ADD [CleanupLeaseExpiresAt] datetimeoffset NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    ALTER TABLE [catalog].[PublicImages] ADD [CleanupLeaseId] nvarchar(32) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    ALTER TABLE [catalog].[PublicImages] ADD [LastCleanupAt] datetimeoffset NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    EXEC(N'ALTER TABLE [catalog].[PublicImages] ADD CONSTRAINT [CK_PublicImage_Status] CHECK ([Status] IN (''Staged'',''Ready'',''Failed'',''Cleaning'',''Purged''))');
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022152107_PublicImageCleanupLeases'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022152107_PublicImageCleanupLeases', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152919_MarketModelProjection'
)
BEGIN
    EXEC(N'CREATE VIEW [catalog].[MarketModelsV1] AS
    SELECT p.[Id] AS [ModelId],p.[Slug],p.[CategoryId],p.[BrandId],COALESCE(b.[Name],N'''') AS [Brand],
     COALESCE(fa.[Name],N'''') AS [NameFa],COALESCE(en.[Name],N'''') AS [NameEn],
     COALESCE(fa.[SearchName],N'''') AS [SearchFa],COALESCE(en.[SearchName],N'''') AS [SearchEn],
     CONVERT(varbinary(8),p.[Version]) AS [Version],
     CONVERT(bit,CASE WHEN p.[Status]<>''Hidden'' AND p.[IsDigital]=0 AND c.[IsActive]=1 AND b.[IsActive]=1
     AND LEN(LTRIM(RTRIM(COALESCE(fa.[Name],N''''))))>0 AND LEN(LTRIM(RTRIM(COALESCE(en.[Name],N''''))))>0
     AND EXISTS(SELECT 1 FROM [catalog].[ProductMedia] media WHERE media.[ProductId]=p.[Id])
     AND NOT EXISTS(SELECT 1 FROM [catalog].[CategoryAttributes] ca WHERE ca.[CategoryId]=p.[CategoryId] AND ca.[IsRequired]=1
       AND NOT EXISTS(SELECT 1 FROM [catalog].[ProductAttributeValue] pv WHERE pv.[ProductId]=p.[Id] AND pv.[AttributeId]=ca.[AttributeId]))
     THEN 1 ELSE 0 END) AS [IsEligible]
    FROM [catalog].[Products] p
    LEFT JOIN [catalog].[Categories] c ON c.[Id]=p.[CategoryId]
    LEFT JOIN [catalog].[Brands] b ON b.[Id]=p.[BrandId]
    LEFT JOIN [catalog].[ProductTranslation] fa ON fa.[ProductId]=p.[Id] AND fa.[Locale]=''fa''
    LEFT JOIN [catalog].[ProductTranslation] en ON en.[ProductId]=p.[Id] AND en.[Locale]=''en'' ');
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152919_MarketModelProjection'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023152919_MarketModelProjection', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    CREATE TABLE [catalog].[AccountingProductLinks] (
        [Id] nvarchar(32) NOT NULL,
        [Provider] nvarchar(16) NOT NULL,
        [CompanyKey] nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        [ExternalItemId] nvarchar(120) COLLATE Latin1_General_100_BIN2 NOT NULL,
        [ExternalCode] nvarchar(120) NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [IsActive] bit NOT NULL,
        [SearchText] nvarchar(500) NOT NULL,
        [CreatedBy] nvarchar(64) NOT NULL,
        [ChangedBy] nvarchar(64) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ChangedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_AccountingProductLinks] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_AccountingLink_Provider] CHECK ([Provider]='holoo'),
        CONSTRAINT [FK_AccountingProductLinks_Variants_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [catalog].[Variants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AccountingProductLinks_Provider_CompanyKey_ExternalItemId] ON [catalog].[AccountingProductLinks] ([Provider], [CompanyKey], [ExternalItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_AccountingProductLinks_Provider_CompanyKey_VariantId] ON [catalog].[AccountingProductLinks] ([Provider], [CompanyKey], [VariantId]) WHERE [IsActive] = 1');
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    CREATE INDEX [IX_AccountingProductLinks_Provider_Id] ON [catalog].[AccountingProductLinks] ([Provider], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    CREATE INDEX [IX_AccountingProductLinks_VariantId] ON [catalog].[AccountingProductLinks] ([VariantId]);
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023181031_HolooProductLinks'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023181031_HolooProductLinks', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201055_MarketStoreAvailability'
)
BEGIN
    EXEC(N'CREATE OR ALTER VIEW [catalog].[MarketModelsV1] AS
    SELECT p.[Id] AS [ModelId],p.[Slug],p.[CategoryId],p.[BrandId],COALESCE(b.[Name],N'''') AS [Brand],
     COALESCE(fa.[Name],N'''') AS [NameFa],COALESCE(en.[Name],N'''') AS [NameEn],
     COALESCE(fa.[SearchName],N'''') AS [SearchFa],COALESCE(en.[SearchName],N'''') AS [SearchEn],
     CONVERT(varbinary(8),p.[Version]) AS [Version],
     CONVERT(bit,CASE WHEN p.[Status]<>''Hidden'' AND p.[IsDigital]=0 AND c.[IsActive]=1 AND b.[IsActive]=1
     AND LEN(LTRIM(RTRIM(COALESCE(fa.[Name],N''''))))>0 AND LEN(LTRIM(RTRIM(COALESCE(en.[Name],N''''))))>0
     AND EXISTS(SELECT 1 FROM [catalog].[ProductMedia] media WHERE media.[ProductId]=p.[Id])
     AND NOT EXISTS(SELECT 1 FROM [catalog].[CategoryAttributes] ca WHERE ca.[CategoryId]=p.[CategoryId] AND ca.[IsRequired]=1
       AND NOT EXISTS(SELECT 1 FROM [catalog].[ProductAttributeValue] pv WHERE pv.[ProductId]=p.[Id] AND pv.[AttributeId]=ca.[AttributeId]))
     THEN 1 ELSE 0 END) AS [IsEligible]

    ,CONVERT(bit,CASE WHEN p.[Status]=''Published'' AND (p.[PublishAt] IS NULL OR p.[PublishAt]<=SYSUTCDATETIME())
     AND c.[IsActive]=1 AND b.[IsActive]=1
     AND EXISTS(SELECT 1 FROM [catalog].[Variants] v JOIN [inventory].[AvailableStockV1] stock ON stock.[VariantId]=v.[Id]
     WHERE v.[ProductId]=p.[Id] AND v.[IsActive]=1 AND stock.[Available]>0)
     THEN 1 ELSE 0 END) AS [HasAvailableStoreOffer]
    FROM [catalog].[Products] p
    LEFT JOIN [catalog].[Categories] c ON c.[Id]=p.[CategoryId]
    LEFT JOIN [catalog].[Brands] b ON b.[Id]=p.[BrandId]
    LEFT JOIN [catalog].[ProductTranslation] fa ON fa.[ProductId]=p.[Id] AND fa.[Locale]=''fa''
    LEFT JOIN [catalog].[ProductTranslation] en ON en.[ProductId]=p.[Id] AND en.[Locale]=''en'' ');
END;

IF NOT EXISTS (
    SELECT * FROM [catalog].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201055_MarketStoreAvailability'
)
BEGIN
    INSERT INTO [catalog].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023201055_MarketStoreAvailability', N'10.0.12');
END;

COMMIT;
GO

