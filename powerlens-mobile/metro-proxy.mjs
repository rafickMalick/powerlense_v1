// Proxy that sits on port 8081 (where the dev client connects) and forwards
// to the real Metro bundler on port 8082.
// Streams responses using HTTP/1.0 semantics (no chunked encoding) to avoid
// the ProtocolException that corrupts chunked responses over the Android
// emulator's 10.0.2.2 gateway.
import http from 'node:http';

const METRO_PORT = 8082;
const PROXY_PORT = 8081;

function forwardRequest(req, res) {
  const tryRequest = (hostname) => {
    const options = {
      hostname,
      port: METRO_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${METRO_PORT}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers['transfer-encoding'];
      headers['connection'] = 'close';

      // Prevent Node.js from auto-adding Transfer-Encoding: chunked
      // when piping data through res.write() calls.
      res.useChunkedEncodingByDefault = false;
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (hostname === '::1') {
        tryRequest('127.0.0.1');
      } else {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end('Proxy error: ' + err.message);
      }
    });

    req.pipe(proxyReq);
  };

  tryRequest('::1');
}

const server = http.createServer(forwardRequest);

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Metro proxy :${PROXY_PORT} → Metro :${METRO_PORT} (strips chunked encoding)`);
  console.log(`Start Metro with: npx expo start --port ${METRO_PORT}`);
});
