using System.Net;
using System.Net.Http.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class OrderValidationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CreateOrderInput Input() => new(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), " خریدار آزمایشی ", "+۹۸۹۱۲۱۲۳۴۵۶۷", new("IR", " استان ", " شهر ", "نشانی آزمون\r\nدادهٔ واقعی نیست", "۱۲۳۴۵۶۷۸۹۰"), " یادداشت\r\nآزمون ", true);
    [Fact] public void ContactAndAddressNormalizeWithoutChangingRialOrInventingDelivery()
    {
        var result = OrderInputRules.Normalize(Input()); Assert.Equal("09121234567", result.ContactPhone); Assert.Equal("خریدار آزمایشی", result.ContactName); Assert.Equal("1234567890", result.Delivery!.PostalCode); Assert.DoesNotContain('\r', result.Delivery.Address); Assert.Equal(32, result.QuoteId.Length); Assert.Equal(32, result.RequestId.Length);
        Assert.Null(OrderInputRules.Normalize(Input() with { Delivery = null }).Delivery);
    }
    [Theory][InlineData("consent")][InlineData("phone")][InlineData("name")][InlineData("quote")][InlineData("request")][InlineData("country")][InlineData("postal")][InlineData("address")][InlineData("note")]
    public void InvalidOrderInputIsRejectedBeforeSql(string kind)
    {
        var input = Input(); input = kind switch { "consent" => input with { AcknowledgeTemporary = false }, "phone" => input with { ContactPhone = "123" }, "name" => input with { ContactName = "x" }, "quote" => input with { QuoteId = "not-an-id" }, "request" => input with { RequestId = Guid.Empty.ToString() }, "country" => input with { Delivery = input.Delivery! with { CountryCode = "GB" } }, "postal" => input with { Delivery = input.Delivery! with { PostalCode = "123" } }, "address" => input with { Delivery = input.Delivery! with { Address = "short" } }, _ => input with { Note = new string('n', 501) } }; Assert.Throws<BusinessException>(() => OrderInputRules.Normalize(input));
    }
    [Theory][InlineData(0,1)][InlineData(61,1)][InlineData(15,0)][InlineData(15,11)]
    public void ReservationAndOpenOrderCapsAreBounded(int minutes, int max) => Assert.Throws<BusinessException>(() => CheckoutOrderSettingsService.Validate(new(true, minutes, max, null)));
    [Theory][InlineData("online",true,false,"10",true)][InlineData("cheque",true,false,"10",false)][InlineData("installment",true,false,"10",false)][InlineData("online",false,false,"10",false)][InlineData("online",true,true,"10",false)][InlineData("online",true,false,null,false)][InlineData("online",true,false,"0",false)]
    public void TemporaryOrderAvailabilityHonorsWorkflowAndKnownPositiveTotal(string kind, bool enabled, bool approval, string? total, bool expected)
    {
        var method = new PurchaseMethodData("m",kind,"Method","",enabled,approval,[],null,null); Assert.Equal(expected,CheckoutOrderSettingsService.Option(new(){TemporaryOrdersEnabled=true},method,total).CanCreate); Assert.False(CheckoutOrderSettingsService.Option(new(),method,total).CanCreate);
    }
    [Theory][InlineData("/api/orders")][InlineData("/api/orders/01234567890123456789012345678901")][InlineData("/api/admin/order-settings")][InlineData("/api/admin/orders")]
    public async Task OrderAndSettingsReadsRequireAuthentication(string path)
    {
        using var client=factory.CreateClient();using var response=await client.GetAsync(path);Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);
    }
    [Theory][InlineData("mfa_pending","")][InlineData("access","cms.write")][InlineData("access","sales.read")]
    public async Task StaffCannotEnableOrdersWithoutSalesWrite(string kind,string permissions)
    {
        using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind",kind);client.DefaultRequestHeaders.Add("X-Test-Permissions",permissions);using var response=await client.PutAsJsonAsync("/api/admin/order-settings",new CheckoutOrderSettingsInput(true,15,1,null));Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
    }
    [Fact] public async Task GuestCannotCreateTemporaryOrder(){using var client=factory.CreateClient();using var response=await client.PostAsJsonAsync("/api/orders",Input());Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);}
}
