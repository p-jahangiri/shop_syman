using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text;
using Shop.SharedKernel;
namespace Shop.Modules.Files;
public interface IPrivateFileScanner
{
    bool Configured{get;}
    Task ScanAsync(ReadOnlyMemory<byte> bytes,CancellationToken ct);
}
public sealed record PrivateFileScanOptions(string? Host,int Port=3310,int TimeoutSeconds=10);
public sealed class ClamAvPrivateFileScanner(PrivateFileScanOptions options):IPrivateFileScanner
{
    public bool Configured=>!string.IsNullOrWhiteSpace(options.Host)&&options.Port is >0 and <=65535&&options.TimeoutSeconds is >=1 and <=60;
    public async Task ScanAsync(ReadOnlyMemory<byte> bytes,CancellationToken ct)
    {
        if(!Configured||bytes.Length is <16 or >PrivateFileRules.MaxBytes)throw PrivateFileRules.Unavailable();using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));
        try{
            using var client=new TcpClient();await client.ConnectAsync(options.Host!,options.Port,timeout.Token);await using var stream=client.GetStream();await stream.WriteAsync("zINSTREAM\0"u8.ToArray(),timeout.Token);var length=new byte[4];
            for(var offset=0;offset<bytes.Length;offset+=65536){var chunk=bytes.Slice(offset,Math.Min(65536,bytes.Length-offset));BinaryPrimitives.WriteInt32BigEndian(length,chunk.Length);await stream.WriteAsync(length,timeout.Token);await stream.WriteAsync(chunk,timeout.Token);}await stream.WriteAsync(new byte[4],timeout.Token);await stream.FlushAsync(timeout.Token);
            var response=new List<byte>();var one=new byte[1];while(response.Count<512){if(await stream.ReadAsync(one,timeout.Token)==0)throw PrivateFileRules.Unavailable();if(one[0]==0){var text=Encoding.UTF8.GetString(response.ToArray());if(text=="stream: OK")return;if(text.StartsWith("stream: ",StringComparison.Ordinal)&&text.EndsWith(" FOUND",StringComparison.Ordinal))throw new BusinessException("private_file_rejected","The document did not pass malware scanning.");throw PrivateFileRules.Unavailable();}response.Add(one[0]);}throw PrivateFileRules.Unavailable();
        }catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw PrivateFileRules.Unavailable();}catch(Exception e)when(e is IOException or SocketException){throw PrivateFileRules.Unavailable();}
    }
}
