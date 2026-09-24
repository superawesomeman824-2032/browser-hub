const express = require('express');
const http = require('http');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Helper to resolve real target URL from query parameter or Referer header
function resolveTarget(req) {
  if (req.query && req.query.url) {
    let u = req.query.url;
    return u.startsWith('http') ? u : 'https://' + u;
  }
  
  const referer = req.headers.referer || '';
  if (referer.includes('url=')) {
    try {
      const refUrl = new URL(referer);
      const targetFromRef = refUrl.searchParams.get('url');
      if (targetFromRef) {
        const refOrigin = new URL(targetFromRef.startsWith('http') ? targetFromRef : 'https://' + targetFromRef).origin;
        return refOrigin + req.url;
      }
    } catch (e) {}
  }
  return null;
}

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

// Search Route (Uses Google search with igu=1 for guaranteed frame support)
app.get('/search', (req, res) => {
  const query = req.query.q || '';
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&igu=1`;
  res.redirect('/proxy?url=' + encodeURIComponent(searchUrl));
});

// Proxy Middleware Engine
const proxy = createProxyMiddleware({
  target: 'https://www.google.com',
  changeOrigin: true,
  secure: false,
  ws: true,
  followRedirects: true,
  selfHandleResponse: true,
  router: (req) => {
    const target = resolveTarget(req);
    if (target) {
      try {
        return new URL(target).origin;
      } catch (e) {}
    }
    return 'https://www.google.com';
  },
  pathRewrite: (pathStr, req) => {
    const target = resolveTarget(req);
    if (target) {
      try {
        const parsed = new URL(target);
        return parsed.pathname + parsed.search;
      } catch (e) {}
    }
    return pathStr;
  },
  on: {
    proxyReq: (proxyReq, req) => {
      const target = resolveTarget(req);
      if (target) {
        try {
          const parsed = new URL(target);
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
      // Remove blocking frame security headers
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['cross-origin-resource-policy'];
      delete proxyRes.headers['cross-origin-embedder-policy'];
      delete proxyRes.headers['frame-options'];

      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', '*');
      res.setHeader('access-control-allow-headers', '*');

      if (proxyRes.headers.location) {
        try {
          const currentTarget = resolveTarget(req) || 'https://www.google.com';
          const currentOrigin = new URL(currentTarget).origin;
          const redirectTarget = new URL(proxyRes.headers.location, currentOrigin).href;
          res.setHeader('location', '/proxy?url=' + encodeURIComponent(redirectTarget));
        } catch(e) {}
      }

      const contentType = proxyRes.headers['content-type'] || '';
      
      if (contentType.includes('text/html')) {
        try {
          let html = responseBuffer.toString('utf8');
          
          let origin = 'https://www.google.com';
          const target = resolveTarget(req);
          if (target) {
            try {
              origin = new URL(target).origin;
            } catch(e) {}
          }

          const injection = `
            <head>
            <base href="/proxy?url=${encodeURIComponent(origin)}/">
            <script>
              (function() {
                try {
                  Object.defineProperty(window, 'top', { get: function() { return window.self; } });
                  Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
                } catch(e) {}

                const TARGET_ORIGIN = "${origin}";

                const originalFetch = window.fetch;
                window.fetch = function(resource, init) {
                  if (typeof resource === 'string' && !resource.startsWith('/proxy') && !resource.startsWith('data:') && !resource.startsWith('blob:')) {
                    try {
                      const resolved = new URL(resource, TARGET_ORIGIN + '/').href;
                      resource = '/proxy?url=' + encodeURIComponent(resolved);
                    } catch(e) {}
                  }
                  return originalFetch.apply(this, [resource, init]);
                };

                const originalXHR = window.XMLHttpRequest.prototype.open;
                window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                  if (typeof url === 'string' && !url.startsWith('/proxy') && !url.startsWith('data:')) {
                    try {
                      const resolved = new URL(url, TARGET_ORIGIN + '/').href;
                      url = '/proxy?url=' + encodeURIComponent(resolved);
                    } catch(e) {}
                  }
                  return originalXHR.call(this, method, url, ...rest);
                };

                const OriginalWebSocket = window.WebSocket;
                window.WebSocket = function(url, protocols) {
                  if (typeof url === 'string' && !url.includes('/proxy')) {
                    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const proxyWsUrl = wsProtocol + '//' + window.location.host + '/proxy?url=' + encodeURIComponent(url);
                    return new (Function.prototype.bind.call(OriginalWebSocket, null, proxyWsUrl, protocols))();
                  }
                  return new OriginalWebSocket(url, protocols);
                };
                window.WebSocket.prototype = OriginalWebSocket.prototype;
              })();
            </script>
          `;

          if (html.includes('<head>')) {
            html = html.replace('<head>', injection);
          } else {
            html = injection + html;
          }

          return html;
        } catch(err) {
          return responseBuffer;
        }
      }

      return responseBuffer;
    }),
    error: (err, req, res) => {
      console.error('Proxy Connection Error:', err.message);
      if (res && !res.headersSent) {
        res.status(502).send(`
          <div style="font-family:sans-serif;padding:40px;background:#121316;color:#e1e2e6;height:100vh;box-sizing:border-box;">
            <h2 style="color:#f87171;">502 Bad Gateway</h2>
            <p style="color:#8b8e98;">Target server timed out or refused connection.</p>
            <p style="font-family:monospace;background:#1e1f24;padding:12px;border-radius:6px;">${err.message}</p>
            <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;">Retry</button>
          </div>
        `);
      }
    }
  }
});

app.use('/proxy', proxy);

app.use((req, res, next) => {
  const target = resolveTarget(req);
  if (target && !req.path.startsWith('/api')) {
    return proxy(req, res, next);
  }
  next();
});

server.on('upgrade', (req, socket, head) => {
  const target = resolveTarget(req);
  if (target || (req.url && req.url.startsWith('/proxy'))) {
    proxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Explicitly listen on 0.0.0.0 for Render host binding
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
