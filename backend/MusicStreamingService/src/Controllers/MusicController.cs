using System.Diagnostics;
using Hangfire;
using Microsoft.AspNetCore.Mvc;
using MusicStreamingService.Services;

namespace MusicStreamingService.Controllers;

[Route("api/[controller]")]
[ApiController]
public class MusicController : ControllerBase
{
    public MusicController(TrackProcessingService trackProcessingService, IBackgroundJobClient backgroundJobClient)
    {
        _trackProcessingService = trackProcessingService;
        _backgroundJobClient = backgroundJobClient;
    }
    
    private readonly TrackProcessingService _trackProcessingService;
    private readonly IBackgroundJobClient _backgroundJobClient;

    [HttpPost("upload")]
    public async Task<ActionResult> UploadMusicAsync(IFormFile file)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest("No file uploaded!");
        }

        try
        {
            var trackId = Guid.NewGuid().ToString();
            var tempDir = Path.Combine(Path.GetTempPath(), trackId);
            var inputFile = Path.Combine(tempDir, file.FileName);
            
            Directory.CreateDirectory(tempDir);

            using (var stream = new FileStream(inputFile, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }
            
            _backgroundJobClient.Enqueue(() => _trackProcessingService.ProcessTrackUploadAsync(inputFile, tempDir, trackId));

            return Ok(new { Status = "The song is being processed..." });
        }
        catch (Exception e)
        {
            return StatusCode(500, e.Message);
        }
    }
}