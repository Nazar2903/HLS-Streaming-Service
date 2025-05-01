using Microsoft.AspNetCore.SignalR;

namespace MusicStreamingService.Services;

public class TrackProcessingService
{
    public TrackProcessingService(FFmpegService ffmpegService, CloudflareR2Service r2Service)
    {
        _ffmpegService = ffmpegService;
        _r2Service = r2Service;
    }
    
    private readonly FFmpegService _ffmpegService;
    private readonly CloudflareR2Service _r2Service;

    public async Task<string> ProcessTrackUploadAsync(string inputFile, string tempDir, string trackId)
    {
        try
        {
            var hlsFiles = await _ffmpegService.ConvertToHlsAsync(inputFile, tempDir);
            var uploadTasks = new List<Task<(string filePath, string url)>>();
            
            foreach (var hlsFile in hlsFiles)
            {
                var key = $"music/{trackId}/{Path.GetFileName(hlsFile)}";
                var contentType = hlsFile.EndsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";

                uploadTasks.Add(Task.Run(async () =>
                {
                    using (var fileStream = new FileStream(hlsFile, FileMode.Open, FileAccess.Read))
                    {
                        var url = await _r2Service.UploadMusicToR2Async(fileStream, contentType, key);
                        return (hlsFile, url);
                    }
                }));
            }
            
            var results = await Task.WhenAll(uploadTasks);
            var playlistUrl = results.FirstOrDefault(r => r.filePath.EndsWith("master.m3u8")).url;

            return playlistUrl;
        }
        catch (Exception e)
        {
            throw new(e.Message);
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch (Exception e)
            {
                throw new(e.Message);
            }
        }
    }
}