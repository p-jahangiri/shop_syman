using System.Globalization;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public static class SourcingOfferSnapshots
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public static void Validate(OfferSkuSnapshot sku)
    {
        SourcingOfferRules.Identifier(sku.VariantId);SourcingOfferRules.Identifier(sku.ProductId);SourcingOfferRules.Identifier(sku.SellerId);SourcingRules.Version(sku.Version);SourcingRules.Fingerprint(sku.CurrentFingerprint);SourcingRules.Fingerprint(sku.MaterialFingerprint);SourcingOfferRules.Price(sku.PublicPriceRial);
        if(sku.ProductId!=sku.Model.Id)throw Limit();
        Bounded(sku.Sku,80,true);Bounded(sku.LabelFa,2000);Bounded(sku.LabelEn,2000);Bounded(sku.Color,2000);Bounded(sku.ColorNameFa,2000);Bounded(sku.ColorNameEn,2000);Bounded(sku.WarrantyFa,2000);Bounded(sku.WarrantyEn,2000);
        var m=sku.Model;SourcingOfferRules.Identifier(m.Id);SourcingOfferRules.Identifier(m.CategoryId);SourcingOfferRules.Identifier(m.BrandId);Bounded(m.Slug,150);Bounded(m.CategoryNameFa,200);Bounded(m.CategoryNameEn,200);Bounded(m.Brand,120);Bounded(m.NameFa,250);Bounded(m.NameEn,250);Bounded(m.DescriptionFa,8000);Bounded(m.DescriptionEn,8000);
        if(m.Images is not {Length:>0 and <=24}||m.Images.Distinct(StringComparer.Ordinal).Count()!=m.Images.Length)throw Limit();foreach(var image in m.Images)Bounded(image,1500);
        // Offers snapshot actual Catalog metadata. The accepted request-v1
        // snapshot has older label/unit limits and must not constrain this
        // separate contract or be changed by an offer migration.
        Attributes(m.Attributes);Attributes(sku.Attributes);
        Rules(sku.ProductMethodIds,true);if(sku.VariantMethodIds is not null){Rules(sku.VariantMethodIds,true);if(sku.VariantMethodIds.Any(v=>!sku.ProductMethodIds.Contains(v,StringComparer.Ordinal)))throw Limit();}Rules(sku.ChequePlanIds,false);
    }
    private static void Rules(string[]? ids,bool required){if(ids is null||ids.Length>64||required&&ids.Length==0||ids.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=ids.Length)throw Limit();foreach(var id in ids)SourcingOfferRules.Identifier(id);}
    private static void Attributes(SourcingAttributeSnapshot[]? attributes)
    {
        if(attributes is null||attributes.Length>64||attributes.Select(a=>a.AttributeId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=attributes.Length)throw Limit();
        foreach(var a in attributes){
            SourcingOfferRules.Identifier(a.AttributeId);Bounded(a.Key,150);Bounded(a.LabelFa,2000);Bounded(a.LabelEn,2000);Optional(a.Unit,80);Optional(a.UnitFa,2000);Optional(a.UnitEn,2000);Optional(a.TextFa,2000);Optional(a.TextEn,2000);
            if(a.Options is null||a.Options.Length>64||a.Options.Select(o=>o.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=a.Options.Length)throw Limit();foreach(var option in a.Options){SourcingOfferRules.Identifier(option.Id);Bounded(option.LabelFa,2000);Bounded(option.LabelEn,2000);}
            var valid=a.DataType switch{
                "Text"=>a.TextFa is not null&&a.TextEn is not null&&a.Number is null&&a.Bool is null&&a.Options.Length==0,
                "Number"=>a.Number.HasValue&&a.Number.Value> -100000000000000000000m&&a.Number.Value<100000000000000000000m&&decimal.Round(a.Number.Value,8)==a.Number.Value&&a.TextFa is null&&a.TextEn is null&&a.Bool is null&&a.Options.Length==0,
                "Bool"=>a.Bool.HasValue&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Options.Length==0,
                "Select"=>a.Options.Length==1&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Bool is null,
                "MultiSelect"=>a.Options.Length>0&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Bool is null,
                _=>false};if(!valid)throw Limit();
        }
    }
    private static void Optional(string? value,int max){if(value is not null)Bounded(value,max);}
    private static void Bounded(string? value,int max,bool required=false){if(value is null||value.Length>max||required&&value.Length==0||value.IndexOf('\0')>=0)throw Limit();}
    private static BusinessException Limit()=>new("sourcing_offer_capacity_unavailable","The SKU snapshot is outside the supported bounds.");
    public static SourcingOfferLine Store(string offerId,SourcingOfferLineInput line,OfferSkuSnapshot sku)
    {
        Validate(sku);var m=sku.Model;var row=new SourcingOfferLine{OfferId=offerId,LineId=line.LineId,ListingId=line.ListingId,Quantity=line.Quantity,UnitPriceRial=SourcingOfferRules.Price(line.UnitPriceRial),VariantId=sku.VariantId,ProductId=sku.ProductId,SellerId=sku.SellerId,Sku=sku.Sku,Slug=m.Slug,CategoryId=m.CategoryId,CategoryNameFa=m.CategoryNameFa,CategoryNameEn=m.CategoryNameEn,BrandId=m.BrandId,Brand=m.Brand,NameFa=m.NameFa,NameEn=m.NameEn,DescriptionFa=m.DescriptionFa,DescriptionEn=m.DescriptionEn,LabelFa=sku.LabelFa,LabelEn=sku.LabelEn,Color=sku.Color,ColorNameFa=sku.ColorNameFa,ColorNameEn=sku.ColorNameEn,WarrantyFa=sku.WarrantyFa,WarrantyEn=sku.WarrantyEn,HasVariantMethods=sku.VariantMethodIds is not null,PublicPriceRial=SourcingOfferRules.Price(sku.PublicPriceRial),CatalogVersion=sku.Version,CurrentFingerprint=sku.CurrentFingerprint,MaterialFingerprint=sku.MaterialFingerprint};
        row.Images=m.Images.Select((url,i)=>new SourcingOfferImage{OfferId=offerId,LineId=line.LineId,SortOrder=i,Url=url}).ToList();row.Attributes=m.Attributes.Select(a=>Attribute(offerId,line.LineId,"model",a)).Concat(sku.Attributes.Select(a=>Attribute(offerId,line.LineId,"variant",a))).ToList();
        row.PurchaseRules=sku.ProductMethodIds.Select(id=>Rule(offerId,line.LineId,"product",id)).Concat((sku.VariantMethodIds??[]).Select(id=>Rule(offerId,line.LineId,"variant",id))).Concat(sku.ChequePlanIds.Select(id=>Rule(offerId,line.LineId,"plan",id))).ToList();return row;
    }
    private static SourcingOfferPurchaseRule Rule(string offerId,string lineId,string kind,string id)=>new(){OfferId=offerId,LineId=lineId,Kind=kind,RuleId=id};
    private static SourcingOfferAttribute Attribute(string offerId,string lineId,string scope,SourcingAttributeSnapshot a)=>new(){OfferId=offerId,LineId=lineId,Scope=scope,AttributeId=a.AttributeId,Key=a.Key,DataType=a.DataType,LabelFa=a.LabelFa,LabelEn=a.LabelEn,Unit=a.Unit,UnitFa=a.UnitFa,UnitEn=a.UnitEn,TextFa=a.TextFa,TextEn=a.TextEn,Number=a.Number,Bool=a.Bool,Options=a.Options.Select(o=>new SourcingOfferOption{OfferId=offerId,LineId=lineId,Scope=scope,AttributeId=a.AttributeId,OptionId=o.Id,LabelFa=o.LabelFa,LabelEn=o.LabelEn}).ToList()};
    public static SourcingOfferLineData Read(SourcingOfferLine l)
    {
        var sku=new OfferSkuSnapshot(l.VariantId,l.ProductId,l.SellerId,l.Sku,new(l.ProductId,l.Slug,l.CategoryId,l.CategoryNameFa,l.CategoryNameEn,l.BrandId,l.Brand,l.NameFa,l.NameEn,l.DescriptionFa,l.DescriptionEn,l.Images.OrderBy(i=>i.SortOrder).Select(i=>i.Url).ToArray(),Attributes(l,"model")),l.LabelFa,l.LabelEn,l.Color,l.ColorNameFa,l.ColorNameEn,l.WarrantyFa,l.WarrantyEn,Attributes(l,"variant"),Rules(l,"product"),l.HasVariantMethods?Rules(l,"variant"):null,Rules(l,"plan"),l.PublicPriceRial.ToString(CultureInfo.InvariantCulture),l.CatalogVersion,l.CurrentFingerprint,l.MaterialFingerprint);
        return new(l.LineId,l.ListingId,l.Quantity,l.UnitPriceRial.ToString(CultureInfo.InvariantCulture),checked(l.UnitPriceRial*l.Quantity).ToString(CultureInfo.InvariantCulture),sku);
    }
    private static string[] Rules(SourcingOfferLine l,string kind)=>l.PurchaseRules.Where(r=>r.Kind==kind).OrderBy(r=>r.RuleId,StringComparer.Ordinal).Select(r=>r.RuleId).ToArray();
    private static SourcingAttributeSnapshot[] Attributes(SourcingOfferLine l,string scope)=>l.Attributes.Where(a=>a.Scope==scope).OrderBy(a=>a.Key,StringComparer.Ordinal).Select(a=>new SourcingAttributeSnapshot(a.AttributeId,a.Key,a.DataType,a.LabelFa,a.LabelEn,a.Unit,a.UnitFa,a.UnitEn,a.TextFa,a.TextEn,a.Number,a.Bool,a.Options.OrderBy(o=>o.OptionId,StringComparer.Ordinal).Select(o=>new SourcingOptionSnapshot(o.OptionId,o.LabelFa,o.LabelEn)).ToArray())).ToArray();
    public static string TermsHash(SourcingOffer row)=>SourcingRules.Hash(JsonSerializer.Serialize(new{row.RequestId,row.Id,row.Revision,row.TermsFa,row.TermsEn,row.AcceptUntil,row.PurchaseUntil,row.ExpectedAt,Lines=row.Lines.OrderBy(l=>l.LineId,StringComparer.Ordinal).Select(l=>new{l.LineId,l.ListingId,l.Quantity,l.UnitPriceRial,l.MaterialFingerprint})},Json));
}
