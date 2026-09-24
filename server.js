const express = require('express');
const http = require('http');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Search Suggestions API
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

// Smart Search Route (Uses DuckDuckGo HTML engine to bypass Render/Cloud IP CAPTCHAs)
app.get('/search', (req, res) => {
  const query = req.query.q || '';
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  res.redirect('/proxy?url=' + encodeURIComponent(searchUrl));
});

// Main Proxy Engine
const proxy = createProxyMiddleware({
  target: 'https://duckduckgo.com',
  changeOrigin: true,
  ws: true,
  followRedirects: true,
  selfHandleResponse: true,
  router: (req) => {
    const targetUrl = req.query.url;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
        return parsed.origin;
      } catch (e) {}
    }
    return 'https://duckduckgo.com';
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
      
      proxyReq.setHeader('accept-encoding', 'identity');
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('x-forwarded-proto');
      proxyReq.removeHeader('x-forwarded-host');
    },
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      // Strip framing and security constraints
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['cross-origin-resource-policy'];
      delete proxyRes.headers['cross-origin-embedder-policy'];
      delete proxyRes.headers['frame-options'];

      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', '*');
      res.setHeader('access-control-allow-headers', '*');

      const contentType = proxyRes.headers['content-type'] || '';
      
      if (contentType.includes('text/html')) {
        let html = responseBuffer.toString('utf8');
        
        let origin = 'https://duckduckgo.com';
        if (req.query.url) {
          try {
            origin = new URL(req.query.url.startsWith('http') ? req.query.url : 'https://' + req.query.url).origin;
          } catch(e) {}
        }

        // Script injection: Overrides iframe-busting scripts + rewrites fetch/WebSocket calls for games like defly.io
        const injection = `
          <head>
          <base href="${origin}/">
          <script>
            (function() {
              try {
                Object.defineProperty(window, 'top', { get: function() { return window.self; } });
                Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
              } catch(e) {}

              // Intercept fetch & XMLHttpRequest for game assets
              const originalFetch = window.fetch;
              window.fetch = function(resource, init) {
                if (typeof resource === 'string' && !resource.startsWith('/proxy') && !resource.startsWith('data:')) {
                  try {
                    const resolved = new URL(resource, '${origin}').href;
                    resource = '/proxy?url=' + encodeURIComponent(resolved);
                  } catch(e) {}
                }
                return originalFetch.apply(this, [resource, init]);
              };
            })();
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
        res.status(502).send('Proxy Connection Error: ' + err.message);
      }
    }
  }
});

app.use('/proxy', proxy);

// Upgrade WebSocket connections for real-time io games (e.g. defly.io)
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/proxy')) {
    proxy.upgrade(req, socket, head);
  }
});

server.listen(PORT, () => console.log(`Browser Hub running on port ${PORT}`));
