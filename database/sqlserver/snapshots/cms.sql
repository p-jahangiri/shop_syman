IF OBJECT_ID(N'[cms].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'cms') IS NULL EXEC(N'CREATE SCHEMA [cms];');
    CREATE TABLE [cms].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [cms].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094909_CmsInitial'
)
BEGIN
    IF SCHEMA_ID(N'cms') IS NULL EXEC(N'CREATE SCHEMA [cms];');
END;

IF NOT EXISTS (
    SELECT * FROM [cms].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094909_CmsInitial'
)
BEGIN
    CREATE TABLE [cms].[Documents] (
        [Key] nvarchar(80) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [DraftJson] nvarchar(max) NOT NULL,
        [PublishedJson] nvarchar(max) NULL,
        [Revision] int NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [UpdatedBy] nvarchar(64) NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Documents] PRIMARY KEY ([Key], [Locale])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [cms].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094909_CmsInitial'
)
BEGIN
    CREATE TABLE [cms].[Revisions] (
        [Id] bigint NOT NULL IDENTITY,
        [Key] nvarchar(80) NOT NULL,
        [Locale] nvarchar(2) NOT NULL,
        [Revision] int NOT NULL,
        [Json] nvarchar(max) NOT NULL,
        [PublishedBy] nvarchar(64) NOT NULL,
        [PublishedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Revisions] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [cms].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094909_CmsInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Revisions_Key_Locale_Revision] ON [cms].[Revisions] ([Key], [Locale], [Revision]);
END;

IF NOT EXISTS (
    SELECT * FROM [cms].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094909_CmsInitial'
)
BEGIN
    INSERT INTO [cms].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094909_CmsInitial', N'10.0.12');
END;

COMMIT;
GO

