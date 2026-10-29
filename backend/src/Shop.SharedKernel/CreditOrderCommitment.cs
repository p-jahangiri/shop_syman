namespace Shop.SharedKernel;
// Internal server-only boundary. No HTTP body binds this proof. Credit owns
// manual financial authorization; Sales and Inventory own stock commitment.
public sealed record CreditOrderCommitmentProof(string OwnerId,string OrderId,string OrderVersion,string QuoteFingerprint,long PayableTotalRial,string ActorId,DateTimeOffset AuthorizedAt);
public sealed record CreditOrderCommitmentState(string OrderId,string OrderVersion,string State,string ReservationState,string? ShipmentState,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]bool HasRemainingPartialDispatch=false);
public sealed record CreditDispatchAuthority(bool Authorized,DateTimeOffset? RecordedAt);
public interface ICreditOrderCommitments
{
    Task<CreditOrderCommitmentState> ReadAsync(string owner,string order,CancellationToken ct);
    Task<CreditOrderCommitmentState> CommitAsync(CreditOrderCommitmentProof proof,CancellationToken ct);
}
public interface ICreditFulfillmentAuthorization
{
    Task<bool> IsAuthorizedAsync(string owner,string order,CancellationToken ct);
    Task<CreditDispatchAuthority> ReadAuthorityAsync(string owner,string order,CancellationToken ct);
}
