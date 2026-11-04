using System.Text.Json.Nodes;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public static class CustomerAuthSettingsRules
{
    // Draft intent is structural. Publication separately checks actual Identity
    // capability and every existing customer's supported identifiers.
    public static void RequireSupportedLogin(JsonObject value)
    {
        if (value["emailPassword"]?.GetValue<bool>() != true && value["usernamePassword"]?.GetValue<bool>() != true
            && value["mobileOtp"]?.GetValue<bool>() != true)
            throw new BusinessException("no_supported_login_method", "Select at least one customer login method: email/password, username/password or mobile OTP.");
    }

    public static void ApplyEffective(JsonObject value, bool mobileOtpAvailable = false)
    {
        value["mobileOtp"] = mobileOtpAvailable && value["mobileOtp"]?.GetValue<bool>() == true;
        value["registration"] = value["mobileOtp"]?.GetValue<bool>() == true
            && value["registration"]?.GetValue<bool>() == true;
        value["passwordReset"] = false;
    }
}
