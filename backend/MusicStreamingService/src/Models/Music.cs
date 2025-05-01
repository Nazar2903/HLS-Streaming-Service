namespace MusicStreamingService.Models;

public class Music
{
    public int Id { get; set; }
    public string? Title { get; set; }
    public string? Artist { get; set; }
    public string? Album { get; set; }
    public string? FileUrl { get; set; }
    public DateTime UploadedAt { get; set; }
}