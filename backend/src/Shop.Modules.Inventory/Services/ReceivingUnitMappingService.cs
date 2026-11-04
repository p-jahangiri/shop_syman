using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed class ReceivingUnitMappingService(InventoryDbContext db,StockReservationService reservations,TimeProvider clock):IReceivingUnitMappings
{
    private sealed record Cursor(string After,string Binding);
    private static ReceivingUnitMappingData Data(ReceivingUnitMapping m)=>new(m.Id,m.OriginSystem,m.CompanyKey,m.WarehouseKey,m.SourceUnitKey,m.VariantId,m.Numerator,m.Denominator,m.NameFa,m.NameEn,m.IsActive,Convert.ToBase64String(m.Version));
    private static string Payload(string id,ReceivingUnitMappingInput input)=>SourcingReceivingRules.Hash(new{Target=id,Input=input});
    public async Task<ReceivingUnitMappingMutation?> ReplayAsync(string actorId,string id,ReceivingUnitMappingInput supplied,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);id=SourcingReceivingRules.Id(id);var input=SourcingReceivingRules.Normalize(supplied);ReceivingPersistence.RequireTransaction(db);await reservations.LockAsync("receiving-command","mapping:"+actor+":"+input.RequestId,ct);
        var previous=await ReceivingPersistence.Replay(db,actor,"mapping",input.RequestId,id,null,null,Payload(id,input),ct);return previous is null?null:ReceivingPersistence.Read<ReceivingUnitMappingMutation>(previous) with{Replayed=true};
    }
    public async Task<ReceivingUnitMappingMutation> SaveAsync(string actorId,string id,ReceivingUnitMappingInput supplied,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);id=SourcingReceivingRules.Id(id);var input=SourcingReceivingRules.Normalize(supplied);var replay=await ReplayAsync(actor,id,input,ct);if(replay is not null)return replay;
        var identity=SourcingReceivingRules.MappingIdentity(input.OriginSystem,input.CompanyKey,input.WarehouseKey,input.SourceUnitKey,input.VariantId);await reservations.LockAsync("receiving-mapping-identity",identity,ct);await reservations.LockAsync("receiving-mapping",id,ct);
        var row=await db.ReceivingUnitMappings.FromSqlInterpolated($"SELECT * FROM [inventory].[ReceivingUnitMappings] WITH (UPDLOCK, HOLDLOCK) WHERE [Id]={id}").SingleOrDefaultAsync(ct);if(row is null&&input.Version is not null)throw new BusinessException("version_conflict","The unit mapping changed. Read its current version.");
        if(row is not null){await db.Entry(row).ReloadAsync(ct);SerialRules.MatchVersion(row.Version,input.Version);if(row.IdentityHash!=identity)throw new BusinessException("receiving_mapping_identity_conflict","The mapping's source, unit and SKU identity is immutable. Create or select the explicit mapping for the new identity.");}
        if(await db.ReceivingUnitMappings.FromSqlInterpolated($"SELECT * FROM [inventory].[ReceivingUnitMappings] WITH (UPDLOCK, HOLDLOCK) WHERE [IdentityHash]={identity}").AnyAsync(m=>m.Id!=id,ct))throw new BusinessException("receiving_mapping_identity_conflict","This source unit and SKU already have an explicit mapping.");
        var now=clock.GetUtcNow();if(row is null){row=new(){Id=id,CreatedAt=now};db.ReceivingUnitMappings.Add(row);}
        row.IdentityHash=identity;row.OriginSystem=input.OriginSystem;row.CompanyKey=input.CompanyKey;row.WarehouseKey=input.WarehouseKey;row.SourceUnitKey=input.SourceUnitKey;row.VariantId=input.VariantId;row.Numerator=input.Numerator;row.Denominator=input.Denominator;row.NameFa=input.NameFa;row.NameEn=input.NameEn;row.IsActive=input.IsActive;row.ChangedAt=now;db.Entry(row).Property(m=>m.ChangedAt).IsModified=true;
        await db.SaveChangesAsync(ct);var result=new ReceivingUnitMappingMutation(1,id,Convert.ToBase64String(row.Version),input.RequestId,now,false);await ReceivingPersistence.Remember(db,actor,"mapping",input.RequestId,id,null,null,false,Payload(id,input),result,now,ct);return result;
    }
    public async Task<ReceivingUnitMappingData> ReadAsync(string id,CancellationToken ct)=>Data(await db.ReceivingUnitMappings.AsNoTracking().SingleOrDefaultAsync(m=>m.Id==SourcingReceivingRules.Id(id),ct)??throw ReceivingPersistence.Missing());
    public async Task<ReceivingUnitMappingMutation> ReadCommandAsync(string actorId,string id,string commandId,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);id=SourcingReceivingRules.Id(id);commandId=SourcingReceivingRules.Id(commandId);var row=await db.ReceivingCommands.AsNoTracking().SingleOrDefaultAsync(c=>c.ActorId==actor&&c.Operation=="mapping"&&c.CommandId==commandId&&c.TargetId==id,ct)??throw ReceivingPersistence.Missing();return ReceivingPersistence.Read<ReceivingUnitMappingMutation>(row) with{Replayed=true};
    }
    public async Task<ReceivingUnitMappingPage> PageAsync(string? originSystem,string? companyKey,string? warehouseKey,string? variantId,string? cursor,CancellationToken ct)
    {
        if(originSystem is not null)SourcingReceivingRules.Key(originSystem,64);if(companyKey is not null)SourcingReceivingRules.Key(companyKey,64);if(warehouseKey is not null)SourcingReceivingRules.Key(warehouseKey,64);if(variantId is not null)variantId=SourcingReceivingRules.Identifier(variantId).ToUpperInvariant();
        var binding=SourcingReceivingRules.Hash(new{originSystem,companyKey,warehouseKey,variantId});string? after=null;
        if(cursor is not null){try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw new FormatException();var raw=cursor.Replace('-','+').Replace('_','/');var decoded=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),ReceivingPersistence.Json);if(decoded is null||decoded.Binding!=binding)throw new FormatException();after=SourcingReceivingRules.Id(decoded.After);}catch(Exception e)when(e is FormatException or JsonException or BusinessException){throw new BusinessException("invalid_receiving_cursor","Restart unit-mapping paging with the same filters.");}}
        var query=db.ReceivingUnitMappings.AsNoTracking();if(originSystem is not null)query=query.Where(m=>m.OriginSystem==originSystem);if(companyKey is not null)query=query.Where(m=>m.CompanyKey==companyKey);if(warehouseKey is not null)query=query.Where(m=>m.WarehouseKey==warehouseKey);if(variantId is not null)query=query.Where(m=>m.VariantId==variantId);if(after is not null)query=query.Where(m=>string.Compare(m.Id,after)>0);
        var found=await query.OrderBy(m=>m.Id).Take(51).ToArrayAsync(ct);var page=found.Take(50).ToArray();var next=found.Length>50?Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Cursor(page[^1].Id,binding),ReceivingPersistence.Json)).TrimEnd('=').Replace('+','-').Replace('/','_'):null;return new(1,50,page.Select(Data).ToArray(),next);
    }
}
