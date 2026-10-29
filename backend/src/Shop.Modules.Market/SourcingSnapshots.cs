using Shop.SharedKernel;

namespace Shop.Modules.Market;

public static class SourcingSnapshots
{
    public static void Validate(SourcingModelSnapshot model)
    {
        SourcingRules.Actor(model.Id);SourcingRules.Actor(model.CategoryId);SourcingRules.Actor(model.BrandId);SourcingRules.Version(model.Version);SourcingRules.Fingerprint(model.Fingerprint);
        Bounded(model.Slug,150);Bounded(model.CategoryNameFa,200);Bounded(model.CategoryNameEn,200);Bounded(model.Brand,120);Bounded(model.NameFa,250);Bounded(model.NameEn,250);Bounded(model.DescriptionFa,8000);Bounded(model.DescriptionEn,8000);
        if(model.Images is not {Length:>0 and <=24}||model.Images.Distinct(StringComparer.Ordinal).Count()!=model.Images.Length||model.Attributes is null||model.Attributes.Length>64||model.Attributes.Select(a=>a.AttributeId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=model.Attributes.Length)throw Invalid();
        foreach(var image in model.Images)Bounded(image,1500);
        foreach(var a in model.Attributes){
            SourcingRules.Actor(a.AttributeId);Bounded(a.Key,150);Bounded(a.LabelFa,200);Bounded(a.LabelEn,200);Optional(a.Unit,80);Optional(a.UnitFa,80);Optional(a.UnitEn,80);Optional(a.TextFa,8000);Optional(a.TextEn,8000);
            if(a.Options is null||a.Options.Length>64||a.Options.Select(o=>o.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=a.Options.Length)throw Invalid();
            foreach(var option in a.Options){SourcingRules.Actor(option.Id);Bounded(option.LabelFa,200);Bounded(option.LabelEn,200);}
            var valid=a.DataType switch{
                "Text"=>a.TextFa is not null&&a.TextEn is not null&&a.Number is null&&a.Bool is null&&a.Options.Length==0,
                "Number"=>a.Number.HasValue&&a.Number.Value> -100000000000000000000m&&a.Number.Value<100000000000000000000m&&decimal.Round(a.Number.Value,8)==a.Number.Value&&a.TextFa is null&&a.TextEn is null&&a.Bool is null&&a.Options.Length==0,
                "Bool"=>a.Bool.HasValue&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Options.Length==0,
                "Select"=>a.Options.Length==1&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Bool is null,
                "MultiSelect"=>a.Options.Length>0&&a.TextFa is null&&a.TextEn is null&&a.Number is null&&a.Bool is null,
                _=>false};
            if(!valid)throw Invalid();
        }
    }
    private static void Bounded(string? value,int max){if(value is null||value.Length>max||value.IndexOf('\0')>=0)throw Invalid();}
    private static void Optional(string? value,int max){if(value is not null)Bounded(value,max);}
    private static BusinessException Invalid()=>new("sourcing_snapshot_limit","The requested model snapshot exceeds the supported bounds or contains an invalid typed value. No request was recorded.");
}
