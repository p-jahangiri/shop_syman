namespace Shop.SharedKernel;

// Internal module boundary. Resource modules must authorize their own resource
// before supplying this scope; no endpoint exposes arbitrary scope or owner.
public sealed record PrivateFileScope(string Kind,string ResourceId,string OwnerId);
public sealed record PrivateFileInput(string ActorId,string CommandId,string ResourceVersion,string Filename,string ContentType,byte[] Bytes,string IntentHash);
public sealed record PreparedPrivateFile(string Id,string PayloadHash,int Bytes,string ContentType);
public sealed record PrivateFileDownload(string Filename,string ContentType,byte[] Bytes);
public sealed record PrivateFileDescriptor(string Filename,string ContentType,int Bytes);
public interface IPrivateFileVault
{
    bool Configured { get; }
    Task<PreparedPrivateFile> PrepareAsync(PrivateFileScope scope,PrivateFileInput input,CancellationToken ct);
    Task AttachAsync(PrivateFileScope scope,string fileId,string actorId,string commandId,string intentHash,CancellationToken ct);
    Task<PrivateFileDescriptor> DescribeAsync(PrivateFileScope scope,string fileId,CancellationToken ct);
    Task<PrivateFileDownload> ReadAsync(PrivateFileScope scope,string fileId,CancellationToken ct);
}
