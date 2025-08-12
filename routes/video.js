const express = require('express');
const multer = require('multer');
const { uploadVideo, getTaskStatus, getDashManifest, getDashSegment } = require('../controllers/videoController');

const router = express.Router();

// Multer configuration
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'));
        }
    },
    limits: { fileSize: 100 * 1024 * 1024 } 
});

router.post('/upload', upload.single('video'), uploadVideo);
router.get('/status/:taskId', getTaskStatus);
router.get('/video/:folderId/video.mpd', getDashManifest);
router.get('/video/:folderId/:segment', getDashSegment);

module.exports = router;