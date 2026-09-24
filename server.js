const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const https = require('https');

const app = express();

// ==========================================
// 🔒 ACCESS CONTROL SETTINGS
// Set your secret username and password here
// ==========================================
const ACCESS_USER = "admin";
const ACCESS_PASS = "SecretPassword123"; // CHANGE THIS PASSWORD!

// Authentication Middleware (Locks down EVERYTHING: HTML, Proxy, and API)
app.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1] || '';
  const [user, pass] = Buffer.from(token, 'base64').toString().split(':');

  if (user === ACCESS_USER && pass === ACCESS_PASS) {
    return next(); // Correct password, allow access
  }

  // Failed or missing password: prompt native browser login box
  res.set('WWW-Authenticate', 'Basic realm="Restricted Proxy Access"');
  res.status(401).send('401 Unauthorized: You need the password to access this proxy.');
});
// ==========================================

// Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Search Suggestions API endpoint
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
  router: function(req) {
    if (!req.query.url) return 'https://www.google.com';
    try {
      let decodedUrl = Buffer.from(req.query.url, 'base64').toString('utf-8');
      if (!/^https?:\/\//i.test(decodedUrl)) {
        decodedUrl = 'https://' + decodedUrl;
      }
      return decodedUrl;
    } catch (err) {
      console.error("URL decoding failed:", err.message);
      return 'https://www.google.com';
    }
  },
  changeOrigin: true,
  ws: true,

  onProxyRes: function(proxyRes, req, res) {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['frame-options'];
  },

  onError: function(err, req, res) {
    console.error("Proxy Connection Error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: Target server timed out or refused connection.');
    }
  }
}));

// Fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Password-protected server running on port ${PORT}`);
});
