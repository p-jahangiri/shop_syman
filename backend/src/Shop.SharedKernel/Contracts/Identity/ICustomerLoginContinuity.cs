namespace Shop.SharedKernel;

// Identity owns account eligibility and actual identifier lookup semantics.
// Called from the root audited Serializable Identity/CMS transaction before
// publishing or restoring restrictive customer login settings. No account data
// or account counts cross this private boundary.
public interface ICustomerLoginContinuity
{
    Task RequireAsync(bool emailEnabled,bool usernameEnabled,CancellationToken ct);
    Task RequireAsync(bool emailEnabled, bool usernameEnabled, bool mobileOtpEnabled, CancellationToken ct)
        => RequireAsync(emailEnabled, usernameEnabled, ct);
}
