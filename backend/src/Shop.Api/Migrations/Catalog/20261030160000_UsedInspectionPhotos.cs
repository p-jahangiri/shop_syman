using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Shop.Api.Migrations.Catalog;
public partial class UsedInspectionPhotos : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "UsedItemInspectionPhotos", schema: "catalog",
            columns: table => new {
                InspectionId=table.Column<string>(type:"nvarchar(32)",maxLength:32,nullable:false),
                Position=table.Column<int>(type:"int",nullable:false),
                AssetId=table.Column<string>(type:"nvarchar(32)",maxLength:32,nullable:false),
                AltFa=table.Column<string>(type:"nvarchar(160)",maxLength:160,nullable:false),
                AltEn=table.Column<string>(type:"nvarchar(160)",maxLength:160,nullable:false)
            },
            constraints: table => {
                table.PrimaryKey("PK_UsedItemInspectionPhotos",x=>new{x.InspectionId,x.Position});
                table.CheckConstraint("CK_UsedInspectionPhoto_Position","[Position] BETWEEN 1 AND 12");
                table.ForeignKey(name:"FK_UsedItemInspectionPhotos_UsedItemInspections_InspectionId",column:x=>x.InspectionId,principalSchema:"catalog",principalTable:"UsedItemInspections",principalColumn:"Id",onDelete:ReferentialAction.Restrict);
                table.ForeignKey(name:"FK_UsedItemInspectionPhotos_PublicImages_AssetId",column:x=>x.AssetId,principalSchema:"catalog",principalTable:"PublicImages",principalColumn:"Id",onDelete:ReferentialAction.Restrict);
            });
        migrationBuilder.CreateIndex(name:"IX_UsedItemInspectionPhotos_AssetId",schema:"catalog",table:"UsedItemInspectionPhotos",column:"AssetId");
        migrationBuilder.CreateIndex(name:"IX_UsedItemInspectionPhotos_InspectionId_AssetId",schema:"catalog",table:"UsedItemInspectionPhotos",columns:new[]{"InspectionId","AssetId"},unique:true);
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [catalog].[UsedItemInspectionPhotos]) THROW 51000, 'Used-device inspection photos are retained history; destructive rollback is blocked.', 1;");
        migrationBuilder.DropTable(name:"UsedItemInspectionPhotos",schema:"catalog");
    }
}
