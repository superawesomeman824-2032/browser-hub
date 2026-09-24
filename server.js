const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const app = express();

// Serve your index.html from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// The Proxy setup
app.use('/proxy', createProxyMiddleware({
    // 1. Decode the hidden URL from the frontend
    router: function(req) {
        if (!req.query.url) return 'http://localhost';
        return Buffer.from(req.query.url, 'base64').toString('utf-8');
    },
    changeOrigin: true,
    ws: true, // Supports websockets (needed for games like Defly or chat apps)
    
    // 2. Fix the Blank White Screen by deleting blocking headers
    onProxyRes: function(proxyRes, req, res) {
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
    },
    
    // 3. Fix 502 Errors by catching crashes gracefully
    onError: function(err, req, res) {
        console.error("Proxy Error:", err.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Proxy encountered an error, but the server is still running.');
        }
    }
}));

app.listen(3000, () => {
    console.log('Browser backend running on port 3000');
});
