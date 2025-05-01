using Amazon.S3;
using Amazon.S3.Model;

namespace MusicStreamingService.Services;

public class CloudflareR2Service
{
    public CloudflareR2Service(IConfiguration configuration)
    {
        var accessKey = configuration["CloudflareR2:AccessKey"];
        var secretKey = configuration["CloudflareR2:SecretAccessKey"];
        var accountId = configuration["CloudflareR2:AccountId"];
        _bucketName = configuration["CloudflareR2:BucketName"];

        var s3Config = new AmazonS3Config
        {
            ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true
        };
        
        _s3Client = new AmazonS3Client(accessKey, secretKey, s3Config);
    }
    
    private readonly IAmazonS3 _s3Client;
    private readonly string? _bucketName;

    public async Task<string> UploadMusicToR2Async(Stream fileStream, string contentType, string key)
    {
        try
        {
            using (var memoryStream = new MemoryStream())
            {
                await fileStream.CopyToAsync(memoryStream);
                memoryStream.Position = 0;
                
                var request = new PutObjectRequest
                {
                    BucketName = _bucketName,
                    Key = key,
                    InputStream = memoryStream,
                    ContentType = contentType,
                    Headers = { ContentLength = memoryStream.Length },
                    UseChunkEncoding = false
                };
                    
                await _s3Client.PutObjectAsync(request);

                return $"https://93b7cc0640c9d24e1f38d38c0ca99462.r2.cloudflarestorage.com/{_bucketName}/{key}";
            }
        }
        catch (Exception e)
        {
            Console.WriteLine(e);
            throw;
        }
    }
}