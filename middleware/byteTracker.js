let totalBytesSent = 0;

const byteTracker = (req, res, next) => {
    let bytesSent = 0;
    const originalWrite = res.write;
    const originalEnd = res.end;

    res.write = function (chunk, encoding, callback) {
        if (chunk) {
            bytesSent += Buffer.byteLength(chunk, encoding);
        }
        return originalWrite.call(res, chunk, encoding, callback);
    };

    res.end = function (chunk, encoding, callback) {
        if (chunk) {
            bytesSent += Buffer.byteLength(chunk, encoding);
        }
        totalBytesSent += bytesSent;
        console.log(`Bytes sent for this request: ${bytesSent} (${req.url})`);
        console.log(`Total bytes sent so far: ${totalBytesSent}`);
        return originalEnd.call(res, chunk, encoding, callback);
    };

    next();
};

module.exports = byteTracker;