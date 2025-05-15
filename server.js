require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// Перевірка ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
try {
  require('child_process').execSync('ffmpeg -version');
} catch (err) {
  console.error('FFmpeg not found or inaccessible:', err.message);
}

// Перевірка AWS credentials
if (!process.env.AWS_ACCESS_KEY || !process.env.AWS_SECRET_KEY) {
  console.error('Error: AWS_ACCESS_KEY or AWS_SECRET_KEY is missing in .env');
  process.exit(1);
}

const app = express();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/hls_streaming').then(() => {
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const TrackSchema = new mongoose.Schema({
  name: String,
  url: String,
  folder: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const User = mongoose.model('User', UserSchema);
const Track = mongoose.model('Track', TrackSchema);

app.use(express.json());
app.use(express.static('public'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
  })
);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = './public/uploads/temp/';
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Тільки аудіофайли!'), false);
    }
  },
});

const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Не авторизовано' });
  }
};

const convertToHLS = (inputPath, outputFolder, outputFileName) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:a aac',
        '-b:a 64k',
        '-hls_time 5',
        '-hls_list_size 0',
        '-hls_segment_filename',
        `${outputFolder}/segment_%03d.ts`,
        '-preset ultrafast',
      ])
      .output(`${outputFolder}/${outputFileName}`)
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
};

app.post('/api/register', async (req, res) => {
  const { email, username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, username, password: hashedPassword });
    await user.save();
    req.session.userId = user._id;
    res.json({ user: { username } });
  } catch (err) {
    res.status(400).json({ message: 'Користувач вже існує' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.userId = user._id;
      res.json({ user: { username } });
    } else {
      res.status(400).json({ message: 'Невірний логін або пароль' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Помилка сервера' });
  }
});

app.get('/api/user', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) throw new Error('User not found');
    res.json({ user: { username: user.username } });
  } catch (err) {
    res.status(500).json({ message: 'Помилка сервера' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Вихід виконано' });
});

app.post('/api/upload', isAuthenticated, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Файл не завантажено' });
    }

    const trackId = Date.now();
    const outputFolder = `./uploads/temp/track_${trackId}`;
    const outputFileName = 'playlist.m3u8';

    await fs.mkdir(outputFolder, { recursive: true });

    console.time('HLS Conversion');
    await convertToHLS(req.file.path, outputFolder, outputFileName);
    console.timeEnd('HLS Conversion');

    const files = await fs.readdir(outputFolder);
    if (!files.length) {
      return res.status(500).json({ message: 'HLS файли не створено' });
    }

    const uploadPromises = files.map(async (file) => {
      const filePath = path.join(outputFolder, file);
      const fileContent = await fs.readFile(filePath);
      return s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || 'hls-streaming-files',
        Key: `track_${trackId}/${file}`,
        Body: fileContent,
        ContentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T',
        CacheControl: 'max-age=31536000',
        ACL: 'public-read',
      }));
    });

    console.time('S3 Upload');
    await Promise.all(uploadPromises);
    console.timeEnd('S3 Upload');

    await fs.rm(outputFolder, { recursive: true, force: true });
    await fs.unlink(req.file.path);

    const track = new Track({
      name: req.file.originalname,
      url: `https://${process.env.S3_BUCKET_NAME || 'hls-streaming-files'}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/track_${trackId}/${outputFileName}`,
      folder: `track_${trackId}`,
      userId: req.session.userId,
    });
    await track.save();

    res.json({ message: 'Трек завантажено' });
  } catch (err) {
    res.status(500).json({ message: 'Помилка завантаження: ' + err.message });
  }
});

app.get('/api/tracks', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const tracks = await Track.find({ userId: req.session.userId })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ message: 'Помилка сервера' });
  }
});

app.delete('/api/tracks/:id', isAuthenticated, async (req, res) => {
  try {
    const track = await Track.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!track) {
      return res.status(404).json({ message: 'Трек не знайдено' });
    }

    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: 'hls-streaming-files',
        Prefix: track.folder,
      })
    );
    if (listResponse.Contents?.length) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: 'hls-streaming-files',
          Delete: { Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })) },
        })
      );
    }

    await Track.deleteOne({ _id: req.params.id });
    res.json({ message: 'Трек видалено' });
  } catch (err) {
    res.status(500).json({ message: 'Помилка сервера' });
  }
});

app.get('/api/test-s3', async (req, res) => {
  try {
    const response = await s3Client.send(
      new ListObjectsV2Command({ Bucket: 'hls-streaming-files' })
    );
    res.json({ message: 'S3 доступний', contents: response.Contents });
  } catch (err) {
    res.status(500).json({ message: 'S3 помилка: ' + err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => console.log('Сервер запущено на порту 3000'));