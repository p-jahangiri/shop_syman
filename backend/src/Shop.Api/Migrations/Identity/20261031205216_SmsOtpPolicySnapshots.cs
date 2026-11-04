using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Identity
{
    /// <inheritdoc />
    public partial class SmsOtpPolicySnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOtp_Attempts",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOtp_Timing",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.AddColumn<int>(
                name: "LifetimeSeconds",
                schema: "identity",
                table: "CustomerOtpChallenges",
                type: "int",
                nullable: false,
                defaultValue: 300);

            migrationBuilder.AddColumn<int>(
                name: "MaxAttempts",
                schema: "identity",
                table: "CustomerOtpChallenges",
                type: "int",
                nullable: false,
                defaultValue: 5);

            migrationBuilder.AddColumn<int>(
                name: "ResendSeconds",
                schema: "identity",
                table: "CustomerOtpChallenges",
                type: "int",
                nullable: false,
                defaultValue: 60);

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOtp_Attempts",
                schema: "identity",
                table: "CustomerOtpChallenges",
                sql: "[MaxAttempts] BETWEEN 1 AND 10 AND [FailedAttempts] BETWEEN 0 AND [MaxAttempts]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOtp_Timing",
                schema: "identity",
                table: "CustomerOtpChallenges",
                sql: "[LifetimeSeconds] BETWEEN 60 AND 600 AND [ResendSeconds] BETWEEN 30 AND 300 AND [ResendSeconds]<[LifetimeSeconds] AND [ExpiresAt]=DATEADD(second,[LifetimeSeconds],[CreatedAt]) AND [ResendAt]=DATEADD(second,[ResendSeconds],[CreatedAt])");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [identity].[CustomerOtpChallenges]
                    WHERE [LifetimeSeconds]<>300 OR [ResendSeconds]<>60 OR [MaxAttempts]<>5)
                    THROW 51069,'Retained OTP policy snapshots require forward-compatible recovery.',1;
                """);
            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOtp_Attempts",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOtp_Timing",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.DropColumn(
                name: "LifetimeSeconds",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.DropColumn(
                name: "MaxAttempts",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.DropColumn(
                name: "ResendSeconds",
                schema: "identity",
                table: "CustomerOtpChallenges");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOtp_Attempts",
                schema: "identity",
                table: "CustomerOtpChallenges",
                sql: "[FailedAttempts] BETWEEN 0 AND 5");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOtp_Timing",
                schema: "identity",
                table: "CustomerOtpChallenges",
                sql: "[ExpiresAt]=DATEADD(second,300,[CreatedAt]) AND [ResendAt]=DATEADD(second,60,[CreatedAt])");
        }
    }
}
