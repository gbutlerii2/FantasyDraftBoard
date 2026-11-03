// FantasyPros CORS proxy.
// The browser cannot read api.fantasypros.com directly — it returns no
// Access-Control-Allow-Origin header. This function forwards the request
// server-side and adds the header, so the draft board can read the response.
//
// The API key is NOT stored here. The app sends it as x-api-key on each
// request and this function passes it straight through. If you would rather
// not paste it every time, set FANTASYPROS_KEY as a Netlify environment
// variable and the function will fall back to it.
//
// Call it as:  /.netlify/functions/fp?path=nfl/2026/consensus-rankings&position=ALL&scoring=PPR

const ALLOWED = [
  'consensus-rankings',
  'projections',
  'players',
  'news',
  'player-points',
  'injuries',
  'stats',
  'adp',
  'notes',
  'player-notes',
  'season-outlook',
  'outlook'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, x-fantasy-filter, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store'
};

// ESPN's fantasy read host. Its player endpoint carries real season stat lines
// (actual and projected, tagged by season) plus the editorial season outlook
// text, and needs no key — but it sends no CORS header either, so it is
// proxied here alongside FantasyPros. Called as ?src=espn&path=<espn path>.
const ESPN_HOST = 'https://lm-api-reads.fantasy.espn.com/';
const ESPN_OK = /^apis\/v3\/games\/ffl\/seasons\/[0-9]{4}(\/[a-z0-9/_-]+)?$/i;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const headers = Object.assign({}, CORS, { 'Content-Type': 'application/json' });
  const fail = (code, msg, extra) =>
    ({ statusCode: code, headers, body: JSON.stringify(Object.assign({ error: msg }, extra || {})) });

  const q = Object.assign({}, event.queryStringParameters || {});
  const lower = {};
  Object.keys(event.headers || {}).forEach(k => { lower[k.toLowerCase()] = event.headers[k]; });

  const path = String(q.path || '').replace(/^\/+/, '').replace(/\?.*$/, '');
  if (!path) return fail(400, 'Missing ?path= parameter.');
  if (!/^[a-z0-9/_-]+$/i.test(path)) return fail(400, 'Bad path.');

  if (String(q.src || '').toLowerCase() === 'espn') {
    if (!ESPN_OK.test(path)) return fail(400, 'Bad ESPN path: ' + path);
    delete q.path;
    delete q.src;
    const eqs = new URLSearchParams(q).toString();
    const eurl = ESPN_HOST + path + (eqs ? '?' + eqs : '');
    const ehead = { Accept: 'application/json' };
    if (lower['x-fantasy-filter']) ehead['x-fantasy-filter'] = lower['x-fantasy-filter'];
    try {
      const r = await fetch(eurl, { headers: ehead });
      const body = await r.text();
      return { statusCode: r.status, headers, body: body || '{}' };
    } catch (e) {
      return fail(502, 'ESPN request failed: ' + (e && e.message ? e.message : String(e)), { url: eurl });
    }
  }

  const key = lower['x-api-key'] || q.key || process.env.FANTASYPROS_KEY || '';
  if (!key) return fail(400, 'No API key. Send it as an x-api-key header or set FANTASYPROS_KEY.');

  const endpoint = path.split('/').pop();
  if (ALLOWED.indexOf(endpoint) < 0) {
    return fail(400, 'Endpoint not allowed: ' + endpoint, { allowed: ALLOWED });
  }

  delete q.path;
  delete q.key;
  const qs = new URLSearchParams(q).toString();
  const url = 'https://api.fantasypros.com/public/v2/json/' + path + (qs ? '?' + qs : '');

  try {
    const r = await fetch(url, { headers: { 'x-api-key': key, Accept: 'application/json' } });
    const body = await r.text();
    return { statusCode: r.status, headers, body: body || '{}' };
  } catch (e) {
    return fail(502, 'Upstream request failed: ' + (e && e.message ? e.message : String(e)), { url });
  }
};
