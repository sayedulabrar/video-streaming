const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

global.taskStatus = {};

// Helper to check if input has audio stream using ffprobe
const hasAudioStream = (inputPath) => {
  return new Promise((resolve) => {
    exec(`ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${inputPath}"`, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(stdout.trim().length > 0);
    });
  });
};

const processVideo = async (inputPath, outputPath) => {
  const taskId = uuidv4();
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  global.taskStatus[taskId] = { status: 'processing', message: 'Checking for audio stream...' };

  const audioExists = await hasAudioStream(inputPath);

  global.taskStatus[taskId] = { status: 'processing', message: 'FFmpeg task started' };

  const ffmpegArgs = [
    '-i', inputPath,

    // 360p
    '-map', '0:v', '-b:v:0', '800k', '-s:v:0', '640x360', '-aspect:v:0', '16:9', '-c:v:0', 'libx264', '-profile:v:0', 'main', '-preset', 'fast', '-keyint_min', '48', '-g', '48', '-sc_threshold', '0',

    // 480p
    '-map', '0:v', '-b:v:1', '1400k', '-s:v:1', '852x480', '-aspect:v:1', '16:9', '-c:v:1', 'libx264', '-profile:v:1', 'main', '-preset', 'fast', '-keyint_min', '48', '-g', '48', '-sc_threshold', '0',

    // 720p
    '-map', '0:v', '-b:v:2', '2800k', '-s:v:2', '1280x720', '-aspect:v:2', '16:9', '-c:v:2', 'libx264', '-profile:v:2', 'main', '-preset', 'fast', '-keyint_min', '48', '-g', '48', '-sc_threshold', '0',
  ];

  if (audioExists) {
    ffmpegArgs.push(
      '-map', '0:a:0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-adaptation_sets', 'id=0,streams=0,1,2 id=1,streams=3'
    );
  } else {
    ffmpegArgs.push(
      '-adaptation_sets', 'id=0,streams=0,1,2'
    );
  }

  ffmpegArgs.push('-f', 'dash', outputPath);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });

  ffmpeg.stderr.on('data', (data) => {
    console.log(`FFmpeg stderr: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      global.taskStatus[taskId] = { status: 'completed', message: 'Video processing completed successfully' };
      console.log(`FFmpeg task ${taskId} completed`);
      fs.unlink(inputPath, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
    } else {
      global.taskStatus[taskId] = { status: 'failed', message: `FFmpeg task failed with code ${code}` };
      console.error(`FFmpeg task ${taskId} failed with code ${code}`);
    }
  });

  ffmpeg.on('error', (err) => {
    global.taskStatus[taskId] = { status: 'failed', message: `FFmpeg error: ${err.message}` };
    console.error('FFmpeg error:', err);
  });

  return taskId;
};

module.exports = { processVideo };
