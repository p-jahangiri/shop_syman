IF OBJECT_ID(N'[identity].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'identity') IS NULL EXEC(N'CREATE SCHEMA [identity];');
    CREATE TABLE [identity].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    IF SCHEMA_ID(N'identity') IS NULL EXEC(N'CREATE SCHEMA [identity];');
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetRoles] (
        [Id] nvarchar(450) NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetUsers] (
        [Id] nvarchar(450) NOT NULL,
        [DisplayName] nvarchar(200) NOT NULL,
        [IsActive] bit NOT NULL,
        [RequireMfa] bit NOT NULL,
        [LastMfaHash] nvarchar(max) NULL,
        [LastMfaAt] datetimeoffset NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(450) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[Audit] (
        [Id] bigint NOT NULL IDENTITY,
        [ActorId] nvarchar(450) NOT NULL,
        [Action] nvarchar(100) NOT NULL,
        [Resource] nvarchar(500) NOT NULL,
        [TraceId] nvarchar(100) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Audit] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [identity].[AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetUserRoles] (
        [UserId] nvarchar(450) NOT NULL,
        [RoleId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [identity].[AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[AspNetUserTokens] (
        [UserId] nvarchar(450) NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE TABLE [identity].[Sessions] (
        [Id] nvarchar(64) NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [TokenHash] nvarchar(64) NOT NULL,
        [FamilyId] nvarchar(64) NOT NULL,
        [SecurityStamp] nvarchar(100) NOT NULL,
        [MfaVerified] bit NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [RevokedAt] datetimeoffset NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Sessions] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Sessions_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [identity].[AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [identity].[AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [identity].[AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [identity].[AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [identity].[AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [EmailIndex] ON [identity].[AspNetUsers] ([NormalizedEmail]) WHERE [NormalizedEmail] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_AspNetUsers_PhoneNumber] ON [identity].[AspNetUsers] ([PhoneNumber]) WHERE [PhoneNumber] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [identity].[AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_Audit_At] ON [identity].[Audit] ([At]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_Sessions_FamilyId] ON [identity].[Sessions] ([FamilyId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Sessions_TokenHash] ON [identity].[Sessions] ([TokenHash]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    CREATE INDEX [IX_Sessions_UserId] ON [identity].[Sessions] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022094718_IdentityInitial'
)
BEGIN
    INSERT INTO [identity].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022094718_IdentityInitial', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022100122_IdentityAuthenticatorReplay'
)
BEGIN
    DECLARE @var nvarchar(max);
    SELECT @var = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[identity].[AspNetUsers]') AND [c].[name] = N'LastMfaAt');
    IF @var IS NOT NULL EXEC(N'ALTER TABLE [identity].[AspNetUsers] DROP CONSTRAINT ' + @var + ';');
    ALTER TABLE [identity].[AspNetUsers] DROP COLUMN [LastMfaAt];
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022100122_IdentityAuthenticatorReplay'
)
BEGIN
    DECLARE @var1 nvarchar(max);
    SELECT @var1 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[identity].[AspNetUsers]') AND [c].[name] = N'LastMfaHash');
    IF @var1 IS NOT NULL EXEC(N'ALTER TABLE [identity].[AspNetUsers] DROP CONSTRAINT ' + @var1 + ';');
    ALTER TABLE [identity].[AspNetUsers] DROP COLUMN [LastMfaHash];
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022100122_IdentityAuthenticatorReplay'
)
BEGIN
    ALTER TABLE [identity].[AspNetUsers] ADD [LastMfaCounter] bigint NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022100122_IdentityAuthenticatorReplay'
)
BEGIN
    INSERT INTO [identity].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022100122_IdentityAuthenticatorReplay', N'10.0.12');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023005118_IdentityMfaRecovery'
)
BEGIN
    ALTER TABLE [identity].[AspNetUsers] ADD [MfaRecoveryPending] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023005118_IdentityMfaRecovery'
)
BEGIN
    CREATE TABLE [identity].[MfaRecoveryCodes] (
        [UserId] nvarchar(450) NOT NULL,
        [CodeHash] varchar(64) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ConsumedAt] datetimeoffset NULL,
        CONSTRAINT [PK_MfaRecoveryCodes] PRIMARY KEY NONCLUSTERED ([UserId], [CodeHash]),
        CONSTRAINT [FK_MfaRecoveryCodes_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [identity].[AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [identity].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023005118_IdentityMfaRecovery'
)
BEGIN
    INSERT INTO [identity].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023005118_IdentityMfaRecovery', N'10.0.12');
END;

COMMIT;
GO

