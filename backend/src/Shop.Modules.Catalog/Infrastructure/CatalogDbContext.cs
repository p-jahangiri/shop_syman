using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
using Shop.Modules.Catalog.Media;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<PublicImageAsset> PublicImages => Set<PublicImageAsset>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<AttributeDefinition> AttributeDefinitions => Set<AttributeDefinition>();
    public DbSet<AttributeOption> AttributeOptions => Set<AttributeOption>();
    public DbSet<CategoryAttribute> CategoryAttributes => Set<CategoryAttribute>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductVariant> Variants => Set<ProductVariant>();
    public DbSet<PriceHistory> PriceHistory => Set<PriceHistory>();
    public DbSet<AvailableStockV1> AvailableStock => Set<AvailableStockV1>();
    public DbSet<CatalogMarketModelV1> MarketModels => Set<CatalogMarketModelV1>();
    public DbSet<AccountingProductLink> AccountingLinks => Set<AccountingProductLink>();
    public DbSet<AccountingImportBatch> AccountingImports => Set<AccountingImportBatch>();
    public DbSet<AccountingImportRow> AccountingImportRows => Set<AccountingImportRow>();

    private void NormalizeSearch()
    {
        foreach (var entry in ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified)) {
            switch (entry.Entity) {
                case AttributeOption option: option.FacetSearch = PersianText.Normalize($"{option.Value} {option.LabelFa} {option.LabelEn}"); if(option.FacetSearch.Length==0)throw new BusinessException("invalid_search_text", "An attribute option needs searchable text."); break;
                case ProductAttributeValue value: value.FacetSearch = value.ValueTextFa is null && value.ValueTextEn is null ? null : PersianText.Normalize($"{value.ValueTextFa} {value.ValueTextEn}"); break;
                case VariantAttributeValue value: value.FacetSearch = value.ValueTextFa is null && value.ValueTextEn is null ? null : PersianText.Normalize($"{value.ValueTextFa} {value.ValueTextEn}"); break;
                case Brand brand: brand.SearchName = SearchValue(brand.Name); break;
                case ProductTranslation translation: translation.SearchName = SearchValue(translation.Name); break;
                case ProductVariant variant: variant.SearchSku = SearchValue(variant.Sku); break;
            }
        }
    }
    private static string SearchValue(string value) { var normalized = PersianText.Normalize(value); if (normalized.Length is < 1 or > 500) throw new BusinessException("invalid_search_text", "Catalog text must contain one to 500 normalized characters."); return normalized; }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { NormalizeSearch(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) { NormalizeSearch(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("catalog");
        UsedItemModel.Configure(b);
        AccountingLinkModel.Configure(b);
        AccountingImportModel.Configure(b);
        b.Entity<PublicImageAsset>(e=>{e.ToTable("PublicImages",t=>{t.HasCheckConstraint("CK_PublicImage_Status","[Status] IN ('Staged','Ready','Failed','Cleaning','Purged')");t.HasCheckConstraint("CK_PublicImage_Size","[InputBytes] > 0 AND [InputBytes] <= 8388608 AND [Width] > 0 AND [Height] > 0");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.Status).HasMaxLength(16);e.Property(x=>x.CleanupLeaseId).HasMaxLength(32);e.Property(x=>x.OriginalSha256).HasMaxLength(64);e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.Status,x.CreatedAt});e.HasMany(x=>x.Variants).WithOne().HasForeignKey(x=>x.AssetId).OnDelete(DeleteBehavior.Cascade);});
        b.Entity<PublicImageVariant>(e=>{e.ToTable("PublicImageVariants",t=>{t.HasCheckConstraint("CK_PublicImageVariant_Name","[Name] IN ('thumb','card','zoom')");t.HasCheckConstraint("CK_PublicImageVariant_Size","[Bytes] > 0 AND [Bytes] <= 8388608 AND [Width] > 0 AND [Height] > 0");});e.HasKey(x=>new{x.AssetId,x.Name});e.Property(x=>x.AssetId).HasMaxLength(32);e.Property(x=>x.Name).HasMaxLength(8);e.Property(x=>x.Sha256).HasMaxLength(64);});
        b.Entity<AvailableStockV1>(e => { e.HasNoKey(); e.ToView("AvailableStockV1", "inventory"); e.Property(x => x.VariantId).HasMaxLength(64); });
        b.Entity<CatalogMarketModelV1>(e=>{e.HasNoKey();e.ToView("MarketModelsV1","catalog");foreach(var name in new[]{"ModelId","CategoryId","BrandId"})e.Property(name).HasMaxLength(64);e.Property(x=>x.Slug).HasMaxLength(150);e.Property(x=>x.Brand).HasMaxLength(120);e.Property(x=>x.NameFa).HasMaxLength(250);e.Property(x=>x.NameEn).HasMaxLength(250);e.Property(x=>x.SearchFa).HasMaxLength(500);e.Property(x=>x.SearchEn).HasMaxLength(500);e.Property(x=>x.Version).HasColumnType("varbinary(8)");});
        b.Entity<Category>(e => {
            e.Property(x => x.Slug).HasMaxLength(150);
            e.HasIndex(x => x.Slug).IsUnique();
            e.HasOne<Category>().WithMany().HasForeignKey(x => x.ParentId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Attributes).WithOne().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<CategoryTranslation>(e => { e.HasKey(x => new { x.CategoryId, x.Locale }); e.Property(x => x.Locale).HasMaxLength(2); e.Property(x => x.Name).HasMaxLength(200); });
        b.Entity<Brand>(e => { e.HasIndex(x => x.Slug).IsUnique(); e.Property(x => x.Slug).HasMaxLength(150); e.Property(x => x.Name).HasMaxLength(120); e.Property(x => x.SearchName).HasMaxLength(500); e.HasIndex(x => x.SearchName); });
        b.Entity<AttributeDefinition>(e => {
            e.Property(x => x.Key).HasMaxLength(150); e.Property(x => x.Unit).HasMaxLength(80);
            e.HasIndex(x => x.Key).IsUnique(); e.Property(x => x.DataType).HasConversion<string>().HasMaxLength(20);
            e.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.AttributeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Options).WithOne().HasForeignKey(x => x.AttributeId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AttributeTranslation>(e => { e.HasKey(x => new { x.AttributeId, x.Locale }); e.Property(x => x.Locale).HasMaxLength(2); });
        b.Entity<AttributeOption>(e => { e.HasKey(x => new { x.AttributeId, x.Id }); e.Property(x => x.FacetSearch).HasColumnType("nvarchar(max)"); e.Property(x => x.Value).HasMaxLength(400); e.HasIndex(x => new { x.AttributeId, x.Value }).IsUnique(); });
        b.Entity<CategoryAttribute>(e => { e.HasKey(x => new { x.CategoryId, x.AttributeId }); e.HasOne<AttributeDefinition>().WithMany().HasForeignKey(x => x.AttributeId).OnDelete(DeleteBehavior.Restrict); });
        b.Entity<Product>(e => {
            e.Property(x => x.Slug).HasMaxLength(150);
            e.HasIndex(x => x.Slug).IsUnique(); e.HasIndex(x => new { x.CategoryId, x.Status });
            e.HasOne<Category>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Brand>().WithMany().HasForeignKey(x => x.BrandId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Variants).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Attributes).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Media).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.PurchaseMethods).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.CreditPlans).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.Status).HasMaxLength(20); e.Property(x => x.SellerId).HasMaxLength(64);
            e.ToTable(t => t.HasCheckConstraint("CK_Product_Status", "[Status] IN ('Draft','Published','Hidden')"));
        });
        b.Entity<ProductTranslation>(e => { e.HasKey(x => new { x.ProductId, x.Locale }); e.Property(x => x.Locale).HasMaxLength(2); e.Property(x => x.Name).HasMaxLength(250); e.HasIndex(x => x.Name); e.Property(x => x.SearchName).HasMaxLength(500); e.HasIndex(x => x.SearchName); });
        b.Entity<ProductVariant>(e => {
            e.Property(x => x.SearchSku).HasMaxLength(500); e.HasIndex(x => x.SearchSku);
            e.HasIndex(x => x.Sku).IsUnique(); e.Property(x => x.Sku).HasMaxLength(80); e.Property(x => x.PriceRial).HasColumnType("bigint"); e.Property(x => x.CompareAtPriceRial).HasColumnType("bigint");
            e.HasMany(x => x.Attributes).WithOne().HasForeignKey(x => x.VariantId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.PurchaseMethods).WithOne().HasForeignKey(x => x.VariantId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t => { t.HasCheckConstraint("CK_Variant_Price", "[PriceRial] >= 0"); t.HasCheckConstraint("CK_Variant_CompareAt", "[CompareAtPriceRial] IS NULL OR [CompareAtPriceRial] >= [PriceRial]"); });
        });
        b.Entity<ProductAttributeValue>(e => {
            e.HasKey(x => new { x.ProductId, x.AttributeId }); e.Property(x => x.FacetSearch).HasColumnType("nvarchar(max)"); e.Property(x => x.ValueNumber).HasPrecision(28, 8);
            e.HasOne<AttributeDefinition>().WithMany().HasForeignKey(x => x.AttributeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AttributeOption>().WithMany().HasForeignKey(x => new { x.AttributeId, Id = x.ValueOptionId }).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Selections).WithOne().HasForeignKey(x => new { x.ProductId, x.AttributeId }).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.AttributeId, x.ValueNumber }); e.HasIndex(x => new { x.AttributeId, x.ValueBool }); e.HasIndex(x => new { x.AttributeId, x.ValueOptionId });
        });
        b.Entity<ProductAttributeSelection>(e => { e.HasKey(x => new { x.ProductId, x.AttributeId, x.OptionId }); e.HasOne<AttributeOption>().WithMany().HasForeignKey(x => new { x.AttributeId, Id = x.OptionId }).OnDelete(DeleteBehavior.Restrict); });
        b.Entity<VariantAttributeValue>(e => {
            e.HasKey(x => new { x.VariantId, x.AttributeId }); e.Property(x => x.FacetSearch).HasColumnType("nvarchar(max)"); e.Property(x => x.ValueNumber).HasPrecision(28, 8);
            e.HasOne<AttributeDefinition>().WithMany().HasForeignKey(x => x.AttributeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AttributeOption>().WithMany().HasForeignKey(x => new { x.AttributeId, Id = x.ValueOptionId }).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.AttributeId, x.ValueNumber }); e.HasIndex(x => new { x.AttributeId, x.ValueOptionId });
        });
        b.Entity<ProductMedia>(e => { e.Property(x => x.Url).HasMaxLength(1500); e.Property(x=>x.AssetId).HasMaxLength(32); e.HasOne<PublicImageAsset>().WithMany().HasForeignKey(x=>x.AssetId).OnDelete(DeleteBehavior.Restrict); });
        b.Entity<ProductPurchaseMethod>().HasKey(x => new { x.ProductId, x.MethodId });
        b.Entity<ProductCreditPlan>().HasKey(x => new { x.ProductId, x.PlanId });
        b.Entity<VariantPurchaseMethod>().HasKey(x => new { x.VariantId, x.MethodId });
        b.Entity<PriceHistory>(e => { e.HasOne<ProductVariant>().WithMany().HasForeignKey(x => x.VariantId).OnDelete(DeleteBehavior.Restrict); });

        foreach (var entity in b.Model.GetEntityTypes().ToList())
        {
            foreach (var property in entity.GetProperties().Where(p => p.ClrType == typeof(string) && p.GetMaxLength() is null && p.Name != "FacetSearch"))
                property.SetMaxLength(property.Name.EndsWith("Id", StringComparison.Ordinal) || property.Name == "Id" ? 64 : property.Name.Contains("Description", StringComparison.Ordinal) ? 8000 : 2000);
            if (typeof(CatalogEntity).IsAssignableFrom(entity.ClrType))
            {
                b.Entity(entity.ClrType).HasBaseType((Type?)null);
                b.Entity(entity.ClrType).HasKey(nameof(CatalogEntity.Id));
                b.Entity(entity.ClrType).Property(nameof(CatalogEntity.Version)).IsRowVersion();
            }
        }
    }
}
