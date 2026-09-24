const express = require('express');
const http = require('http');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Google Search Autocomplete API
app.get('/api/suggestions', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    res.json(data[1] || []); // Return list of suggested strings
  } catch (err) {
    res.json([]);
  }
});

// Google Search Redirect Handler (&igu=1 enables iframe embedding)
app.get('/search', (req, res) => {
  const query = req.query.q || '';
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&igu=1`;
  res.redirect('/proxy?url=' + encodeURIComponent(searchUrl));
});

// Main Proxy Handler
const proxy = createProxyMiddleware({
  target: 'https://www.google.com',
  changeOrigin: true,
  ws: true,
  followRedirects: true,
  router: (req) => {
    const targetUrl = req.query.url;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
        return parsed.origin;
      } catch (e) {}
    }
    return 'https://www.google.com';
  },
  pathRewrite: (pathStr, req) => {
    const targetUrl = req.query.url;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
        return parsed.pathname + parsed.search;
      } catch (e) {}
    }
    return pathStr;
  },
  on: {
    proxyReq: (proxyReq, req) => {
      const targetUrl = req.query.url;
      if (targetUrl) {
        try {
          const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
          // Inject exact domain headers so .io game servers accept the connection
          proxyReq.setHeader('Host', parsed.host);
          proxyReq.setHeader('Origin', parsed.origin);
          proxyReq.setHeader('Referer', parsed.origin + '/');
        } catch (e) {}
      }
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('x-forwarded-proto');
      proxyReq.removeHeader('x-forwarded-host');
    },
    proxyRes: (proxyRes) => {
      // Strip frame restrictions and allow cross-origin assets
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['cross-origin-resource-policy'];
      delete proxyRes.headers['cross-origin-embedder-policy'];
      delete proxyRes.headers['frame-options'];

      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-methods'] = '*';
      proxyRes.headers['access-control-allow-headers'] = '*';
    },
    error: (err, req, res) => {
      console.error('Proxy Exception:', err.message);
      if (res && !res.headersSent) {
        res.status(502).send('Proxy Connection Error: ' + err.message);
      }
    }
  }
});

app.use('/proxy', proxy);

const server = http.createServer(app);

// Enable WebSocket proxying for multiplayer games
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/proxy')) {
    proxy.upgrade(req, socket, head);
  }
});

server.listen(PORT, () => console.log(`Browser Hub running on port ${PORT}`));
