IF OBJECT_ID(N'[credit].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'credit') IS NULL EXEC(N'CREATE SCHEMA [credit];');
    CREATE TABLE [credit].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094908_CreditInitial'
)
BEGIN
    IF SCHEMA_ID(N'credit') IS NULL EXEC(N'CREATE SCHEMA [credit];');
END;

IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094908_CreditInitial'
)
BEGIN
    CREATE TABLE [credit].[Plans] (
        [Id] nvarchar(64) NOT NULL,
        [NameFa] nvarchar(200) NOT NULL,
        [NameEn] nvarchar(200) NOT NULL,
        [Months] int NOT NULL,
        [MarkupBasisPoints] int NOT NULL,
        [DownPaymentBasisPoints] int NOT NULL,
        [IntervalMonths] int NOT NULL,
        [Enabled] bit NOT NULL,
        [MinAmountRial] bigint NULL,
        [MaxAmountRial] bigint NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Plans] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Plan_Amount] CHECK (([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))),
        CONSTRAINT [CK_Plan_Terms] CHECK ([Months] BETWEEN 1 AND 60 AND [IntervalMonths] BETWEEN 1 AND [Months] AND [Months] % [IntervalMonths] = 0 AND [MarkupBasisPoints] BETWEEN 0 AND 100000 AND [DownPaymentBasisPoints] BETWEEN 0 AND 10000)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094908_CreditInitial'
)
BEGIN
    CREATE TABLE [credit].[PlanCategory] (
        [PlanId] nvarchar(64) NOT NULL,
        [CategoryId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_PlanCategory] PRIMARY KEY ([PlanId], [CategoryId]),
        CONSTRAINT [FK_PlanCategory_Plans_PlanId] FOREIGN KEY ([PlanId]) REFERENCES [credit].[Plans] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094908_CreditInitial'
)
BEGIN
    INSERT INTO [credit].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094908_CreditInitial', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022121338_ChequeRoundingUnit'
)
BEGIN
    ALTER TABLE [credit].[Plans] ADD [RoundingUnitRial] int NOT NULL DEFAULT 10;
END;

IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022121338_ChequeRoundingUnit'
)
BEGIN
    EXEC(N'ALTER TABLE [credit].[Plans] ADD CONSTRAINT [CK_Plan_Rounding] CHECK ([RoundingUnitRial] IN (1,10))');
END;

IF NOT EXISTS (
    SELECT * FROM [credit].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022121338_ChequeRoundingUnit'
)
BEGIN
    INSERT INTO [credit].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022121338_ChequeRoundingUnit', N'10.0.12');
END;

COMMIT;
GO

