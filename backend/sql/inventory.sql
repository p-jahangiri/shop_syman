IF OBJECT_ID(N'[inventory].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'inventory') IS NULL EXEC(N'CREATE SCHEMA [inventory];');
    CREATE TABLE [inventory].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    IF SCHEMA_ID(N'inventory') IS NULL EXEC(N'CREATE SCHEMA [inventory];');
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    CREATE TABLE [inventory].[Movements] (
        [Id] bigint NOT NULL IDENTITY,
        [VariantId] nvarchar(64) NOT NULL,
        [Delta] int NOT NULL,
        [Balance] int NOT NULL,
        [Reason] nvarchar(500) NOT NULL,
        [ActorId] nvarchar(64) NOT NULL,
        [RequestId] nvarchar(64) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Movements] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    CREATE TABLE [inventory].[Stock] (
        [VariantId] nvarchar(64) NOT NULL,
        [OnHand] int NOT NULL,
        [Reserved] int NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Stock] PRIMARY KEY ([VariantId]),
        CONSTRAINT [CK_Stock_Balance] CHECK ([OnHand] >= 0 AND [Reserved] >= 0 AND [Reserved] <= [OnHand])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Movements_RequestId] ON [inventory].[Movements] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    CREATE INDEX [IX_Movements_VariantId_At] ON [inventory].[Movements] ([VariantId], [At]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094906_InventoryInitial'
)
BEGIN
    INSERT INTO [inventory].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094906_InventoryInitial', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113100_InventoryPublicAvailability'
)
BEGIN
    EXEC(N'CREATE VIEW [inventory].[AvailableStockV1] WITH SCHEMABINDING AS SELECT [VariantId], [OnHand] - [Reserved] AS [Available] FROM [inventory].[Stock];');
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022113100_InventoryPublicAvailability'
)
BEGIN
    INSERT INTO [inventory].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022113100_InventoryPublicAvailability', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE TABLE [inventory].[Reservations] (
        [Id] nvarchar(32) NOT NULL,
        [OwnerId] nvarchar(64) NOT NULL,
        [OrderId] nvarchar(32) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [State] nvarchar(16) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [ChangedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Reservations] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Reservation_Deadline] CHECK ([ExpiresAt] > [CreatedAt]),
        CONSTRAINT [CK_Reservation_State] CHECK ([State] IN ('Active','Allocated','Released','Expired','Fulfilled'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE TABLE [inventory].[ReservationEvents] (
        [Id] bigint NOT NULL IDENTITY,
        [ReservationId] nvarchar(32) NOT NULL,
        [State] nvarchar(16) NOT NULL,
        [ActorId] nvarchar(64) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ReservationEvents] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ReservationEvents_Reservations_ReservationId] FOREIGN KEY ([ReservationId]) REFERENCES [inventory].[Reservations] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE TABLE [inventory].[ReservationItems] (
        [ReservationId] nvarchar(32) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [Quantity] int NOT NULL,
        CONSTRAINT [PK_ReservationItems] PRIMARY KEY ([ReservationId], [VariantId]),
        CONSTRAINT [CK_ReservationItem_Quantity] CHECK ([Quantity] > 0 AND [Quantity] <= 1000000),
        CONSTRAINT [FK_ReservationItems_Reservations_ReservationId] FOREIGN KEY ([ReservationId]) REFERENCES [inventory].[Reservations] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ReservationItems_Stock_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [inventory].[Stock] ([VariantId]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ReservationEvents_ReservationId_State] ON [inventory].[ReservationEvents] ([ReservationId], [State]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE INDEX [IX_ReservationItems_VariantId] ON [inventory].[ReservationItems] ([VariantId]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Reservations_OrderId] ON [inventory].[Reservations] ([OrderId]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Reservations_OwnerId_RequestId] ON [inventory].[Reservations] ([OwnerId], [RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    CREATE INDEX [IX_Reservations_State_ExpiresAt_Id] ON [inventory].[Reservations] ([State], [ExpiresAt], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022163210_StockReservations'
)
BEGIN
    INSERT INTO [inventory].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022163210_StockReservations', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    ALTER TABLE [inventory].[Stock] ADD [TrackingMode] nvarchar(8) NOT NULL DEFAULT N'none';
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE TABLE [inventory].[SerialCommands] (
        [ActorId] nvarchar(64) NOT NULL,
        [RequestId] nvarchar(32) NOT NULL,
        [PayloadHash] varchar(64) NOT NULL,
        [ResponseJson] nvarchar(max) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_SerialCommands] PRIMARY KEY ([ActorId], [RequestId]),
        CONSTRAINT [CK_SerialCommand_Response] CHECK (ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE TABLE [inventory].[SerialUnits] (
        [Id] nvarchar(32) NOT NULL,
        [VariantId] nvarchar(64) NOT NULL,
        [Serial] varchar(100) NULL,
        [Imei1] varchar(15) NULL,
        [Imei2] varchar(15) NULL,
        [State] nvarchar(12) NOT NULL,
        [ReservationId] nvarchar(32) NULL,
        [OrderId] nvarchar(32) NULL,
        [WarrantyUntil] datetimeoffset NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ChangedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_SerialUnits] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_SerialUnit_Identity] CHECK ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL),
        CONSTRAINT [CK_SerialUnit_Order] CHECK (([State] IN ('available','retired') AND [ReservationId] IS NULL AND [OrderId] IS NULL AND [WarrantyUntil] IS NULL) OR ([State] IN ('assigned','delivered') AND [ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL)),
        CONSTRAINT [CK_SerialUnit_State] CHECK ([State] IN ('available','assigned','delivered','retired')),
        CONSTRAINT [FK_SerialUnits_Reservations_ReservationId] FOREIGN KEY ([ReservationId]) REFERENCES [inventory].[Reservations] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_SerialUnits_Stock_VariantId] FOREIGN KEY ([VariantId]) REFERENCES [inventory].[Stock] ([VariantId]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE TABLE [inventory].[SerialIdentifiers] (
        [Key] varchar(170) NOT NULL,
        [UnitId] nvarchar(32) NOT NULL,
        CONSTRAINT [PK_SerialIdentifiers] PRIMARY KEY ([Key]),
        CONSTRAINT [FK_SerialIdentifiers_SerialUnits_UnitId] FOREIGN KEY ([UnitId]) REFERENCES [inventory].[SerialUnits] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE TABLE [inventory].[SerialUnitEvents] (
        [Id] bigint NOT NULL IDENTITY,
        [UnitId] nvarchar(32) NOT NULL,
        [State] nvarchar(12) NOT NULL,
        [ActorId] nvarchar(64) NOT NULL,
        [Reason] nvarchar(500) NOT NULL,
        [OrderId] nvarchar(32) NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_SerialUnitEvents] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_SerialUnitEvents_SerialUnits_UnitId] FOREIGN KEY ([UnitId]) REFERENCES [inventory].[SerialUnits] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    EXEC(N'ALTER TABLE [inventory].[Stock] ADD CONSTRAINT [CK_Stock_TrackingMode] CHECK ([TrackingMode] IN (''none'',''serial'',''imei''))');
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE INDEX [IX_SerialIdentifiers_UnitId] ON [inventory].[SerialIdentifiers] ([UnitId]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE INDEX [IX_SerialUnitEvents_UnitId_Id] ON [inventory].[SerialUnitEvents] ([UnitId], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE INDEX [IX_SerialUnits_ReservationId_VariantId_State] ON [inventory].[SerialUnits] ([ReservationId], [VariantId], [State]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    CREATE INDEX [IX_SerialUnits_VariantId_State_Id] ON [inventory].[SerialUnits] ([VariantId], [State], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [inventory].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023061007_InventorySerialUnits'
)
BEGIN
    INSERT INTO [inventory].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023061007_InventorySerialUnits', N'10.0.12');
END;

COMMIT;
GO

