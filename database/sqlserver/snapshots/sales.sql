IF OBJECT_ID(N'[sales].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'sales') IS NULL EXEC(N'CREATE SCHEMA [sales];');
    CREATE TABLE [sales].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    IF SCHEMA_ID(N'sales') IS NULL EXEC(N'CREATE SCHEMA [sales];');
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    CREATE TABLE [sales].[Carts] (
        [Id] nvarchar(32) NOT NULL,
        [OwnerId] nvarchar(64) NULL,
        [GuestTokenHash] varchar(64) NULL,
        [GuestExpiresAt] datetimeoffset NULL,
        [MergedIntoCartId] nvarchar(32) NULL,
        [Revision] bigint NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Carts] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Cart_Identity] CHECK (([OwnerId] IS NOT NULL AND [GuestTokenHash] IS NULL AND [GuestExpiresAt] IS NULL AND [MergedIntoCartId] IS NULL) OR ([OwnerId] IS NULL AND [GuestTokenHash] IS NOT NULL AND [GuestExpiresAt] IS NOT NULL)),
        CONSTRAINT [CK_Cart_Merge] CHECK ([MergedIntoCartId] IS NULL OR [MergedIntoCartId] <> [Id]),
        CONSTRAINT [CK_Cart_Revision] CHECK ([Revision] >= 0),
        CONSTRAINT [FK_Carts_Carts_MergedIntoCartId] FOREIGN KEY ([MergedIntoCartId]) REFERENCES [sales].[Carts] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    CREATE TABLE [sales].[CartLines] (
        [CartId] nvarchar(32) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [Quantity] int NOT NULL,
        CONSTRAINT [PK_CartLines] PRIMARY KEY ([CartId], [VariantId]),
        CONSTRAINT [CK_CartLine_Quantity] CHECK ([Quantity] > 0 AND [Quantity] <= 1000000),
        CONSTRAINT [FK_CartLines_Carts_CartId] FOREIGN KEY ([CartId]) REFERENCES [sales].[Carts] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    CREATE INDEX [IX_Carts_GuestExpiresAt] ON [sales].[Carts] ([GuestExpiresAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Carts_GuestTokenHash] ON [sales].[Carts] ([GuestTokenHash]) WHERE [GuestTokenHash] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    CREATE INDEX [IX_Carts_MergedIntoCartId] ON [sales].[Carts] ([MergedIntoCartId]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Carts_OwnerId] ON [sales].[Carts] ([OwnerId]) WHERE [OwnerId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022165108_ServerCarts'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022165108_ServerCarts', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    CREATE TABLE [sales].[CheckoutQuotes] (
        [Id] nvarchar(32) NOT NULL,
        [ActorKey] varchar(64) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [CartId] nvarchar(32) NOT NULL,
        [CartVersion] nvarchar(12) NOT NULL,
        [PricingFingerprint] varchar(64) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [ItemsSubtotalRial] bigint NOT NULL,
        [MarkupRial] bigint NOT NULL,
        [DownPaymentRial] bigint NOT NULL,
        [GoodsTotalRial] bigint NOT NULL,
        [ShippingRial] bigint NULL,
        [TaxRial] bigint NULL,
        [PayableTotalRial] bigint NULL,
        [ResponseJson] nvarchar(max) NOT NULL,
        CONSTRAINT [PK_CheckoutQuotes] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Quote_Amounts] CHECK ([ItemsSubtotalRial]>=0 AND [MarkupRial]>=0 AND [DownPaymentRial]>=0 AND [DownPaymentRial]<=[ItemsSubtotalRial] AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND ([ShippingRial] IS NULL OR [ShippingRial]>=0) AND ([TaxRial] IS NULL OR [TaxRial]>=0) AND ([PayableTotalRial] IS NULL OR [PayableTotalRial]>=0)),
        CONSTRAINT [CK_Quote_Expiry] CHECK ([ExpiresAt]>[CreatedAt]),
        CONSTRAINT [CK_Quote_Response] CHECK (ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=1048576)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    CREATE TABLE [sales].[CheckoutQuoteInstallments] (
        [QuoteId] nvarchar(32) NOT NULL,
        [Sequence] int NOT NULL,
        [MonthOffset] int NOT NULL,
        [AmountRial] bigint NOT NULL,
        CONSTRAINT [PK_CheckoutQuoteInstallments] PRIMARY KEY ([QuoteId], [Sequence]),
        CONSTRAINT [CK_QuoteCheque_Amount] CHECK ([Sequence] BETWEEN 1 AND 60 AND [MonthOffset] BETWEEN 1 AND 60 AND [AmountRial]>0),
        CONSTRAINT [FK_CheckoutQuoteInstallments_CheckoutQuotes_QuoteId] FOREIGN KEY ([QuoteId]) REFERENCES [sales].[CheckoutQuotes] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    CREATE TABLE [sales].[CheckoutQuoteLines] (
        [QuoteId] nvarchar(32) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [ProductId] nvarchar(64) NOT NULL,
        [SellerId] nvarchar(64) NOT NULL,
        [CategoryId] nvarchar(64) NOT NULL,
        [Sku] nvarchar(80) NOT NULL,
        [Name] nvarchar(250) NOT NULL,
        [Label] nvarchar(max) NOT NULL,
        [Warranty] nvarchar(max) NOT NULL,
        [PriceVersion] nvarchar(12) NOT NULL,
        [IsDigital] bit NOT NULL,
        [Quantity] int NOT NULL,
        [UnitPriceRial] bigint NOT NULL,
        [LineTotalRial] bigint NOT NULL,
        CONSTRAINT [PK_CheckoutQuoteLines] PRIMARY KEY ([QuoteId], [VariantId]),
        CONSTRAINT [CK_QuoteLine_Amount] CHECK ([Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0),
        CONSTRAINT [FK_CheckoutQuoteLines_CheckoutQuotes_QuoteId] FOREIGN KEY ([QuoteId]) REFERENCES [sales].[CheckoutQuotes] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    CREATE UNIQUE INDEX [IX_CheckoutQuotes_ActorKey_RequestId] ON [sales].[CheckoutQuotes] ([ActorKey], [RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    CREATE INDEX [IX_CheckoutQuotes_ExpiresAt] ON [sales].[CheckoutQuotes] ([ExpiresAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022193642_CheckoutQuotes'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022193642_CheckoutQuotes', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [ChargePolicyVersion] nvarchar(12) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [ShippingMode] varchar(16) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [TaxIncluded] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [TaxMode] varchar(16) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [TaxRateBasisPoints] int NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    ALTER TABLE [sales].[CheckoutQuotes] ADD [TaxableBaseRial] bigint NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    CREATE TABLE [sales].[CheckoutChargePolicies] (
        [Id] int NOT NULL,
        [ShippingMode] varchar(16) NOT NULL,
        [ShippingNameFa] nvarchar(200) NOT NULL,
        [ShippingNameEn] nvarchar(200) NOT NULL,
        [ShippingDescriptionFa] nvarchar(2000) NOT NULL,
        [ShippingDescriptionEn] nvarchar(2000) NOT NULL,
        [ShippingFeeRial] bigint NULL,
        [ShippingFreeFromRial] bigint NULL,
        [TaxMode] varchar(16) NOT NULL,
        [TaxRateBasisPoints] int NULL,
        [TaxBase] varchar(16) NOT NULL,
        [TaxRounding] varchar(16) NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_CheckoutChargePolicies] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_ChargePolicy_Shipping] CHECK (([ShippingMode] IN ('unconfigured','free') AND [ShippingFeeRial] IS NULL AND [ShippingFreeFromRial] IS NULL) OR ([ShippingMode]='flat' AND [ShippingFeeRial] IS NOT NULL AND [ShippingFeeRial]>0 AND ([ShippingFreeFromRial] IS NULL OR [ShippingFreeFromRial]>0))),
        CONSTRAINT [CK_ChargePolicy_Singleton] CHECK ([Id]=1),
        CONSTRAINT [CK_ChargePolicy_Tax] CHECK (([TaxMode] IN ('unconfigured','exempt') AND [TaxRateBasisPoints] IS NULL) OR ([TaxMode] IN ('exclusive','inclusive') AND [TaxRateBasisPoints] IS NOT NULL AND [TaxRateBasisPoints] BETWEEN 1 AND 10000)),
        CONSTRAINT [CK_ChargePolicy_TaxRule] CHECK ([TaxBase] IN ('items','goods','goods_shipping') AND [TaxRounding] IN ('down','up','half_up'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    EXEC(N'ALTER TABLE [sales].[CheckoutQuotes] ADD CONSTRAINT [CK_Quote_Tax] CHECK (([TaxableBaseRial] IS NULL OR [TaxableBaseRial]>=0) AND ([TaxRateBasisPoints] IS NULL OR [TaxRateBasisPoints] BETWEEN 1 AND 10000))');
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022200519_CheckoutChargePolicies'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022200519_CheckoutChargePolicies', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE TABLE [sales].[CheckoutOrderSettings] (
        [Id] int NOT NULL,
        [TemporaryOrdersEnabled] bit NOT NULL,
        [ReservationMinutes] int NOT NULL,
        [MaxOpenOrdersPerCustomer] int NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_CheckoutOrderSettings] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_OrderSettings_Limits] CHECK ([ReservationMinutes] BETWEEN 1 AND 60 AND [MaxOpenOrdersPerCustomer] BETWEEN 1 AND 10),
        CONSTRAINT [CK_OrderSettings_Singleton] CHECK ([Id]=1)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE TABLE [sales].[Orders] (
        [Id] nvarchar(32) NOT NULL,
        [Number] bigint NOT NULL IDENTITY,
        [OwnerId] nvarchar(64) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [QuoteId] nvarchar(32) NOT NULL,
        [PricingFingerprint] varchar(64) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [State] nvarchar(24) NOT NULL,
        [ReservationId] nvarchar(32) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [ChangedAt] datetimeoffset NOT NULL,
        [ContactName] nvarchar(100) NOT NULL,
        [ContactPhone] varchar(11) NOT NULL,
        [ShippingRequired] bit NOT NULL,
        [CountryCode] varchar(2) NULL,
        [Province] nvarchar(100) NULL,
        [City] nvarchar(100) NULL,
        [Address] nvarchar(2000) NULL,
        [PostalCode] varchar(10) NULL,
        [Note] nvarchar(500) NOT NULL,
        [MethodId] nvarchar(64) NOT NULL,
        [MethodName] nvarchar(200) NOT NULL,
        [ShippingName] nvarchar(200) NOT NULL,
        [ItemsSubtotalRial] bigint NOT NULL,
        [GoodsTotalRial] bigint NOT NULL,
        [ShippingRial] bigint NOT NULL,
        [TaxRial] bigint NOT NULL,
        [PayableTotalRial] bigint NOT NULL,
        [TaxIncluded] bit NOT NULL,
        [QuoteSnapshotJson] nvarchar(max) NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Orders] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Order_Amounts] CHECK ([ItemsSubtotalRial]>=0 AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND [ShippingRial]>=0 AND [TaxRial]>=0 AND [PayableTotalRial]>0 AND CAST([PayableTotalRial] AS decimal(38,0))=CAST([GoodsTotalRial] AS decimal(38,0))+[ShippingRial]+CASE WHEN [TaxIncluded]=1 THEN 0 ELSE [TaxRial] END),
        CONSTRAINT [CK_Order_Dates] CHECK ([ExpiresAt]>[CreatedAt] AND [ChangedAt]>=[CreatedAt]),
        CONSTRAINT [CK_Order_Delivery] CHECK (([ShippingRequired]=0 AND [CountryCode] IS NULL AND [Province] IS NULL AND [City] IS NULL AND [Address] IS NULL AND [PostalCode] IS NULL) OR ([ShippingRequired]=1 AND [CountryCode]='IR' AND [Province] IS NOT NULL AND [City] IS NOT NULL AND [Address] IS NOT NULL AND [PostalCode] IS NOT NULL)),
        CONSTRAINT [CK_Order_QuoteSnapshot] CHECK (ISJSON([QuoteSnapshotJson])=1 AND DATALENGTH([QuoteSnapshotJson])<=1048576),
        CONSTRAINT [CK_Order_State] CHECK ([State] IN ('AwaitingPayment','Paid','Cancelled','Expired','Fulfilled')),
        CONSTRAINT [FK_Orders_CheckoutQuotes_QuoteId] FOREIGN KEY ([QuoteId]) REFERENCES [sales].[CheckoutQuotes] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE TABLE [sales].[OrderEvents] (
        [Id] bigint NOT NULL IDENTITY,
        [OrderId] nvarchar(32) NOT NULL,
        [State] nvarchar(24) NOT NULL,
        [ActorId] nvarchar(64) NOT NULL,
        [Reason] nvarchar(100) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_OrderEvents] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OrderEvents_Orders_OrderId] FOREIGN KEY ([OrderId]) REFERENCES [sales].[Orders] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE TABLE [sales].[OrderLines] (
        [OrderId] nvarchar(32) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [ProductId] nvarchar(64) NOT NULL,
        [SellerId] nvarchar(64) NOT NULL,
        [Sku] nvarchar(80) NOT NULL,
        [Name] nvarchar(250) NOT NULL,
        [Label] nvarchar(max) NOT NULL,
        [Warranty] nvarchar(max) NOT NULL,
        [PriceVersion] nvarchar(12) NOT NULL,
        [IsDigital] bit NOT NULL,
        [Quantity] int NOT NULL,
        [UnitPriceRial] bigint NOT NULL,
        [LineTotalRial] bigint NOT NULL,
        CONSTRAINT [PK_OrderLines] PRIMARY KEY ([OrderId], [VariantId]),
        CONSTRAINT [CK_OrderLine_Amount] CHECK ([Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]),
        CONSTRAINT [FK_OrderLines_Orders_OrderId] FOREIGN KEY ([OrderId]) REFERENCES [sales].[Orders] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE INDEX [IX_OrderEvents_OrderId_Id] ON [sales].[OrderEvents] ([OrderId], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Orders_Number] ON [sales].[Orders] ([Number]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE INDEX [IX_Orders_OwnerId_CreatedAt_Id] ON [sales].[Orders] ([OwnerId], [CreatedAt], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Orders_OwnerId_RequestId] ON [sales].[Orders] ([OwnerId], [RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Orders_QuoteId] ON [sales].[Orders] ([QuoteId]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    CREATE INDEX [IX_Orders_State_ExpiresAt] ON [sales].[Orders] ([State], [ExpiresAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022211322_TemporaryOrders'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022211322_TemporaryOrders', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023032409_CustomerAddressBook'
)
BEGIN
    CREATE TABLE [sales].[AddressBooks] (
        [OwnerId] nvarchar(64) NOT NULL,
        [Revision] bigint NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_AddressBooks] PRIMARY KEY ([OwnerId]),
        CONSTRAINT [CK_AddressBook_Revision] CHECK ([Revision]>=0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023032409_CustomerAddressBook'
)
BEGIN
    CREATE TABLE [sales].[Addresses] (
        [Id] nvarchar(32) NOT NULL,
        [OwnerId] nvarchar(64) NOT NULL,
        [ProtectedData] varchar(max) NOT NULL,
        [IsDefault] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Addresses] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Address_ProtectedLength] CHECK (LEN([ProtectedData]) BETWEEN 1 AND 32768),
        CONSTRAINT [FK_Addresses_AddressBooks_OwnerId] FOREIGN KEY ([OwnerId]) REFERENCES [sales].[AddressBooks] ([OwnerId]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023032409_CustomerAddressBook'
)
BEGIN
    CREATE INDEX [IX_Addresses_Owner] ON [sales].[Addresses] ([OwnerId], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023032409_CustomerAddressBook'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UX_Addresses_DefaultOwner] ON [sales].[Addresses] ([OwnerId]) WHERE [IsDefault]=1');
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023032409_CustomerAddressBook'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023032409_CustomerAddressBook', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201115_CartSourcingLines'
)
BEGIN
    CREATE TABLE [sales].[CartSourcingLines] (
        [CartId] nvarchar(32) NOT NULL,
        [ListingId] nvarchar(32) NOT NULL,
        [Quantity] int NOT NULL,
        CONSTRAINT [PK_CartSourcingLines] PRIMARY KEY ([CartId], [ListingId]),
        CONSTRAINT [CK_CartSourcingLine_Quantity] CHECK ([Quantity] > 0 AND [Quantity] <= 1000000),
        CONSTRAINT [FK_CartSourcingLines_Carts_CartId] FOREIGN KEY ([CartId]) REFERENCES [sales].[Carts] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [sales].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023201115_CartSourcingLines'
)
BEGIN
    INSERT INTO [sales].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023201115_CartSourcingLines', N'10.0.12');
END;

COMMIT;
GO

