const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files from "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// CATCH GOOGLE SEARCHES: Redirects /search?q=... through the proxy URL handler
app.get('/search', (req, res) => {
  const googleSearchUrl = 'https://www.google.com' + req.originalUrl;
  res.redirect('/proxy?url=' + encodeURIComponent(googleSearchUrl));
});

// Proxy endpoint
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
    pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
    on: {
      proxyRes: (proxyRes) => {
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        proxyRes.headers['access-control-allow-origin'] = '*';
      }
    }
  });

  return proxy(req, res, next);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
