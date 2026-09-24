const express = require('express');
const http = require('http');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Smart search route with Google iframe embedding mode (&igu=1)
app.get('/search', (req, res) => {
  const query = req.query.q || '';
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&igu=1`;
  res.redirect('/proxy?url=' + encodeURIComponent(searchUrl));
});

// Proxy middleware configuration
const proxyMiddleware = createProxyMiddleware({
  target: 'https://www.google.com',
  changeOrigin: true,
  ws: true, // Enables WebSocket proxying required for .io games
  followRedirects: true,
  router: (req) => {
    const targetUrl = req.query.url;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
        return parsed.origin;
      } catch (e) {
        // Fallback on invalid URL syntax
      }
    }
    return 'https://www.google.com';
  },
  pathRewrite: (pathStr, req) => {
    const targetUrl = req.query.url;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
        return parsed.pathname + parsed.search;
      } catch (e) {
        // Fallback on invalid URL syntax
      }
    }
    return pathStr;
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  },
  on: {
    proxyReq: (proxyReq) => {
      // Strip proxy headers to prevent security checks from blocking the connection
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('x-forwarded-proto');
      proxyReq.removeHeader('x-forwarded-host');
    },
    proxyRes: (proxyRes) => {
      // Delete frame-blocking headers from target websites
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['cross-origin-resource-policy'];
      delete proxyRes.headers['cross-origin-embedder-policy'];
      delete proxyRes.headers['frame-options'];

      proxyRes.headers['access-control-allow-origin'] = '*';
    }
  },
  onError: (err, req, res) => {
    console.error('Proxy connection error:', err.message);
    if (res && !res.headersSent) {
      res.status(502).send('Connection error: ' + err.message);
    }
  }
});

app.all('/proxy', proxyMiddleware);

// Pass WebSocket upgrade connections to proxy for live multiplayer games
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/proxy')) {
    proxyMiddleware.upgrade(req, socket, head);
  }
});

server.listen(PORT, () => console.log(`Browser Hub running on port ${PORT}`));
