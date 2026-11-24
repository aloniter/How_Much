// Vercel entry point: every /api/* request (and /healthz) is rewritten here; see vercel.json.
module.exports = require('../server.js').handler;
