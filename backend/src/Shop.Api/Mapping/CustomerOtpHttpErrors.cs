public static class CustomerOtpHttpErrors
{
    public static int? Status(string code) => code switch
    {
        "otp_invalid" => 401,
        "otp_expired" => 410,
        "otp_cooldown" or "otp_rate_limited" => 429,
        "otp_unavailable" or "otp_delivery_rejected" => 503,
        "otp_configuration_conflict" or "sms_settings_conflict" => 409,
        "invalid_otp" or "invalid_sms_settings" => 400,
        _ => null
    };

    // Public auth errors never relay provider messages, input, or diagnostics.
    public static string Message(string code) => code switch
    {
        "otp_invalid" => "The verification is invalid or unavailable.",
        "otp_expired" => "The verification has expired. Request a new code.",
        "otp_cooldown" or "otp_rate_limited" => "Wait before requesting another verification.",
        "otp_unavailable" or "otp_delivery_rejected" => "Customer SMS sign-in is unavailable.",
        "otp_configuration_conflict" or "sms_settings_conflict" => "The settings changed. Reload before continuing.",
        _ => "Check the SMS verification settings and fields."
    };
}
