using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed class CartOfferLine
{
    public string CartId { get; set; }="";
    public string Id { get; set; }="";
    public string ConversionId { get; set; }="";
    public string AgreementId { get; set; }="";
    public string AgreementLineId { get; set; }="";
    public string RequestId { get; set; }="";
    public string TaskId { get; set; }="";
    public string OfferId { get; set; }="";
    public string AcceptanceId { get; set; }="";
    public string AllocationId { get; set; }="";
    public string AllocationVersion { get; set; }="";
    public DateTimeOffset AllocationExpiresAt { get; set; }
    public string OfferLineId { get; set; }="";
    public string VariantId { get; set; }="";
    public int Quantity { get; set; }
    public bool ContainsDemo { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class SourcingConversion
{
    public string Id { get; set; }="";
    public string OwnerId { get; set; }="";
    public string RequestId { get; set; }="";
    public string TaskId { get; set; }="";
    public string OfferId { get; set; }="";
    public string AcceptanceId { get; set; }="";
    public string AgreementId { get; set; }="";
    public string AllocationId { get; set; }="";
    public string CartId { get; set; }="";
    public string CartVersion { get; set; }="";
    public string CommandId { get; set; }="";
    public string LineLinksJson { get; set; }="";
    public bool ContainsDemo { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class CartOfferCommandReceipt
{
    public string ActorId { get; set; }="";
    public string Operation { get; set; }="";
    public string CommandId { get; set; }="";
    public string AgreementId { get; set; }="";
    public string? RequestId { get; set; }
    public string? OfferId { get; set; }
    public string PayloadHash { get; set; }="";
    public string ResultJson { get; set; }="";
    public bool ContainsDemo { get; set; }
    public DateTimeOffset At { get; set; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CartOfferRemoveInput(string RequestId,string Version);
public sealed record CartOfferRemovalMutation(int SchemaVersion,string AgreementId,string CartId,string CartVersion,string[] LineIds,string CommandId,DateTimeOffset At,bool Replayed,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingConversionExisting(string Id,string CartVersion,SourcingCartLineLink[] Lines);

public static class CartOfferRules
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=32,DefaultIgnoreCondition=JsonIgnoreCondition.Never,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    public static string Id(string? value)=>SourcingPriceAgreementRules.Id(value);
    public static string CommandId(string? value)=>Guid.TryParseExact(value,"D",out var id)&&id!=Guid.Empty?id.ToString("N"):value is {Length:32}?Id(value):throw Invalid();
    public static string Owner(string? value)=>value is {Length:>0 and <=64}&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?value.ToUpperInvariant():throw Invalid();
    public static string Version(string? value)
    {
        try{if(value is not {Length:12}||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();return value;}
        catch(FormatException){throw Invalid();}
    }
    public static string OrdinaryLineId(string cartId,string variantId)=>Hash("cart-ordinary:"+Id(cartId)+":"+variantId.ToLowerInvariant())[..32].ToLowerInvariant();
    public static string OfferLineId(string cartId,string agreementId,string agreementLineId)=>Hash("cart-accepted:"+Id(cartId)+":"+Id(agreementId)+":"+Id(agreementLineId))[..32].ToLowerInvariant();
    public static void EnsureSkuCapacity(IEnumerable<(string VariantId,int Quantity)> lines)
    {
        if(lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).Any(g=>g.Sum(l=>(long)l.Quantity)>1000000))throw new BusinessException("cart_limit","All purchase lines of the same SKU together exceed the supported one-million-unit reservation bound.");
    }
    public static SourcingConversionInput Normalize(SourcingConversionInput input)
    {
        if(input is null||input.TermsHash is not {Length:64}||!input.TermsHash.All(c=>c is >= '0' and <= '9' or >= 'A' and <= 'F'))throw Invalid();
        return new(CommandId(input.RequestId),Id(input.TaskId),Version(input.RequestVersion),Version(input.TaskVersion),Version(input.OfferVersion),Id(input.AcceptanceId),Id(input.AgreementId),Version(input.AgreementVersion),Id(input.AllocationId),Version(input.AllocationVersion),input.TermsHash,input.CartVersion is null?null:Version(input.CartVersion));
    }
    internal static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static string Payload(object value)=>Hash(JsonSerializer.Serialize(value,Json));
    internal static void RequireParent(SalesDbContext db){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Cart2 and accepted-offer commands require the root Serializable transaction.");}
    internal static BusinessException Invalid()=>new("invalid_cart_offer","Use exact bounded cart, agreement and conversion identities and versions.");
    internal static BusinessException Missing()=>new("not_found","The accepted cart selection or its command was not found.");
    internal static BusinessException Capacity()=>new("cart_offer_capacity_unavailable","The complete Cart2 selection exceeds its supported response or graph bounds.");
    internal static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
}
internal static class CartOfferModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingConversion>(e=>{
            e.ToTable("SourcingConversions",t=>{t.HasCheckConstraint("CK_SourcingConversion_Links","ISJSON([LineLinksJson])=1 AND DATALENGTH([LineLinksJson])<=32768");});e.HasKey(x=>x.Id);
            foreach(var name in new[]{"Id","RequestId","TaskId","OfferId","AcceptanceId","AgreementId","AllocationId","CartId","CommandId"})e.Property<string>(name).HasMaxLength(32);
            e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.CartVersion).HasMaxLength(12);e.Property(x=>x.LineLinksJson).HasMaxLength(16384);e.HasIndex(x=>x.AcceptanceId).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.Id});
        });
        b.Entity<CartOfferLine>(e=>{
            e.ToTable("CartOfferLines",t=>t.HasCheckConstraint("CK_CartOfferLine_Quantity","[Quantity] BETWEEN 1 AND 1000000"));e.HasKey(x=>new{x.CartId,x.AgreementLineId});
            foreach(var name in new[]{"CartId","Id","ConversionId","AgreementId","AgreementLineId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","OfferLineId"})e.Property<string>(name).HasMaxLength(32);
            e.Property(x=>x.Id).IsRequired();
            e.Property(x=>x.AllocationVersion).HasMaxLength(12);e.Property(x=>x.VariantId).HasMaxLength(64);e.HasIndex(x=>new{x.CartId,x.Id}).IsUnique();e.HasIndex(x=>x.AgreementId);
            e.HasOne<SourcingConversion>().WithMany().HasForeignKey(x=>x.ConversionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SourcingPriceAgreementLine>().WithMany().HasForeignKey(x=>new{x.AgreementId,x.AgreementLineId}).HasPrincipalKey(x=>new{x.AgreementId,x.Id}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CartOfferCommandReceipt>(e=>{
            e.ToTable("CartOfferCommandReceipts",t=>{t.HasCheckConstraint("CK_CartOfferCommand_Operation","([Operation]='convert' AND [RequestId] IS NOT NULL AND [OfferId] IS NOT NULL) OR ([Operation]='remove' AND [RequestId] IS NULL AND [OfferId] IS NULL)");t.HasCheckConstraint("CK_CartOfferCommand_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=65536");});
            e.HasKey(x=>new{x.ActorId,x.Operation,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(16);foreach(var name in new[]{"CommandId","AgreementId","RequestId","OfferId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(32768);
        });
    }
}
internal static class CartOfferCommands
{
    internal static async Task LockAsync(SalesDbContext db,string actor,string operation,string commandId,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
        var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:sales:cart-offer-command:"+CartOfferRules.Hash(actor+":"+operation+":"+commandId);command.Parameters.Add(p);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cart_offer_busy_conflict","The cart command is in progress. Retry the same command id.");
    }
    internal static async Task<CartOfferCommandReceipt?> PreviousAsync(SalesDbContext db,string actor,string operation,string command,string agreement,string? request,string? offer,string hash,bool allowDemo,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var row=await db.CartOfferCommandReceipts.FromSqlInterpolated($"SELECT * FROM [sales].[CartOfferCommandReceipts] WITH (UPDLOCK,HOLDLOCK) WHERE [ActorId]={actor} AND [Operation]={operation} AND [CommandId]={command}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(row is null)return null;if(row.ContainsDemo&&!allowDemo)throw CartOfferRules.Missing();if(row.AgreementId!=agreement||row.RequestId!=request||row.OfferId!=offer||row.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This cart-offer command id belongs to another target or payload.");return row;
    }
    internal static CartOfferCommandReceipt Receipt(string actor,string operation,string command,string agreement,string? request,string? offer,string hash,object result,bool demo,DateTimeOffset at)
    {
        var json=JsonSerializer.Serialize(result,CartOfferRules.Json);if(Encoding.UTF8.GetByteCount(json)>32768||Encoding.Unicode.GetByteCount(json)>65536)throw CartOfferRules.Capacity();return new(){ActorId=actor,Operation=operation,CommandId=command,AgreementId=agreement,RequestId=request,OfferId=offer,PayloadHash=hash,ResultJson=json,ContainsDemo=demo,At=at};
    }
}
public sealed class CartOfferService(SalesDbContext db,CartService carts,TimeProvider clock,bool allowDemo)
{
    public async Task<CartOfferRemovalMutation> RemoveAsync(string ownerId,string locale,string agreementId,CartOfferRemoveInput supplied,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);CartService.ValidateLocale(locale);agreementId=CartOfferRules.Id(agreementId);if(supplied is null)throw CartOfferRules.Invalid();var input=new CartOfferRemoveInput(CartOfferRules.CommandId(supplied.RequestId),CartOfferRules.Version(supplied.Version));CartOfferRules.RequireParent(db);
        await CartOfferCommands.LockAsync(db,owner,"remove",input.RequestId,ct);var hash=CartOfferRules.Payload(new{Agreement=agreementId,Input=input});var previous=await CartOfferCommands.PreviousAsync(db,owner,"remove",input.RequestId,agreementId,null,null,hash,allowDemo,ct);if(previous is not null)return Deserialize(previous) with{Replayed=true};
        var identity=new CartIdentity(owner,null);await carts.LockIdentityAsync(identity,true,ct);var cart=await carts.FindAsync(identity,true,ct)??throw CartOfferRules.Missing();CartService.EnsureCapacity(cart);
        if(Convert.ToBase64String(cart.Version)!=input.Version)throw new BusinessException("cart_version_conflict","The cart changed. Review the current accepted group before removing it.");
        var lines=cart.OfferLines.Where(l=>l.AgreementId==agreementId).OrderBy(l=>l.Id,StringComparer.Ordinal).ToArray();if(lines.Length==0)throw new BusinessException("cart_offer_not_present_conflict","This accepted group is no longer in the cart.");
        if(lines.Any(l=>l.ContainsDemo)&&!allowDemo||!await db.SourcingPriceAgreements.AsNoTracking().AnyAsync(a=>a.Id==agreementId&&a.OwnerId==owner&&(allowDemo||!a.ContainsDemo),ct))throw CartOfferRules.Missing();
        foreach(var line in lines){db.CartOfferLines.Remove(line);cart.OfferLines.Remove(line);}carts.Touch(cart);await db.SaveChangesAsync(ct);var now=clock.GetUtcNow();var result=new CartOfferRemovalMutation(1,agreementId,cart.Id,Convert.ToBase64String(cart.Version),lines.Select(l=>l.Id).ToArray(),input.RequestId,now,false);
        db.CartOfferCommandReceipts.Add(CartOfferCommands.Receipt(owner,"remove",input.RequestId,agreementId,null,null,hash,result,lines.Any(l=>l.ContainsDemo),now));await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CartOfferRemovalMutation> ReadRemovalCommandAsync(string ownerId,string agreementId,string commandId,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);agreementId=CartOfferRules.Id(agreementId);commandId=CartOfferRules.CommandId(commandId);var row=await db.CartOfferCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==owner&&r.Operation=="remove"&&r.CommandId==commandId&&r.AgreementId==agreementId&&(allowDemo||!r.ContainsDemo),ct)??throw CartOfferRules.Missing();return Deserialize(row) with{Replayed=true};
    }
    private static CartOfferRemovalMutation Deserialize(CartOfferCommandReceipt row)=>JsonSerializer.Deserialize<CartOfferRemovalMutation>(row.ResultJson,CartOfferRules.Json)??throw new InvalidOperationException("Invalid cart-offer removal receipt.");
}
