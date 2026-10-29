using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Market;

public sealed class PhoneConfiguration
{
    public string Id{get;set;}="";public string ListingId{get;set;}="";public bool Enabled{get;set;}
    public int RamGb{get;set;}public int StorageGb{get;set;}public string ColorKey{get;set;}="";public string ColorNameFa{get;set;}="";public string ColorNameEn{get;set;}="";
    public string? ColorHex{get;set;}public string? ImageUrl{get;set;}public string? LinkedVariantId{get;set;}public DateTimeOffset UpdatedAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class PhoneDiscoveryCommand
{
    public string ActorId{get;set;}="";public string Operation{get;set;}="";public string RequestId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";public bool ContainsDemo{get;set;}public DateTimeOffset At{get;set;}
}
public sealed class PhoneInterest
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public string OwnerId{get;set;}="";public string ListingId{get;set;}="";public string ConfigurationId{get;set;}="";
    public string ConfigurationJson{get;set;}="";public string State{get;set;}="Active";public int Generation{get;set;}=1;public bool IsDemo{get;set;}
    public string ModelNameFa{get;set;}="";public string ModelNameEn{get;set;}="";
    public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset ChangedAt{get;set;}public byte[] Version{get;set;}=[];
}
internal static class PhoneDiscoveryModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<PhoneConfiguration>(e=>{
            e.ToTable("PhoneConfigurations",t=>{t.HasCheckConstraint("CK_PhoneConfiguration_Memory","[RamGb] BETWEEN 1 AND 128 AND [StorageGb] BETWEEN 1 AND 32768");t.HasCheckConstraint("CK_PhoneConfiguration_Color","LEN([ColorKey]) BETWEEN 1 AND 64 AND LEN([ColorNameFa]) BETWEEN 1 AND 120 AND LEN([ColorNameEn]) BETWEEN 1 AND 120");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.ColorKey).HasMaxLength(64);e.Property(x=>x.ColorNameFa).HasMaxLength(120);e.Property(x=>x.ColorNameEn).HasMaxLength(120);e.Property(x=>x.ColorHex).HasMaxLength(7);e.Property(x=>x.ImageUrl).HasMaxLength(1500);e.Property(x=>x.LinkedVariantId).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.ListingId,x.RamGb,x.StorageGb,x.ColorKey}).IsUnique();e.HasOne<MarketListing>().WithMany().HasForeignKey(x=>x.ListingId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<PhoneInterest>(e=>{
            e.ToTable("PhoneInterests",t=>{t.HasCheckConstraint("CK_PhoneInterest_State","[State] IN ('Active','Cancelled','Notified') AND [Generation]>0");t.HasCheckConstraint("CK_PhoneInterest_Snapshot","ISJSON([ConfigurationJson])=1 AND DATALENGTH([ConfigurationJson])<=16000");t.HasCheckConstraint("CK_PhoneInterest_Time","[ChangedAt]>=[CreatedAt]");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.ConfigurationId).HasMaxLength(32);e.Property(x=>x.ConfigurationJson).HasMaxLength(8000);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.OwnerId,x.ListingId,x.ConfigurationId}).IsUnique();e.HasIndex(x=>new{x.State,x.Id});e.HasIndex(x=>new{x.OwnerId,x.Id});e.HasOne<PhoneConfiguration>().WithMany().HasForeignKey(x=>x.ConfigurationId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x=>x.ModelNameFa).HasMaxLength(250);e.Property(x=>x.ModelNameEn).HasMaxLength(250);
        });
        b.Entity<PhoneDiscoveryCommand>(e=>{
            e.ToTable("PhoneDiscoveryCommands",t=>t.HasCheckConstraint("CK_PhoneDiscoveryCommand_Json","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=32000"));e.HasKey(x=>new{x.ActorId,x.Operation,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(32);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(16000);
        });
    }
}
