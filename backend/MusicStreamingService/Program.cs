using Hangfire;
using Hangfire.MemoryStorage;
using MusicStreamingService.Services;

namespace MusicStreamingService;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.

        builder.Services.AddControllers();
        builder.Services.AddSingleton<CloudflareR2Service>();
        builder.Services.AddSingleton<FFmpegService>();
        builder.Services.AddHangfire(config => config
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UseMemoryStorage());
        builder.Services.AddHangfireServer();
        builder.Services.AddSingleton<TrackProcessingService>();
        builder.Services.AddSignalR();
        builder.Services.AddOpenApi();

        var app = builder.Build();

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseHttpsRedirection();

        app.UseAuthorization();
        app.UseHangfireDashboard();
        
        app.MapControllers();

        app.Run();
    }
}