const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const https = require('https');

const app = express();

// Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Search Suggestions API endpoint (powers the address bar dropdown)
app.get('/api/suggestions', (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  const googleSuggestUrl = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;

  https.get(googleSuggestUrl, (googleRes) => {
    let data = '';
    googleRes.on('data', (chunk) => { data += chunk; });
    googleRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        // Google Suggest returns [query, [suggestionsArray], ...]
        res.json(parsed[1] || []);
      } catch (err) {
        res.json([]);
      }
    });
  }).on('error', () => {
    res.json([]);
  });
});

// Proxy middleware to strip restrictions and handle target routing
app.use('/proxy', createProxyMiddleware({
  // Dynamically decode and set the target URL for each request
  router: function(req) {
    if (!req.query.url) return 'https://www.google.com';
    try {
      // Safely decode the Base64 string sent by the frontend
      let decodedUrl = Buffer.from(req.query.url, 'base64').toString('utf-8');
      
      // Ensure the URL starts with http:// or https://
      if (!/^https?:\/\//i.test(decodedUrl)) {
        decodedUrl = 'https://' + decodedUrl;
      }
      return decodedUrl;
    } catch (err) {
      console.error("URL decoding failed:", err.message);
      return 'https://www.google.com'; // Fallback to prevent 500 server crash
    }
  },
  changeOrigin: true,
  ws: true, // Enables WebSocket support for multiplayer games and live apps

  // Remove security headers that prevent websites from loading in an iframe
  onProxyRes: function(proxyRes, req, res) {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['frame-options'];
  },

  // Graceful error handler to prevent Node.js process crashes
  onError: function(err, req, res) {
    console.error("Proxy Connection Error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: Target server timed out or refused connection.');
    }
  }
}));

// Fallback route to serve index.html for any remaining requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
