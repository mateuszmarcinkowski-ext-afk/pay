// Synthetic market data for a paywall demo. Everything here is invented.
//
// The whole dataset is built once at module load from a fixed seed, so the
// numbers a demo shows on stage are the same ones seen in rehearsal.

const SOURCE = 'synthetic sample data — not real market data';

// Frozen "now". A real clock would make the documents change between runs.
const AS_OF = '2026-09-19T21:00:00Z';
const LAST_CANDLE_DATE = '2026-09-19';
const CANDLE_COUNT = 30;

// Every asset needs a candle series to derive its spot price from, but only
// these three publish one.
const OHLCV_SYMBOLS = ['btc', 'eth', 'sol'];

// change24h is a target for the final day's move. The demo asks an agent to
// pick "whichever rose most in 24h", so SOL leads by a wide, unambiguous margin.
const ASSETS = {
  btc: { symbol: 'BTC', name: 'Bitcoin',  seed: 1001, startPrice: 64200, dailyVol: 0.018, decimals: 2, change24h:  1.24, baseVolume: 28_000_000_000 },
  eth: { symbol: 'ETH', name: 'Ethereum', seed: 1002, startPrice:  3180, dailyVol: 0.022, decimals: 2, change24h:  2.07, baseVolume: 14_000_000_000 },
  sol: { symbol: 'SOL', name: 'Solana',   seed: 1003, startPrice:   152, dailyVol: 0.030, decimals: 2, change24h:  8.63, baseVolume:  5_200_000_000 },
  xrp: { symbol: 'XRP', name: 'XRP',      seed: 1004, startPrice:  0.57, dailyVol: 0.020, decimals: 4, change24h: -0.86, baseVolume:  1_900_000_000 },
  ada: { symbol: 'ADA', name: 'Cardano',  seed: 1005, startPrice:  0.41, dailyVol: 0.021, decimals: 4, change24h:  0.42, baseVolume:    620_000_000 },
};

// mulberry32: small, self-contained, and reproducible across Node versions
// (Math.random cannot be seeded).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, decimals) {
  return Number(value.toFixed(decimals));
}

function dateNDaysBefore(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildCandles(asset) {
  const rand = mulberry32(asset.seed);
  const { decimals } = asset;

  // Closes first: a random walk, with the last day pinned to the target move
  // so the quoted 24h change is a property of the series, not a separate number.
  const closes = [round(asset.startPrice, decimals)];
  for (let i = 1; i < CANDLE_COUNT - 1; i++) {
    const step = (rand() * 2 - 1) * asset.dailyVol;
    closes.push(round(closes[i - 1] * (1 + step), decimals));
  }
  closes.push(round(closes[CANDLE_COUNT - 2] * (1 + asset.change24h / 100), decimals));

  const candles = closes.map((close, i) => {
    const prevClose = i === 0 ? close : closes[i - 1];
    const open = round(prevClose * (1 + (rand() - 0.5) * 0.004), decimals);

    let high = round(Math.max(open, close) * (1 + rand() * 0.008), decimals);
    let low = round(Math.min(open, close) * (1 - rand() * 0.008), decimals);
    // Rounding can collapse the wick into the body; the invariant wins.
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);

    return {
      date: dateNDaysBefore(LAST_CANDLE_DATE, CANDLE_COUNT - 1 - i),
      open,
      high,
      low,
      close,
      volume: Math.round(asset.baseVolume * (0.7 + rand() * 0.6)),
    };
  });

  return candles;
}

function buildSpot(asset, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return {
    symbol: asset.symbol,
    name: asset.name,
    price_usd: last.close,
    // Derived from the published closes so the two documents cannot disagree.
    change_24h_pct: round(((last.close - prev.close) / prev.close) * 100, 2),
    volume_24h_usd: last.volume,
    as_of: AS_OF,
    source: SOURCE,
  };
}

function seriesStats(candles) {
  const recent = candles.slice(-10);
  return {
    high30: Math.max(...candles.map((c) => c.high)),
    low30: Math.min(...candles.map((c) => c.low)),
    support: Math.min(...recent.map((c) => c.low)),
    resistance: Math.max(...recent.map((c) => c.high)),
    change30: round(((candles[candles.length - 1].close - candles[0].close) / candles[0].close) * 100, 2),
  };
}

