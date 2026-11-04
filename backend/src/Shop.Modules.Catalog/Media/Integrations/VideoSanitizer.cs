using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed record VideoToolOptions(string? Ffmpeg, string? Ffprobe, int TimeoutSeconds = 90);
public sealed class FfmpegVideoSanitizer(VideoToolOptions options) : IVideoSanitizer
{
    public bool Configured => options.TimeoutSeconds is >= 1 and <= 120 && System.IO.Path.IsPathFullyQualified(options.Ffmpeg ?? "") && System.IO.Path.IsPathFullyQualified(options.Ffprobe ?? "") && File.Exists(options.Ffmpeg) && File.Exists(options.Ffprobe);
    private sealed record Probe(int Width, int Height, int Milliseconds);
    private static BusinessException Invalid() => new("invalid_video", "Use an MP4(H264/AAC) or WebM(VP8/VP9 and Opus/Vorbis), up to ten minutes and4096pixels per edge.");
    public async Task<SanitizedVideo> SanitizeAsync(byte[] bytes, string extension, CancellationToken ct)
    {
        if (!Configured)
            throw new BusinessException("media_unavailable", "Video processing is unavailable.");
        if (extension is not ("mp4" or "webm") || bytes.Length is < 12 or > VideoLimits.MaxInputBytes)
            throw Invalid();
        var directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "sayman-video-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));
        try
        {
            var input = System.IO.Path.Combine(directory, "source." + extension);
            var output = System.IO.Path.Combine(directory, "clean." + extension);
            await File.WriteAllBytesAsync(input, bytes, deadline.Token);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(input, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            var original = await InspectAsync(input, extension, deadline.Token);
            var arguments = new List<string> { "-nostdin", "-v", "error", "-max_alloc", "67108864", "-threads", "1", "-protocol_whitelist", "file,pipe", "-probesize", "1048576", "-analyzeduration", "5000000", "-f", extension == "mp4" ? "mov" : "matroska" };
            if (extension == "mp4")
                arguments.AddRange(["-enable_drefs", "0", "-use_absolute_path", "0"]);
            arguments.AddRange(["-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-c", "copy", "-fflags", "+bitexact", "-t", "600", "-fs", VideoLimits.MaxOutputBytes.ToString(CultureInfo.InvariantCulture)]);
            if (extension == "mp4")
                arguments.AddRange(["-movflags", "+faststart"]);
            arguments.AddRange(["-f", extension == "mp4" ? "mp4" : "webm", output]);
            await RunAsync(options.Ffmpeg!, arguments, deadline.Token);
            var info = new FileInfo(output);
            if (!info.Exists || info.Length is < 12 or >= VideoLimits.MaxOutputBytes)
                throw Invalid();
            var clean = await InspectAsync(output, extension, deadline.Token);
            if (Math.Abs(clean.Milliseconds - original.Milliseconds) > 250 || clean.Width != original.Width || clean.Height != original.Height)
                throw Invalid();
            var result = await File.ReadAllBytesAsync(output, deadline.Token);
            return new(result, extension, Convert.ToHexStringLower(SHA256.HashData(result)), clean.Width, clean.Height, clean.Milliseconds);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new BusinessException("media_unavailable", "Video processing timed out."); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException) { throw new BusinessException("media_unavailable", "Video processing is unavailable."); }
        finally { try { Directory.Delete(directory, true); } catch (IOException) {/* No public path points at this private staging directory. */} }
    }
    private async Task<Probe> InspectAsync(string path, string extension, CancellationToken ct)
    {
        var args = new List<string> { "-v", "error", "-max_alloc", "67108864", "-threads", "1", "-protocol_whitelist", "file,pipe", "-probesize", "1048576", "-analyzeduration", "5000000", "-f", extension == "mp4" ? "mov" : "matroska" };
        if (extension == "mp4")
            args.AddRange(["-enable_drefs", "0", "-use_absolute_path", "0"]);
        args.AddRange(["-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration", "-of", "json", path]);
        var text = await RunAsync(options.Ffprobe!, args, ct);
        try
        {
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            var streams = root.GetProperty("streams").EnumerateArray().ToArray();
            if (streams.Length is < 1 or > 4 || streams.Any(s => s.GetProperty("codec_type").GetString() is not ("video" or "audio")))
                throw Invalid();
            var videos = streams.Where(s => s.GetProperty("codec_type").GetString() == "video").ToArray();
            if (videos.Length != 1)
                throw Invalid();
            var video = videos[0];
            var codec = video.GetProperty("codec_name").GetString();
            if (extension == "mp4" ? codec != "h264" : codec is not ("vp8" or "vp9"))
                throw Invalid();
            if (streams.Where(s => s.GetProperty("codec_type").GetString() == "audio").Any(s => extension == "mp4" ? s.GetProperty("codec_name").GetString() != "aac" : s.GetProperty("codec_name").GetString() is not ("opus" or "vorbis")))
                throw Invalid();
            var width = video.GetProperty("width").GetInt32();
            var height = video.GetProperty("height").GetInt32();
            var duration = double.Parse(root.GetProperty("format").GetProperty("duration").GetString()!, CultureInfo.InvariantCulture);
            var rate = video.GetProperty("avg_frame_rate").GetString()!.Split('/');
            var fps = rate.Length == 2 ? double.Parse(rate[0], CultureInfo.InvariantCulture) / double.Parse(rate[1], CultureInfo.InvariantCulture) : 0;
            if (width is < 1 or > 4096 || height is < 1 or > 4096 || (long)width * height > 9_000_000 || !double.IsFinite(duration) || duration is <= 0 or > VideoLimits.MaxSeconds || !double.IsFinite(fps) || fps is <= 0 or > 120)
                throw Invalid();
            return new(width, height, checked((int)Math.Ceiling(duration * 1000)));
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException) { throw Invalid(); }
    }
    private static async Task<string> RunAsync(string file, IEnumerable<string> arguments, CancellationToken ct)
    {
        var start = new ProcessStartInfo(file) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        foreach (var argument in arguments)
            start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new BusinessException("media_unavailable", "Video processing did not start.");
        async Task<string> ReadAsync(StreamReader reader)
        {
            var output = new StringBuilder();
            var buffer = new char[2048];
            while (true)
            {
                var read = await reader.ReadAsync(buffer, ct);
                if (read == 0)
                    break;
                if (output.Length + read > 32768)
                    throw Invalid();
                output.Append(buffer, 0, read);
            }
            return output.ToString();
        }
        try
        {
            var stdout = ReadAsync(process.StandardOutput);
            var stderr = ReadAsync(process.StandardError);
            await Task.WhenAll(stdout, stderr, process.WaitForExitAsync(ct));
            if (process.ExitCode != 0)
                throw Invalid();
            return await stdout;
        }
        finally { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); } }
    }
}
