using System.Diagnostics;

namespace MusicStreamingService.Services;

public class FFmpegService
{
    public FFmpegService()
    {
        _ffmpegPath = @"C:\Programming\ffmpeg\bin\ffmpeg.exe";
    }
    
    private readonly string _ffmpegPath;
    
    public async Task<List<string>> ConvertToHlsAsync(string inputFile, string outputDir)
    {
        try
        {
            Directory.CreateDirectory(outputDir);
            
            var outputPlaylist = Path.Combine(outputDir, "master.m3u8");
            var segmentPattern = Path.Combine(outputDir, "segment_%03d.ts");
            
            var ffmpegCommand = $"-i \"{inputFile}\" -map 0:a -c:a aac -b:a 192k -hls_time 10 -hls_list_size 0 -hls_segment_type mpegts -hls_segment_filename \"{segmentPattern}\" \"{outputPlaylist}\"";

            var processInfo = new ProcessStartInfo
            {
                FileName = _ffmpegPath,
                Arguments = ffmpegCommand,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (var process = new Process { StartInfo = processInfo })
            {
                process.Start();
                
                string error = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode != 0)
                {
                    throw new Exception(error);
                }
            }

            var generatedFiles = Directory.GetFiles(outputDir)
                .Where(file => file.EndsWith(".ts") || file.EndsWith(".m3u8")).ToList();
            
            return generatedFiles;
        }
        catch (Exception e)
        {
            throw new Exception(e.Message);
        }
    }
}