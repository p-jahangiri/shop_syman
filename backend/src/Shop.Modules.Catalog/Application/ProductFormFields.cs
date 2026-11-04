using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Application;

public sealed record ProductFormFieldData(string Key, string Label, string Help, bool Visible, int SortOrder, bool VisibilityLocked);
public sealed record ProductFormFieldsData(int SchemaVersion, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Version, ProductFormFieldData[] Fields);
public sealed record ProductFormFieldInput(string Key, string Label, string Help, bool Visible, int SortOrder);
public sealed record ProductFormFieldsInput(string RequestId, string? Version, ProductFormFieldInput[] Fields);
public static class ProductFormFieldRules
{
    private static ProductFormFieldData Field(string key, string label, string help, int order, bool locked = false) => new(key, label, help, true, order, locked);
    public static ProductFormFieldData[] Defaults() => [
        Field("name","نام کالا","نام مدل مشترک را وارد کنید؛ رنگ و حافظه در تنوع‌ها مشخص می‌شوند.",10,true),
        Field("category","دسته‌بندی","دسته، ویژگی‌ها و محورهای تنوع کالا را تعیین می‌کند. دستهٔ تازه را از همین فرم یا بخش دسته‌بندی‌ها بسازید.",20,true),
        Field("brand","برند","سازندهٔ کالا را انتخاب کنید؛ افزودن برند از همین فرم ممکن است.",30,true),
        Field("slug","نشانی صفحه","شناسهٔ یکتای نشانی کالا با حروف انگلیسی، عدد و خط تیره. پس از انتشار با دقت تغییر دهید.",40),
        Field("description","توضیحات کالا","ویژگی‌های مشترک و اطلاعات واقعی کالا را بنویسید؛ شرایط مخصوص هر رنگ یا حافظه در ردیف تنوع وارد می‌شود.",50),
        Field("translation","ترجمهٔ انگلیسی","ترجمهٔ عنوان و توضیح برای نسخهٔ انگلیسی؛ تا ثبت ترجمه، عنوان فارسی به عنوان جایگزین ذخیره می‌شود.",60),
        Field("specifications","مشخصات مشترک","ویژگی‌های این دسته را یک‌بار وارد کنید. ویژگی لازم باید در کالا یا در تمام تنوع‌های فعال مقدار داشته باشد.",70,true),
        Field("sku","کد تنوع / SKU","هر ترکیب قابل فروش یک کد یکتا دارد و قیمت و موجودی مستقلی نگه می‌دارد. سابقهٔ کدهای قبلی پاک نمی‌شود.",80,true),
        Field("color","رنگ","رنگ نمایشی و نام آن را مشخص کنید. برای چند رنگ از ترکیب‌ساز تنوع‌ها استفاده کنید.",90),
        Field("axes","ویژگی‌های تنوع","محورهای تعریف‌شده در دسته مثل حافظه و RAM؛ ویژگی مشترک را بین ردیف‌ها تکرار نکنید.",100,true),
        Field("price","قیمت فروش","مبلغ را به تومان وارد کنید؛ یک رقم اعشار معادل ریال پذیرفته می‌شود. قیمت نهایی در سرور به ریال صحیح ثبت می‌شود.",110,true),
        Field("discount","قیمت پیش از تخفیف","اختیاری و بزرگ‌تر یا مساوی قیمت فروش. تخفیف فقط برای همان تنوع اعمال و از قیمت‌های واقعی محاسبه می‌شود.",120),
        Field("warranty","گارانتی","نام، مدت و شرایط واقعی گارانتی همین تنوع را بنویسید. می‌توانید مقدار مشترک را برای ردیف‌های منتخب کپی کنید.",130),
        Field("purchaseMethods","روش‌های خرید","فقط روش‌های واقعی فروشگاه. تنوع بدون محدودیت اختصاصی، روش‌های کالای مادر را به ارث می‌برد.",150,true),
        Field("images","تصاویر کالا","تصویر اول کاور است. تصویر آپلودشده باید آماده باشد؛ از کتابخانه هم می‌توانید انتخاب کنید.",160,true),
        Field("videos","ویدیوی کالا","فایل MP4/WebM یا لینک مستقیم HTTPS وارد کنید؛ ویدیو با انتخاب کاربر پخش می‌شود.",170)
    ];
    public static void Validate(ProductFormFieldInput[] fields)
    {
        var defaults = Defaults();
        if (fields.Length != defaults.Length || fields.Select(f => f.Key).Distinct(StringComparer.Ordinal).Count() != fields.Length)
            throw Invalid();
        foreach (var field in fields)
        {
            var rule = defaults.SingleOrDefault(f => f.Key == field.Key);
            if (rule is null || rule.VisibilityLocked && !field.Visible || field.SortOrder is < 0 or > 1000 || !Text(field.Label, 150, false) || !Text(field.Help, 1000, true))
                throw Invalid();
        }
    }
    private static bool Text(string text, int max, bool empty) => text is not null && text.Length <= max && (empty || !string.IsNullOrWhiteSpace(text)) && !text.Any(c => (char.IsControl(c) && c is not ('\n' or '\r')) || c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069');
    private static BusinessException Invalid() => new("invalid_product_form_fields", "Use the known form fields, bounded labels/help and retain essential field visibility.");
}
