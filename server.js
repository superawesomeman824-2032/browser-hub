const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Catch Google search route
app.get('/search', (req, res) => {
  const googleSearchUrl = 'https://www.google.com' + req.originalUrl;
  res.redirect('/proxy?url=' + encodeURIComponent(googleSearchUrl));
});

// Main Proxy Route
app.all('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing target URL');

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
  } catch (err) {
    return res.status(400).send('Invalid URL');
  }

  const proxy = createProxyMiddleware({
    target: parsedUrl.origin,
    changeOrigin: true,
    followRedirects: true,
    // Add real browser headers so Google doesn't drop/block the connection
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
    on: {
      proxyReq: (proxyReq) => {
        // Remove proxy-identifying headers that trigger security blocks
        proxyReq.removeHeader('x-forwarded-for');
        proxyReq.removeHeader('x-forwarded-proto');
        proxyReq.removeHeader('x-forwarded-host');
      },
      proxyRes: (proxyRes) => {
        // Delete all frame-blocking headers from target response
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        delete proxyRes.headers['cross-origin-resource-policy'];
        delete proxyRes.headers['cross-origin-embedder-policy'];
        delete proxyRes.headers['frame-options'];

        // Allow iframe rendering
        proxyRes.headers['access-control-allow-origin'] = '*';
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy connection error:', err.message);
      if (!res.headersSent) {
        res.status(502).send('Proxy Connection Failed: ' + err.message);
      }
    }
  });

  return proxy(req, res, next);
});

app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
