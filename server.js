const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend files from "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Dynamic Proxy Route - strips security headers so sites render inside browser tabs
app.use('/proxy', (req, res, next) => {
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
    pathFilter: '/proxy',
    pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
    on: {
      proxyRes: (proxyRes) => {
        // Remove iframe blocking headers
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
