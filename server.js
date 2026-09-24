const express = require('express');
const http = require('http');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Serve static frontend files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Google Search Autocomplete API
app.get('/api/suggestions', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    res.json(data[1] || []);
  } catch (err) {
    res.json([]);
  }
});

// Smart Google Search Redirect Handler (&igu=1 allows iframe embedding)
app.get('/search', (req, res) => {
  const query = req.query.q || '';
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&igu=1`;
  res.redirect('/proxy?url=' + encodeURIComponent(searchUrl));
});

// Proxy Engine
const proxy = createProxyMiddleware({
  target: 'https://www.google.com',
  changeOrigin: true,
  ws: true,
  followRedirects: false, // Handle redirects manually to keep them inside proxy
  selfHandleResponse: true, // Handle HTML injection safely
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
          proxyReq.setHeader('Host', parsed.host);
          proxyReq.setHeader('Origin', parsed.origin);
          proxyReq.setHeader('Referer', parsed.origin + '/');
        } catch (e) {}
      }
      
      // Request uncompressed response to prevent gzip/brotli buffer corruption
      proxyReq.setHeader('accept-encoding', 'identity');
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('x-forwarded-proto');
      proxyReq.removeHeader('x-forwarded-host');
    },
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      // Strip frame restrictions and CSP headers
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['cross-origin-resource-policy'];
      delete proxyRes.headers['cross-origin-embedder-policy'];
      delete proxyRes.headers['frame-options'];

      res.setHeader('access-control-allow-origin', '*');

      // Intercept and rewrite 301/302 Redirect Location Headers
      if (proxyRes.headers.location) {
        try {
          const currentTarget = req.query.url || 'https://www.google.com';
          const currentOrigin = new URL(currentTarget.startsWith('http') ? currentTarget : 'https://' + currentTarget).origin;
          const redirectTarget = new URL(proxyRes.headers.location, currentOrigin).href;
          res.setHeader('location', '/proxy?url=' + encodeURIComponent(redirectTarget));
        } catch(e) {}
      }

      const contentType = proxyRes.headers['content-type'] || '';
      
      // Inject Anti-Iframe-Busting + Base URL tag into HTML pages
      if (contentType.includes('text/html')) {
        let html = responseBuffer.toString('utf8');
        
        let origin = 'https://www.google.com';
        if (req.query.url) {
          try {
            origin = new URL(req.query.url.startsWith('http') ? req.query.url : 'https://' + req.query.url).origin;
          } catch(e) {}
        }

        const injection = `
          <head>
          <base href="${origin}/">
          <script>
            try {
              Object.defineProperty(window, 'top', { get: function() { return window.self; } });
              Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
            } catch(e) {}
          </script>
        `;

        if (html.includes('<head>')) {
          html = html.replace('<head>', injection);
        } else {
          html = injection + html;
        }

        return html;
      }

      return responseBuffer;
    }),
    error: (err, req, res) => {
      console.error('Proxy Error:', err.message);
      if (res && !res.headersSent) {
        res.status(502).send('Connection Error: ' + err.message);
      }
    }
  }
});

app.use('/proxy', proxy);

// Handle WebSocket upgrades for games
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/proxy')) {
    proxy.upgrade(req, socket, head);
  }
});

server.listen(PORT, () => console.log(`Browser Hub active on port ${PORT}`));
