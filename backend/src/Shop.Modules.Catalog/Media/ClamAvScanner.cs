using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed record ClamAvOptions(string? Host,int Port=3310,int TimeoutSeconds=10);
public sealed class ClamAvScanner(ClamAvOptions options):IImageScanner
{
    public bool Configured=>!string.IsNullOrWhiteSpace(options.Host)&&options.Port is >0 and <=65535&&options.TimeoutSeconds is >=1 and <=60;
    public async Task ScanAsync(ReadOnlyMemory<byte> input,CancellationToken ct)
    {
        if(!Configured)throw Unavailable();
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));
        try{
            using var client=new TcpClient();await client.ConnectAsync(options.Host!,options.Port,timeout.Token);await using var stream=client.GetStream();
            await stream.WriteAsync("zINSTREAM\0"u8.ToArray(),timeout.Token);var size=new byte[4];
            for(var offset=0;offset<input.Length;offset+=65536){var chunk=input.Slice(offset,Math.Min(65536,input.Length-offset));BinaryPrimitives.WriteInt32BigEndian(size,chunk.Length);await stream.WriteAsync(size,timeout.Token);await stream.WriteAsync(chunk,timeout.Token);}
            await stream.WriteAsync(new byte[4],timeout.Token);await stream.FlushAsync(timeout.Token);
            var reply=new List<byte>();var one=new byte[1];
            while(reply.Count<512){if(await stream.ReadAsync(one,timeout.Token)==0)throw Unavailable();if(one[0]==0){var message=Encoding.UTF8.GetString(reply.ToArray());if(message=="stream: OK")return;if(message.EndsWith(" FOUND",StringComparison.Ordinal))throw new BusinessException("image_rejected","The file did not pass malware scanning.");throw Unavailable();}reply.Add(one[0]);}
            throw Unavailable();
        }catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw Unavailable();}
        catch(Exception e)when(e is IOException or SocketException){throw Unavailable();}
    }
    private static BusinessException Unavailable()=>new("media_unavailable","Image scanning is unavailable. No image has been published.");
}
