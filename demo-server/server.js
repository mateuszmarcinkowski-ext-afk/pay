const express = require('express');
const { SOURCE, dataset } = require('./market-data');

// Loopback only. This server has no auth of its own: the payment gateway in
// front of it is the only access control, so it must not be reachable directly.
const HOST = '127.0.0.1';
const PORT = 9000;

const app = express();
app.disable('x-powered-by');

function serve(collection) {
  return (req, res) => {
    const document = dataset[collection][req.params.symbol.toLowerCase()];
    if (!document) return notFound(req, res);
    res.json(document);
  };
}

function notFound(req, res) {
  res.status(404).json({
    error: 'not_found',
    message: `No document at ${req.path}`,
    source: SOURCE,
  });
}

app.get('/v1/spot/:symbol', serve('spot'));
app.get('/v1/ohlcv/:symbol', serve('ohlcv'));
app.get('/v1/research/:symbol', serve('research'));
app.use(notFound);

app.listen(PORT, HOST, () => {
  console.log(`demo-server listening on http://${HOST}:${PORT}`);
});
