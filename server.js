const express = require('express');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Redirect standard search queries
app.get('/search', (req, res) => {
  const googleSearchUrl = 'https://www.google.com' + req.originalUrl;
  res.redirect('/proxy?url=' + encodeURIComponent(googleSearchUrl));
});

// Main Proxy Handler
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
    selfHandleResponse: true,
    pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // Strip iframe blocking headers
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        res.setHeader('access-control-allow-origin', '*');

        const contentType = proxyRes.headers['content-type'] || '';
        // Inject base tag for HTML pages so relative image/script paths load properly
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf8');
          const baseTag = `<base href="${parsedUrl.origin}/">`;
          html = html.replace(/<head[^>]*>/i, `$&${baseTag}`);
          return html;
        }
        return responseBuffer;
      })
    }
  });

  return proxy(req, res, next);
});

app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