const NOTES = {
  btc: (spot, s, fmt, all) => ({
    title: 'Bitcoin: grinding higher into a well-defined range',
    body: `## Summary

BTC marks at **$${fmt(spot.price_usd)}**, up ${spot.change_24h_pct}% over the last 24 hours on $${fmt(spot.volume_24h_usd)} of reported turnover. Across the 30 daily candles in this dataset the pair has moved ${s.change30}%, trading between $${fmt(s.low30)} and $${fmt(s.high30)}.

## Trend

The series is a slow grind rather than a breakout. Daily ranges stay narrow relative to the 30-day span, and the last week's closes cluster in the upper half of that span. On this data the trend is constructive but unhurried: buyers keep absorbing supply, sellers keep capping rallies, and neither side has forced a resolution.

## Levels

Support sits at **$${fmt(s.support)}**, the lowest low of the last ten sessions and the level that has repeatedly stopped intraday weakness. Resistance sits at **$${fmt(s.resistance)}**, the highest high over the same window. A daily close outside either level is the signal worth waiting for; inside them, the range is the market.

## Risks

**Liquidity air-pocket risk.** Turnover in this series is concentrated in a handful of sessions. If volume thins out around the $${fmt(s.support)} support, a modest sell order can travel much further than the recent candles suggest.

**Correlation-break risk.** BTC's ${spot.change_24h_pct}% day is dwarfed by SOL's ${all.sol.change_24h_pct}% move in the same session. Positions sized on the assumption that majors and large caps move together will be mismarked if that dispersion persists.

This note describes invented data and is not investment advice.`,
  }),
  eth: (spot, s, fmt, all) => ({
    title: 'Ethereum: relative weakness against a stronger large-cap bid',
    body: `## Summary

ETH marks at **$${fmt(spot.price_usd)}**, up ${spot.change_24h_pct}% over the last 24 hours on $${fmt(spot.volume_24h_usd)} of reported turnover. Over the 30 daily candles in this dataset the pair has moved ${s.change30}%, with a low of $${fmt(s.low30)} and a high of $${fmt(s.high30)}.

## Trend

ETH is participating in the broad bid but leading nothing. The ${spot.change_24h_pct}% daily gain is roughly what the majors put in, and well short of SOL's ${all.sol.change_24h_pct}% over the same session. The shape of the series is choppy: several sharp up-days are followed almost immediately by give-back, which is what a market without a dominant flow looks like.

## Levels

The ten-session floor is **$${fmt(s.support)}**, and that is the first level a pullback has to defend. Overhead, **$${fmt(s.resistance)}** has capped every attempt in the same window. The distance between them is wide enough that range trades are viable and breakout trades are expensive.

## Risks

**Rotation risk.** Capital in this dataset is visibly rotating toward the highest-beta large cap. If that continues, ETH can keep rising in absolute terms while losing ground on every relative measure that matters to a book.

**Gas-regime risk.** The turnover here assumes fee conditions stay where they are. A sustained shift in on-chain activity would change the demand picture underneath the price without showing up in these candles until much later.

This note describes invented data and is not investment advice.`,
  }),
};

function formatNumber(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function buildDataset() {
  const spot = {};
  const ohlcv = {};
  const research = {};
  const series = {};

  for (const [key, asset] of Object.entries(ASSETS)) {
    const candles = buildCandles(asset);
    series[key] = candles;
    spot[key] = buildSpot(asset, candles);
    if (OHLCV_SYMBOLS.includes(key)) {
      ohlcv[key] = {
        symbol: asset.symbol,
        interval: '1d',
        candles,
        source: SOURCE,
      };
    }
  }

  for (const key of Object.keys(NOTES)) {
    const candles = series[key];
    const note = NOTES[key](spot[key], seriesStats(candles), formatNumber, spot);
    research[key] = {
      symbol: ASSETS[key].symbol,
      title: note.title,
      published: AS_OF,
      body: note.body,
      source: SOURCE,
    };
  }

  return { spot, ohlcv, research };
}

module.exports = { SOURCE, dataset: buildDataset() };
