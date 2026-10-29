using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;

public sealed class WishlistHead
{
    public string OwnerId{get;set;}="";
    public long Revision{get;set;}
    public DateTimeOffset UpdatedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class WishlistItem
{
    public string OwnerId{get;set;}="";
    public string ProductId{get;set;}="";
    public DateTimeOffset AddedAt{get;set;}
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WishlistInput(string[] ProductIds,string? Version);
public sealed record WishlistData(int SchemaVersion,string OwnerId,int Capacity,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,string[] ProductIds);
public sealed record WishlistWriteResult(WishlistData Wishlist,bool Changed);
public static class WishlistRules
{
    public const int Capacity=200;
    public static BusinessException Invalid()=>new("invalid_wishlist","Use a bounded product selection and current version.");
    public static string Owner(string? value){if(value is null||value.Length is<1 or>64||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw Invalid();return value.ToUpperInvariant();}
    public static string[] Products(string[]? ids)
    {
        if(ids is null||ids.Length>Capacity||ids.Any(id=>id is null||id.Length is<1 or>64||id.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_'))))throw Invalid();
        var normalized=ids.Select(x=>x.ToLowerInvariant()).Order(StringComparer.Ordinal).ToArray();if(normalized.Distinct(StringComparer.Ordinal).Count()!=normalized.Length)throw Invalid();return normalized;
    }
    public static void Version(string? value){if(value is null)return;try{var bytes=Convert.FromBase64String(value);if(bytes.Length!=8||Convert.ToBase64String(bytes)!=value)throw Invalid();}catch(FormatException){throw Invalid();}}
}
public sealed partial class SalesDbContext
{
    public DbSet<WishlistHead> WishlistHeads=>Set<WishlistHead>();
    public DbSet<WishlistItem> WishlistItems=>Set<WishlistItem>();
}
public static class WishlistModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<WishlistHead>(e=>{e.ToTable("WishlistHeads",t=>t.HasCheckConstraint("CK_WishlistHead_Revision","[Revision]>0"));e.HasKey(x=>x.OwnerId);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();});
        b.Entity<WishlistItem>(e=>{e.ToTable("WishlistItems");e.HasKey(x=>new{x.OwnerId,x.ProductId});e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ProductId).HasMaxLength(64);e.HasOne<WishlistHead>().WithMany().HasForeignKey(x=>x.OwnerId).OnDelete(DeleteBehavior.Restrict);});
    }
}
public sealed class WishlistService(SalesDbContext db,IWishlistCatalogReader catalog,TimeProvider clock)
{
    public async Task<WishlistData> ReadAsync(string owner,CancellationToken ct)
    {
        owner=WishlistRules.Owner(owner);if(db.Database.CurrentTransaction is not null)throw new InvalidOperationException("Wishlist reads own their transaction.");
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted,ct);await Lock(owner,false,ct);var result=await Snapshot(owner,ct);await tx.CommitAsync(ct);return result;
    }
    public async Task<WishlistWriteResult> ReplaceAsync(string owner,WishlistInput input,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);owner=WishlistRules.Owner(owner);var ids=WishlistRules.Products(input.ProductIds);WishlistRules.Version(input.Version);await Lock(owner,true,ct);
        var current=await Snapshot(owner,ct);if(current.ProductIds.SequenceEqual(ids))return new(current,false);
        if(current.Version!=input.Version)throw new BusinessException("wishlist_version_conflict","Your wishlist changed. Reload before editing.");
        var additions=ids.Except(current.ProductIds,StringComparer.Ordinal).ToArray();var published=await catalog.PublishedProductIdsAsync(additions,ct);
        if(!additions.ToHashSet(StringComparer.OrdinalIgnoreCase).SetEquals(published))throw new BusinessException("wishlist_product_unavailable","A newly selected product is no longer published.");
        var head=await db.WishlistHeads.SingleOrDefaultAsync(x=>x.OwnerId==owner,ct);var now=clock.GetUtcNow();
        if(head is null){head=new(){OwnerId=owner};db.WishlistHeads.Add(head);}
        head.Revision=checked(head.Revision+1);head.UpdatedAt=now;
        var removed=await db.WishlistItems.Where(x=>x.OwnerId==owner&&!ids.Contains(x.ProductId)).ToArrayAsync(ct);db.WishlistItems.RemoveRange(removed);
        foreach(var id in additions)db.WishlistItems.Add(new(){OwnerId=owner,ProductId=id,AddedAt=now});
        await db.SaveChangesAsync(ct);return new(await Snapshot(owner,ct),true);
    }
    private async Task<WishlistData> Snapshot(string owner,CancellationToken ct)
    {
        var head=await db.WishlistHeads.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner,ct);var items=await db.WishlistItems.AsNoTracking().Where(x=>x.OwnerId==owner).OrderBy(x=>x.ProductId).Take(WishlistRules.Capacity+1).Select(x=>x.ProductId).ToArrayAsync(ct);
        if(items.Length>WishlistRules.Capacity||head is null&&items.Length!=0)throw new BusinessException("wishlist_unavailable","The wishlist could not be verified.");
        return new(1,owner,WishlistRules.Capacity,head is null?null:Convert.ToBase64String(head.Version),items.Order(StringComparer.Ordinal).ToArray());
    }
    private async Task Lock(string owner,bool exclusive,CancellationToken ct)
    {
        await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=12;c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
        var p=c.CreateParameter();p.ParameterName="@key";p.Value="sayman:sales:wishlist:"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner)));c.Parameters.Add(p);var m=c.CreateParameter();m.ParameterName="@mode";m.Value=exclusive?"Exclusive":"Shared";c.Parameters.Add(m);
        if(Convert.ToInt32(await c.ExecuteScalarAsync(ct))<0)throw new BusinessException("wishlist_busy","The wishlist is being updated. Reload its current state.");
    }
}
