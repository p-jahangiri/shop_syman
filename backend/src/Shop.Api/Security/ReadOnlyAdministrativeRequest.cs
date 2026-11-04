// Endpoint-owned metadata: a bounded POST read must not create an audit write
// or open a write transaction. It never bypasses authentication/authorization.
public sealed class ReadOnlyAdministrativeRequest;
