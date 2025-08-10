const express = require('express');
const cors = require('cors');
const videoRoutes = require('./routes/video');


const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
// app.use(byteTracker);

// Routes
app.use('/api', videoRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});