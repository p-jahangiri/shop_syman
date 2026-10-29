using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class UsedItemInspection
{
    public string Id{get;set;}="";public string VariantId{get;set;}="";
    public string TechnicalState{get;set;}="unknown";public string BatteryState{get;set;}="unknown";public int? BatteryHealthPercent{get;set;}
    public string ScreenState{get;set;}="unknown";public string BodyState{get;set;}="unknown";public string RepairState{get;set;}="unknown";
    public string NotesFa{get;set;}="";public string NotesEn{get;set;}="";public DateTimeOffset InspectedAt{get;set;}public DateTimeOffset RecordedAt{get;set;}public string ActorId{get;set;}="";
}
public sealed class UsedItemCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";public DateTimeOffset At{get;set;}
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveUsedItemInput(string VariantVersion,UsedItemConditionData Inspection);
public sealed record UsedItemDetail(int SchemaVersion,string VariantId,string ProductId,string Sku,string VariantVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]UsedItemConditionData? Inspection);
public sealed record UsedItemResult(int SchemaVersion,bool Replayed,UsedItemDetail Detail);
public sealed record UsedVariantChoice(string VariantId,string ProductId,string Sku,string LabelFa,string LabelEn,bool Used);
public sealed record UsedVariantChoices(int SchemaVersion,UsedVariantChoice[] Items,bool HasMore);
public static class UsedItemModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<UsedItemInspection>(e=>{
            e.ToTable("UsedItemInspections",t=>{
                t.HasCheckConstraint("CK_UsedItem_Technical","[TechnicalState] IN ('unknown','passed','needsRepair')");
                t.HasCheckConstraint("CK_UsedItem_Battery","([BatteryState] IN ('unknown','notApplicable') AND [BatteryHealthPercent] IS NULL) OR ([BatteryState]='measured' AND [BatteryHealthPercent] IS NOT NULL AND [BatteryHealthPercent] BETWEEN 0 AND 100)");
                t.HasCheckConstraint("CK_UsedItem_Exterior","[ScreenState] IN ('unknown','intact','worn','damaged') AND [BodyState] IN ('unknown','intact','worn','damaged')");
                t.HasCheckConstraint("CK_UsedItem_Repair","[RepairState] IN ('unknown','noKnownRepair','repaired')");
                t.HasCheckConstraint("CK_UsedItem_Time","[InspectedAt]<=[RecordedAt]");
            });
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.VariantId).HasMaxLength(64);e.HasAlternateKey(x=>new{x.VariantId,x.Id});
            foreach(var n in new[]{"TechnicalState","BatteryState","ScreenState","BodyState","RepairState"})e.Property<string>(n).HasMaxLength(20).IsUnicode(false);
            e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.NotesFa).HasMaxLength(2000);e.Property(x=>x.NotesEn).HasMaxLength(2000);e.HasIndex(x=>new{x.VariantId,x.RecordedAt,x.Id});
            e.HasOne<ProductVariant>().WithMany().HasForeignKey(x=>x.VariantId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ProductVariant>(e=>{e.Property(x=>x.UsedInspectionId).HasMaxLength(32);e.HasOne<UsedItemInspection>().WithMany().HasForeignKey(x=>new{x.Id,x.UsedInspectionId}).HasPrincipalKey(x=>new{x.VariantId,x.Id}).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<UsedItemCommand>(e=>{e.ToTable("UsedItemCommands",t=>t.HasCheckConstraint("CK_UsedItem_CommandJson","ISJSON([ResultJson])=1"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(16000);});
    }
}
public sealed class UsedItemConditions(CatalogDbContext db,TimeProvider time)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public async Task<UsedVariantChoices> ChoicesAsync(string? query,CancellationToken ct)
    {
        if(query is {Length:>100})throw UsedItemConditionRules.Invalid();
        var q=from v in db.Variants.AsNoTracking() join p in db.Products.AsNoTracking() on v.ProductId equals p.Id where !p.IsDigital&&v.IsActive select new {VariantId=v.Id,ProductId=p.Id,v.Sku,v.LabelFa,v.LabelEn,Used=v.UsedInspectionId!=null};
        if(!string.IsNullOrWhiteSpace(query))q=q.Where(v=>v.Sku.Contains(query)||v.LabelFa.Contains(query)||v.LabelEn.Contains(query));
        var rows=await q.OrderBy(v=>v.VariantId).Take(51).ToArrayAsync(ct);return new(1,rows.Take(50).Select(v=>new UsedVariantChoice(v.VariantId,v.ProductId,v.Sku,v.LabelFa,v.LabelEn,v.Used)).ToArray(),rows.Length>50);
    }
    public async Task<UsedItemDetail> ReadAsync(string variantId,CancellationToken ct)
    {
        if(string.IsNullOrWhiteSpace(variantId)||variantId.Length>64)throw UsedItemConditionRules.Invalid();
        var v=await db.Variants.AsNoTracking().SingleOrDefaultAsync(v=>v.Id==variantId,ct)??throw Missing();
        var inspection=v.UsedInspectionId is null?null:await db.Set<UsedItemInspection>().AsNoTracking().SingleAsync(i=>i.Id==v.UsedInspectionId&&i.VariantId==v.Id,ct);return Detail(v,inspection);
    }
    public async Task<UsedItemResult> SaveAsync(string actor,string variantId,string commandId,SaveUsedItemInput input,IUsedItemStockPolicy stock,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Used-item changes require root Serializable audit coordination.");
        if(!Guid.TryParseExact(commandId,"N",out var command)||command==Guid.Empty||commandId!=command.ToString("N")||actor.Length is <1 or >64||variantId.Length is <1 or >64)throw UsedItemConditionRules.Invalid();
        UsedItemConditionRules.Validate(input.Inspection);if(input.Inspection.InspectedAt>time.GetUtcNow())throw UsedItemConditionRules.Invalid();
        await using(var lockCommand=db.Database.GetDbConnection().CreateCommand()){
            lockCommand.Transaction=db.Database.CurrentTransaction.GetDbTransaction();lockCommand.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var parameter=lockCommand.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:used-item:actor:"+actor;lockCommand.Parameters.Add(parameter);if(Convert.ToInt32(await lockCommand.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("used_item_busy_conflict","Retry the same command.");
        }
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{VariantId=variantId,Input=input},Json))));
        var previous=await db.Set<UsedItemCommand>().FromSqlInterpolated($"SELECT * FROM [catalog].[UsedItemCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.PayloadHash!=hash)throw new BusinessException("used_item_idempotency_conflict","This command id already has different inspection facts.");return (JsonSerializer.Deserialize<UsedItemResult>(previous.ResultJson,Json)??throw new InvalidOperationException("Invalid used-item receipt.")) with{Replayed=true};}
        var v=await db.Variants.SingleOrDefaultAsync(v=>v.Id==variantId,ct)??throw Missing();CatalogRules.Version(v.Version,input.VariantVersion);
        var p=await db.Products.SingleAsync(p=>p.Id==v.ProductId,ct);if(p.IsDigital)throw new BusinessException("used_item_digital_conflict","Used-device inspections require a physical SKU.");
        if(await db.Set<UsedItemInspection>().AnyAsync(i=>i.Id==input.Inspection.InspectionId,ct))throw new BusinessException("used_item_inspection_conflict","Use a new inspection id for every revision.");
        await stock.RequireSingleUnitAsync(v.Id,ct);var now=time.GetUtcNow();var d=input.Inspection;
        var inspection=new UsedItemInspection{Id=d.InspectionId,VariantId=v.Id,TechnicalState=d.TechnicalState,BatteryState=d.BatteryState,BatteryHealthPercent=d.BatteryHealthPercent,ScreenState=d.ScreenState,BodyState=d.BodyState,RepairState=d.RepairState,NotesFa=d.NotesFa,NotesEn=d.NotesEn,InspectedAt=d.InspectedAt,RecordedAt=now,ActorId=actor};db.Add(inspection);
        v.UsedInspectionId=inspection.Id;v.UpdatedAt=now;p.UpdatedAt=now;db.Entry(v).Property(x=>x.UpdatedAt).IsModified=true;db.Entry(p).Property(x=>x.UpdatedAt).IsModified=true;
        await db.SaveChangesAsync(ct);var result=new UsedItemResult(1,false,Detail(v,inspection));db.Add(new UsedItemCommand{ActorId=actor,CommandId=commandId,PayloadHash=hash,ResultJson=JsonSerializer.Serialize(result,Json),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public static async Task<Dictionary<string,UsedItemConditionData>> CurrentAsync(CatalogDbContext db,IEnumerable<(string VariantId,string? InspectionId)> variants,CancellationToken ct)
    {
        var requested=variants.Where(v=>v.InspectionId is not null).ToArray();var ids=requested.Select(v=>v.InspectionId!).Distinct(StringComparer.Ordinal).ToArray();
        if(ids.Length==0)return new(StringComparer.OrdinalIgnoreCase);
        if(ids.Length>2048)throw new BusinessException("catalog_unavailable","Used-item projection exceeds its bounded capacity.");
        var rows=await db.Set<UsedItemInspection>().AsNoTracking().Where(i=>ids.Contains(i.Id)).ToDictionaryAsync(i=>i.Id,ct);var result=new Dictionary<string,UsedItemConditionData>(StringComparer.OrdinalIgnoreCase);
        foreach(var v in requested){if(!rows.TryGetValue(v.InspectionId!,out var i)||!string.Equals(i.VariantId,v.VariantId,StringComparison.OrdinalIgnoreCase))throw new BusinessException("catalog_unavailable","Used-item inspection relationship is unavailable.");result[v.VariantId]=Data(i);}return result;
    }
    public static UsedItemConditionData Data(UsedItemInspection i)
    {
        var d=new UsedItemConditionData(i.Id,i.TechnicalState,i.BatteryState,i.BatteryHealthPercent,i.ScreenState,i.BodyState,i.RepairState,i.NotesFa,i.NotesEn,i.InspectedAt);
        try{UsedItemConditionRules.Validate(d);}catch(BusinessException){throw new BusinessException("catalog_unavailable","Stored used-item inspection facts are unavailable.");}return d;
    }
    private static UsedItemDetail Detail(ProductVariant v,UsedItemInspection? i)=>new(1,v.Id,v.ProductId,v.Sku,Convert.ToBase64String(v.Version),i is null?null:Data(i));
    private static BusinessException Missing()=>new("not_found","Used-item SKU was not found.");
}
