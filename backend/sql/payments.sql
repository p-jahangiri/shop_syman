IF OBJECT_ID(N'[payments].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'payments') IS NULL EXEC(N'CREATE SCHEMA [payments];');
    CREATE TABLE [payments].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [payments].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094907_PaymentsInitial'
)
BEGIN
    IF SCHEMA_ID(N'payments') IS NULL EXEC(N'CREATE SCHEMA [payments];');
END;

IF NOT EXISTS (
    SELECT * FROM [payments].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094907_PaymentsInitial'
)
BEGIN
    CREATE TABLE [payments].[Methods] (
        [Id] nvarchar(64) NOT NULL,
        [Kind] nvarchar(20) NOT NULL,
        [NameFa] nvarchar(200) NOT NULL,
        [NameEn] nvarchar(200) NOT NULL,
        [DescriptionFa] nvarchar(2000) NOT NULL,
        [DescriptionEn] nvarchar(2000) NOT NULL,
        [Enabled] bit NOT NULL,
        [RequiresApproval] bit NOT NULL,
        [MinAmountRial] bigint NULL,
        [MaxAmountRial] bigint NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Methods] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Method_Amount] CHECK (([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))),
        CONSTRAINT [CK_Method_Kind] CHECK ([Kind] IN ('online','cheque','installment'))
    );
END;

IF NOT EXISTS (
    SELECT * FROM [payments].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094907_PaymentsInitial'
)
BEGIN
    CREATE TABLE [payments].[MethodCategory] (
        [MethodId] nvarchar(64) NOT NULL,
        [CategoryId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_MethodCategory] PRIMARY KEY ([MethodId], [CategoryId]),
        CONSTRAINT [FK_MethodCategory_Methods_MethodId] FOREIGN KEY ([MethodId]) REFERENCES [payments].[Methods] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [payments].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094907_PaymentsInitial'
)
BEGIN
    INSERT INTO [payments].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094907_PaymentsInitial', N'10.0.12');
END;

COMMIT;
GO

