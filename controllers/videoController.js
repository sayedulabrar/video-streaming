const path = require('path');
const fs = require('fs');
const { processVideo } = require('../services/ffmpegService');
const { v4: uuidv4 } = require('uuid');

const uploadVideo = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Generate unique folder name
    const folderId = uuidv4();
    const inputPath = req.file.path;
    const outputDir = path.join(__dirname, '..', 'video', folderId);

    // Create folder if it doesn't exist
    fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'video.mpd');

    const taskId = await processVideo(inputPath, outputPath);

    res.json({
        message: 'Video uploaded, processing started',
        taskId,
    });
};

const getTaskStatus = (req, res) => {
    const { taskId } = req.params;
    const status = global.taskStatus[taskId];

    if (!status) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json(status);
};

const getDashManifest = (req, res) => {
    const { folderId } = req.params; 
    const filePath = path.join(__dirname, '..', 'video', folderId, 'video.mpd');

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'DASH manifest not found' });
    }

    res.setHeader('Content-Type', 'application/dash+xml');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending manifest:', err);
            res.status(500).json({ error: 'Error reading manifest file' });
        }
    });
};


const getDashSegment = (req, res) => {
    const {folderId,segment }  = req.params;
    const filePath = path.join(__dirname, '..', 'video',folderId, segment);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Segment file not found' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending segment:', err);
            res.status(500).json({ error: 'Error reading segment file' });
        }
    });
};

module.exports = { uploadVideo, getTaskStatus, getDashManifest, getDashSegment };