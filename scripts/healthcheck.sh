#!/bin/sh
# healthcheck.sh — called by Docker healthcheck for the app service.
# Uses node's built-in http module (no curl needed).
node -e "
const http = require('http');
const req = http.get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.setTimeout(5000, () => { req.destroy(); process.exit(1); });
"
