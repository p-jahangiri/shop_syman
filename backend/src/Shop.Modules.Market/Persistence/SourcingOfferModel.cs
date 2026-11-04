using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Market;

public sealed class SourcingOffer
{
    public string Id {get;set;}="";
    public string RequestId {get;set;}="";
    public int Revision {get;set;}=1;
    public string State {get;set;}="Draft";
    public bool IsActive {get;set;}
    public bool ContainsDemo {get;set;}
    public string TermsFa {get;set;}="";
    public string TermsEn {get;set;}="";
    public string TermsHash {get;set;}="";
    public long TotalRial {get;set;}
    public DateTimeOffset AcceptUntil {get;set;}
    public DateTimeOffset PurchaseUntil {get;set;}
    public DateTimeOffset? ExpectedAt {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public DateTimeOffset? PublishedAt {get;set;}
    public DateTimeOffset? AcceptedAt {get;set;}
    public string? AcceptanceId {get;set;}
    public byte[] Version {get;set;}=[];
    public List<SourcingOfferLine> Lines {get;set;}=[];
}
public sealed class SourcingOfferLine
{
    public string OfferId {get;set;}="";
    public string LineId {get;set;}="";
    public string ListingId {get;set;}="";
    public int Quantity {get;set;}
    public long UnitPriceRial {get;set;}
    public string VariantId {get;set;}="";
    public string ProductId {get;set;}="";
    public string SellerId {get;set;}="";
    public string Sku {get;set;}="";
    public string Slug {get;set;}="";
    public string CategoryId {get;set;}="";
    public string CategoryNameFa {get;set;}="";
    public string CategoryNameEn {get;set;}="";
    public string BrandId {get;set;}="";
    public string Brand {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public string DescriptionFa {get;set;}="";
    public string DescriptionEn {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
    public string Color {get;set;}="";
    public string ColorNameFa {get;set;}="";
    public string ColorNameEn {get;set;}="";
    public string WarrantyFa {get;set;}="";
    public string WarrantyEn {get;set;}="";
    public bool HasVariantMethods {get;set;}
    public long PublicPriceRial {get;set;}
    public string CatalogVersion {get;set;}="";
    public string CurrentFingerprint {get;set;}="";
    public string MaterialFingerprint {get;set;}="";
    public List<SourcingOfferImage> Images {get;set;}=[];
    public List<SourcingOfferAttribute> Attributes {get;set;}=[];
    public List<SourcingOfferPurchaseRule> PurchaseRules {get;set;}=[];
}
public sealed class SourcingOfferImage
{
    public string OfferId {get;set;}="";
    public string LineId {get;set;}="";
    public int SortOrder {get;set;}
    public string Url {get;set;}="";
}
public sealed class SourcingOfferAttribute
{
    public string OfferId {get;set;}="";
    public string LineId {get;set;}="";
    public string Scope {get;set;}="";
    public string AttributeId {get;set;}="";
    public string Key {get;set;}="";
    public string DataType {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
    public string? Unit {get;set;}
    public string? UnitFa {get;set;}
    public string? UnitEn {get;set;}
    public string? TextFa {get;set;}
    public string? TextEn {get;set;}
    public decimal? Number {get;set;}
    public bool? Bool {get;set;}
    public List<SourcingOfferOption> Options {get;set;}=[];
}
public sealed class SourcingOfferOption
{
    public string OfferId {get;set;}="";
    public string LineId {get;set;}="";
    public string Scope {get;set;}="";
    public string AttributeId {get;set;}="";
    public string OptionId {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
}
public sealed class SourcingOfferPurchaseRule
{
    public string OfferId {get;set;}="";
    public string LineId {get;set;}="";
    public string Kind {get;set;}="";
    public string RuleId {get;set;}="";
}
public sealed class SourcingOfferAcceptance
{
    public string OfferId {get;set;}="";
    public string Id {get;set;}=Guid.NewGuid().ToString("N");
    public string OwnerId {get;set;}="";
    public string TermsHash {get;set;}="";
    public string OfferVersion {get;set;}="";
    public DateTimeOffset At {get;set;}
}
public sealed class SourcingOfferEvent
{
    public long Id {get;set;}
    public string OfferId {get;set;}="";
    public int Revision {get;set;}
    public string ActorId {get;set;}="";
    public string ActorKind {get;set;}="";
    public string? StateBefore {get;set;}
    public string StateAfter {get;set;}="";
    public string ReasonCode {get;set;}="";
    public string PublicMessage {get;set;}="";
    public bool IsPublic {get;set;}
    public DateTimeOffset At {get;set;}
}
public sealed class SourcingOfferCommandReceipt
{
    public string ActorId {get;set;}="";
    public string Operation {get;set;}="";
    public string CommandId {get;set;}="";
    public string RequestId {get;set;}="";
    public string OfferId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string ResultJson {get;set;}="";
    public bool ContainsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
}
internal static class SourcingOfferModel
{
    private const string States="'Draft','Published','Accepted','Declined','Withdrawn','Superseded'";
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingOffer>(e=>{
            e.ToTable("SourcingOffers",t=>{t.HasCheckConstraint("CK_SourcingOffer_State","[State] IN ("+States+")");t.HasCheckConstraint("CK_SourcingOffer_Active","[IsActive]=0 OR ([State] IN ('Published','Accepted') AND [PublishedAt] IS NOT NULL)");t.HasCheckConstraint("CK_SourcingOffer_Amounts","[TotalRial]>=0 AND [Revision]>=1");t.HasCheckConstraint("CK_SourcingOffer_Dates","[ChangedAt]>=[CreatedAt] AND [PurchaseUntil]>=[AcceptUntil]");t.HasCheckConstraint("CK_SourcingOffer_Acceptance","([State]='Accepted' AND [AcceptedAt] IS NOT NULL AND [AcceptanceId] IS NOT NULL) OR ([State]<>'Accepted' AND [AcceptedAt] IS NULL AND [AcceptanceId] IS NULL)");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.TermsFa).HasMaxLength(4000);e.Property(x=>x.TermsEn).HasMaxLength(4000);e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.TotalRial).HasColumnType("bigint");e.Property(x=>x.AcceptanceId).HasMaxLength(32);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>x.RequestId).IsUnique().HasFilter("[IsActive] = 1");e.HasIndex(x=>new{x.RequestId,x.CreatedAt,x.Id});e.HasOne<SourcingRequest>().WithMany().HasForeignKey(x=>x.RequestId).OnDelete(DeleteBehavior.Cascade);e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.OfferId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingOfferLine>(e=>{
            e.ToTable("SourcingOfferLines",t=>t.HasCheckConstraint("CK_SourcingOfferLine_Values","[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [PublicPriceRial]>=0"));e.HasKey(x=>new{x.OfferId,x.LineId});e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.LineId).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);
            foreach(var n in new[]{"VariantId","ProductId","SellerId","CategoryId","BrandId"})e.Property<string>(n).HasMaxLength(64);
            e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.Slug).HasMaxLength(150);foreach(var n in new[]{"CategoryNameFa","CategoryNameEn"})e.Property<string>(n).HasMaxLength(200);e.Property(x=>x.Brand).HasMaxLength(120);foreach(var n in new[]{"NameFa","NameEn"})e.Property<string>(n).HasMaxLength(250);foreach(var n in new[]{"DescriptionFa","DescriptionEn"})e.Property<string>(n).HasMaxLength(8000);foreach(var n in new[]{"LabelFa","LabelEn"})e.Property<string>(n).HasMaxLength(2000);e.Property(x=>x.Color).HasMaxLength(2000);foreach(var n in new[]{"ColorNameFa","ColorNameEn"})e.Property<string>(n).HasMaxLength(2000);foreach(var n in new[]{"WarrantyFa","WarrantyEn"})e.Property<string>(n).HasMaxLength(2000);e.Property(x=>x.CatalogVersion).HasMaxLength(12);foreach(var n in new[]{"CurrentFingerprint","MaterialFingerprint"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.UnitPriceRial).HasColumnType("bigint");e.Property(x=>x.PublicPriceRial).HasColumnType("bigint");
            e.HasMany(x=>x.Images).WithOne().HasForeignKey(x=>new{x.OfferId,x.LineId}).OnDelete(DeleteBehavior.Cascade);e.HasMany(x=>x.Attributes).WithOne().HasForeignKey(x=>new{x.OfferId,x.LineId}).OnDelete(DeleteBehavior.Cascade);e.HasMany(x=>x.PurchaseRules).WithOne().HasForeignKey(x=>new{x.OfferId,x.LineId}).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingOfferImage>(e=>{e.ToTable("SourcingOfferImages",t=>t.HasCheckConstraint("CK_SourcingOfferImage_Order","[SortOrder] BETWEEN 0 AND 23"));e.HasKey(x=>new{x.OfferId,x.LineId,x.SortOrder});e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.LineId).HasMaxLength(32);e.Property(x=>x.Url).HasMaxLength(1500);});
        b.Entity<SourcingOfferAttribute>(e=>{
            e.ToTable("SourcingOfferAttributes",t=>{t.HasCheckConstraint("CK_SourcingOfferAttribute_Scope","[Scope] IN ('model','variant')");t.HasCheckConstraint("CK_SourcingOfferAttribute_Type","[DataType] IN ('Text','Number','Bool','Select','MultiSelect')");t.HasCheckConstraint("CK_SourcingOfferAttribute_Value","([DataType]='Text' AND [TextFa] IS NOT NULL AND [TextEn] IS NOT NULL AND [Number] IS NULL AND [Bool] IS NULL) OR ([DataType]='Number' AND [Number] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Bool] IS NULL) OR ([DataType]='Bool' AND [Bool] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL) OR ([DataType] IN ('Select','MultiSelect') AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL AND [Bool] IS NULL)");});
            e.HasKey(x=>new{x.OfferId,x.LineId,x.Scope,x.AttributeId});e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.LineId).HasMaxLength(32);e.Property(x=>x.Scope).HasMaxLength(8);e.Property(x=>x.AttributeId).HasMaxLength(64);e.Property(x=>x.Key).HasMaxLength(150);e.Property(x=>x.DataType).HasMaxLength(16);foreach(var n in new[]{"LabelFa","LabelEn"})e.Property<string>(n).HasMaxLength(2000);e.Property(x=>x.Unit).HasMaxLength(80);foreach(var n in new[]{"UnitFa","UnitEn"})e.Property<string>(n).HasMaxLength(2000);foreach(var n in new[]{"TextFa","TextEn"})e.Property<string>(n).HasMaxLength(8000);e.Property(x=>x.Number).HasPrecision(28,8);e.HasMany(x=>x.Options).WithOne().HasForeignKey(x=>new{x.OfferId,x.LineId,x.Scope,x.AttributeId}).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingOfferOption>(e=>{e.ToTable("SourcingOfferOptions");e.HasKey(x=>new{x.OfferId,x.LineId,x.Scope,x.AttributeId,x.OptionId});e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.LineId).HasMaxLength(32);e.Property(x=>x.Scope).HasMaxLength(8);e.Property(x=>x.AttributeId).HasMaxLength(64);e.Property(x=>x.OptionId).HasMaxLength(64);e.Property(x=>x.LabelFa).HasMaxLength(2000);e.Property(x=>x.LabelEn).HasMaxLength(2000);});
        b.Entity<SourcingOfferPurchaseRule>(e=>{e.ToTable("SourcingOfferPurchaseRules",t=>t.HasCheckConstraint("CK_SourcingOfferRule_Kind","[Kind] IN ('product','variant','plan')"));e.HasKey(x=>new{x.OfferId,x.LineId,x.Kind,x.RuleId});e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.LineId).HasMaxLength(32);e.Property(x=>x.Kind).HasMaxLength(8);e.Property(x=>x.RuleId).HasMaxLength(64);});
        b.Entity<SourcingOfferAcceptance>(e=>{e.ToTable("SourcingOfferAcceptances");e.HasKey(x=>x.OfferId);e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.Id).HasMaxLength(32).IsRequired();e.HasIndex(x=>x.Id).IsUnique();e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.OfferVersion).HasMaxLength(12);e.HasOne<SourcingOffer>().WithOne().HasForeignKey<SourcingOfferAcceptance>(x=>x.OfferId).OnDelete(DeleteBehavior.Cascade);});
        b.Entity<SourcingOfferEvent>(e=>{e.ToTable("SourcingOfferEvents",t=>{t.HasCheckConstraint("CK_SourcingOfferEvent_State","([StateBefore] IS NULL OR [StateBefore] IN ("+States+")) AND [StateAfter] IN ("+States+")");t.HasCheckConstraint("CK_SourcingOfferEvent_Actor","[ActorKind] IN ('customer','staff','system')");});e.HasKey(x=>x.Id);e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ActorKind).HasMaxLength(16);e.Property(x=>x.StateBefore).HasMaxLength(16);e.Property(x=>x.StateAfter).HasMaxLength(16);e.Property(x=>x.ReasonCode).HasMaxLength(64);e.Property(x=>x.PublicMessage).HasMaxLength(500);e.HasOne<SourcingOffer>().WithMany().HasForeignKey(x=>x.OfferId).OnDelete(DeleteBehavior.Cascade);e.HasIndex(x=>new{x.OfferId,x.Id});});
        b.Entity<SourcingOfferCommandReceipt>(e=>{e.ToTable("SourcingOfferCommandReceipts",t=>{t.HasCheckConstraint("CK_SourcingOfferReceipt_Operation","[Operation] IN ('save','publish','withdraw','accept','decline')");t.HasCheckConstraint("CK_SourcingOfferReceipt_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");});e.HasKey(x=>new{x.ActorId,x.Operation,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(16);foreach(var n in new[]{"CommandId","RequestId","OfferId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(8192);});
    }
}
