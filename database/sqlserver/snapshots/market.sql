IF OBJECT_ID(N'[market].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'market') IS NULL EXEC(N'CREATE SCHEMA [market];');
    CREATE TABLE [market].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    IF SCHEMA_ID(N'market') IS NULL EXEC(N'CREATE SCHEMA [market];');
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    CREATE TABLE [market].[Listings] (
        [Id] nvarchar(32) NOT NULL,
        [ModelId] nvarchar(64) NOT NULL,
        [Status] nvarchar(16) NOT NULL,
        [SourceKey] nvarchar(64) NOT NULL,
        [SourceItemKey] nvarchar(120) NOT NULL,
        [SourceNameFa] nvarchar(200) NOT NULL,
        [SourceNameEn] nvarchar(200) NOT NULL,
        [SourceUrl] nvarchar(1500) NULL,
        [Availability] nvarchar(16) NOT NULL,
        [ObservedAt] datetimeoffset NULL,
        [ValidUntil] datetimeoffset NULL,
        [ReferencePriceRial] bigint NULL,
        [IsDemo] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Listings] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Market_Availability] CHECK ([Availability] IN ('unknown','available','unavailable')),
        CONSTRAINT [CK_Market_Observation] CHECK (([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])),
        CONSTRAINT [CK_Market_Price] CHECK ([ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0),
        CONSTRAINT [CK_Market_Status] CHECK ([Status] IN ('Draft','Published','Hidden'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Listings_ModelId] ON [market].[Listings] ([ModelId]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Listings_SourceKey_SourceItemKey] ON [market].[Listings] ([SourceKey], [SourceItemKey]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    CREATE INDEX [IX_Listings_Status_Id] ON [market].[Listings] ([Status], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023152920_MarketListings'
)
BEGIN
    INSERT INTO [market].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023152920_MarketListings', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023163322_MarketImportReceipts'
)
BEGIN
    CREATE TABLE [market].[ImportReceipts] (
        [ActorId] nvarchar(64) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [ResponseJson] nvarchar(max) NOT NULL,
        [RowCount] int NOT NULL,
        [ContainsDemo] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ImportReceipts] PRIMARY KEY ([ActorId], [RequestId]),
        CONSTRAINT [CK_MarketImport_Response] CHECK (ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144),
        CONSTRAINT [CK_MarketImport_Rows] CHECK ([RowCount] BETWEEN 1 AND 50)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023163322_MarketImportReceipts'
)
BEGIN
    INSERT INTO [market].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023163322_MarketImportReceipts', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingCommandReceipts] (
        [ActorId] nvarchar(64) NOT NULL,
        [Operation] nvarchar(16) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [TargetId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [ResultJson] nvarchar(max) NOT NULL,
        [ContainsDemo] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_SourcingCommandReceipts] PRIMARY KEY ([ActorId], [Operation], [RequestId]),
        CONSTRAINT [CK_SourcingReceipt_Result] CHECK (ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequests] (
        [Id] nvarchar(32) NOT NULL,
        [Number] bigint NOT NULL IDENTITY,
        [OwnerId] nvarchar(64) NOT NULL,
        [SubmitRequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [CartId] nvarchar(32) NOT NULL,
        [SubmittedCartVersion] nvarchar(12) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [State] nvarchar(16) NOT NULL,
        [ProtectedNote] varchar(max) NOT NULL,
        [ContainsDemo] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ChangedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_SourcingRequests] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_SourcingRequest_Dates] CHECK ([ChangedAt]>=[CreatedAt]),
        CONSTRAINT [CK_SourcingRequest_Locale] CHECK ([Locale] IN ('fa','en')),
        CONSTRAINT [CK_SourcingRequest_Note] CHECK (LEN([ProtectedNote]) BETWEEN 1 AND 32768),
        CONSTRAINT [CK_SourcingRequest_State] CHECK ([State] IN ('Submitted','Reviewing','Unavailable','Cancelled'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequestEvents] (
        [Id] bigint NOT NULL IDENTITY,
        [RequestId] nvarchar(32) NOT NULL,
        [ActorId] nvarchar(64) NOT NULL,
        [ActorKind] nvarchar(16) NOT NULL,
        [StateBefore] nvarchar(16) NULL,
        [StateAfter] nvarchar(16) NOT NULL,
        [ReasonCode] nvarchar(64) NOT NULL,
        [PublicMessage] nvarchar(500) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_SourcingRequestEvents] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_SourcingEvent_Actor] CHECK ([ActorKind] IN ('customer','staff','system')),
        CONSTRAINT [CK_SourcingEvent_State] CHECK (([StateBefore] IS NULL OR [StateBefore] IN ('Submitted','Reviewing','Unavailable','Cancelled')) AND [StateAfter] IN ('Submitted','Reviewing','Unavailable','Cancelled')),
        CONSTRAINT [FK_SourcingRequestEvents_SourcingRequests_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [market].[SourcingRequests] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequestLines] (
        [RequestId] nvarchar(32) NOT NULL,
        [ListingId] nvarchar(32) NOT NULL,
        [ModelId] nvarchar(64) NOT NULL,
        [Quantity] int NOT NULL,
        [Slug] nvarchar(150) NOT NULL,
        [CategoryId] nvarchar(64) NOT NULL,
        [CategoryNameFa] nvarchar(200) NOT NULL,
        [CategoryNameEn] nvarchar(200) NOT NULL,
        [BrandId] nvarchar(64) NOT NULL,
        [Brand] nvarchar(120) NOT NULL,
        [NameFa] nvarchar(250) NOT NULL,
        [NameEn] nvarchar(250) NOT NULL,
        [SearchText] nvarchar(max) NOT NULL,
        [DescriptionFa] nvarchar(max) NOT NULL,
        [DescriptionEn] nvarchar(max) NOT NULL,
        [ModelVersion] nvarchar(12) NOT NULL,
        [ModelFingerprint] varchar(64) NOT NULL,
        [ListingVersion] nvarchar(12) NOT NULL,
        [SelectionFingerprint] varchar(64) NOT NULL,
        [SourceKey] nvarchar(64) NOT NULL,
        [SourceItemKey] nvarchar(120) NOT NULL,
        [SourceNameFa] nvarchar(200) NOT NULL,
        [SourceNameEn] nvarchar(200) NOT NULL,
        [SourceUrl] nvarchar(1500) NULL,
        [Availability] nvarchar(16) NOT NULL,
        [ObservedAt] datetimeoffset NULL,
        [ValidUntil] datetimeoffset NULL,
        [ReferencePriceRial] bigint NULL,
        [ReferencePriceCurrent] bit NOT NULL,
        [IsDemo] bit NOT NULL,
        CONSTRAINT [PK_SourcingRequestLines] PRIMARY KEY ([RequestId], [ListingId]),
        CONSTRAINT [CK_SourcingLine_Availability] CHECK ([Availability] IN ('unknown','available','unavailable','stale')),
        CONSTRAINT [CK_SourcingLine_Observation] CHECK (([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL AND [ReferencePriceCurrent]=0) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])),
        CONSTRAINT [CK_SourcingLine_Price] CHECK ([ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0),
        CONSTRAINT [CK_SourcingLine_Quantity] CHECK ([Quantity] BETWEEN 1 AND 1000000),
        CONSTRAINT [FK_SourcingRequestLines_SourcingRequests_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [market].[SourcingRequests] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequestAttributes] (
        [RequestId] nvarchar(32) NOT NULL,
        [ListingId] nvarchar(32) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [Key] nvarchar(150) NOT NULL,
        [DataType] nvarchar(16) NOT NULL,
        [LabelFa] nvarchar(200) NOT NULL,
        [LabelEn] nvarchar(200) NOT NULL,
        [Unit] nvarchar(80) NULL,
        [UnitFa] nvarchar(80) NULL,
        [UnitEn] nvarchar(80) NULL,
        [TextFa] nvarchar(max) NULL,
        [TextEn] nvarchar(max) NULL,
        [Number] decimal(28,8) NULL,
        [Bool] bit NULL,
        CONSTRAINT [PK_SourcingRequestAttributes] PRIMARY KEY ([RequestId], [ListingId], [AttributeId]),
        CONSTRAINT [CK_SourcingAttribute_Type] CHECK ([DataType] IN ('Text','Number','Bool','Select','MultiSelect')),
        CONSTRAINT [CK_SourcingAttribute_Value] CHECK (([DataType]='Text' AND [TextFa] IS NOT NULL AND [TextEn] IS NOT NULL AND [Number] IS NULL AND [Bool] IS NULL) OR ([DataType]='Number' AND [Number] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Bool] IS NULL) OR ([DataType]='Bool' AND [Bool] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL) OR ([DataType] IN ('Select','MultiSelect') AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL AND [Bool] IS NULL)),
        CONSTRAINT [FK_SourcingRequestAttributes_SourcingRequestLines_RequestId_ListingId] FOREIGN KEY ([RequestId], [ListingId]) REFERENCES [market].[SourcingRequestLines] ([RequestId], [ListingId]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequestImages] (
        [RequestId] nvarchar(32) NOT NULL,
        [ListingId] nvarchar(32) NOT NULL,
        [SortOrder] int NOT NULL,
        [Url] nvarchar(1500) NOT NULL,
        CONSTRAINT [PK_SourcingRequestImages] PRIMARY KEY ([RequestId], [ListingId], [SortOrder]),
        CONSTRAINT [CK_SourcingImage_Order] CHECK ([SortOrder] BETWEEN 0 AND 23),
        CONSTRAINT [FK_SourcingRequestImages_SourcingRequestLines_RequestId_ListingId] FOREIGN KEY ([RequestId], [ListingId]) REFERENCES [market].[SourcingRequestLines] ([RequestId], [ListingId]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE TABLE [market].[SourcingRequestOptions] (
        [RequestId] nvarchar(32) NOT NULL,
        [ListingId] nvarchar(32) NOT NULL,
        [AttributeId] nvarchar(64) NOT NULL,
        [OptionId] nvarchar(64) NOT NULL,
        [LabelFa] nvarchar(200) NOT NULL,
        [LabelEn] nvarchar(200) NOT NULL,
        CONSTRAINT [PK_SourcingRequestOptions] PRIMARY KEY ([RequestId], [ListingId], [AttributeId], [OptionId]),
        CONSTRAINT [FK_SourcingRequestOptions_SourcingRequestAttributes_RequestId_ListingId_AttributeId] FOREIGN KEY ([RequestId], [ListingId], [AttributeId]) REFERENCES [market].[SourcingRequestAttributes] ([RequestId], [ListingId], [AttributeId]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE INDEX [IX_SourcingRequestEvents_RequestId_Id] ON [market].[SourcingRequestEvents] ([RequestId], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SourcingRequests_CartId_SubmittedCartVersion] ON [market].[SourcingRequests] ([CartId], [SubmittedCartVersion]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SourcingRequests_Number] ON [market].[SourcingRequests] ([Number]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE INDEX [IX_SourcingRequests_OwnerId_CreatedAt_Id] ON [market].[SourcingRequests] ([OwnerId], [CreatedAt], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SourcingRequests_OwnerId_SubmitRequestId] ON [market].[SourcingRequests] ([OwnerId], [SubmitRequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    CREATE INDEX [IX_SourcingRequests_State_CreatedAt_Id] ON [market].[SourcingRequests] ([State], [CreatedAt], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [market].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201151_SourcingRequests'
)
BEGIN
    INSERT INTO [market].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023201151_SourcingRequests', N'10.0.12');
END;

COMMIT;
GO

