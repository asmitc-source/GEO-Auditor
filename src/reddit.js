// Reddit discovery — real threads via Reddit's own API.
//
// Two paths, both hitting Reddit's real infrastructure — never scraped HTML:
//
// 1. OAuth (preferred): REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET set →
//    authenticated app-only access via oauth.reddit.com. Higher, stable
//    rate limits. This is what you should be running once you have keys.
//
// 2. Public JSON fallback (no keys needed): reddit.com/search.json is a
//    real, public, unauthenticated endpoint Reddit itself serves — the
//    same JSON its own site fetches. No login bypass, no HTML scraping,
//    nothing hidden. It's just far more aggressively rate-limited and can
//    be tightened or removed by Reddit at any time, so it's meant to get
//    you unblocked today, not to be the long-term path. Every response
//    using this path is labeled `authenticated: false` so the UI can be
//    upfront about it.
//
// If neither path can reach Reddit at all, this is SKIPPED (not faked)
// and says so plainly — same honesty policy as aiProbe.js.

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const PUBLIC_SEARCH_URL = 'https://www.reddit.com/search.json';

let cachedToken = null; // { token, expiresAt }

export async function searchReddit(query, { limit = 15 } = {}) {
  if (!query || !query.trim()) {
    return { skipped: false, results: [], error: 'Missing query' };
  }
  const q = query.trim();
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (clientId && clientSecret) {
    try {
      const token = await getAccessToken(clientId, clientSecret);
      const results = await runSearch(q, limit, { authorization: `Bearer ${token}` }, `${API_BASE}/search`);
      return { skipped: false, query: q, authenticated: true, results };
    } catch (error) {
      return { skipped: false, query: q, authenticated: true, results: [], error: error.message };
    }
  }

  // No keys yet — fall back to the public endpoint so this isn't blocked
  // on credentials. Clearly marked as unauthenticated in the response.
  try {
    const results = await runSearch(q, limit, {}, PUBLIC_SEARCH_URL);
    return {
      skipped: false,
      query: q,
      authenticated: false,
      note: 'Using Reddit\u2019s public search endpoint (no API keys set). Works, but rate-limited harder than the authenticated API — add REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET for reliable use.',
      results
    };
  } catch (error) {
    return {
      skipped: true,
      reason: `Public Reddit endpoint failed and no REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET set: ${error.message}`,
      results: []
    };
  }
}

async function getAccessToken(clientId, clientSecret) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.token;
  }
  const userAgent = process.env.REDDIT_USER_AGENT || 'geo-auditor/1.0 (reddit discovery module)';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': userAgent
      },
      body: 'grant_type=client_credentials'
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Reddit auth failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    if (!data.access_token) throw new Error('Reddit auth response missing access_token');
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000)
    };
    return cachedToken.token;
  } finally {
    clearTimeout(timer);
  }
}

async function runSearch(query, limit, extraHeaders, baseUrl) {
  const userAgent = process.env.REDDIT_USER_AGENT || 'geo-auditor/1.0 (reddit discovery module)';
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(limit, 1), 25)),
    sort: 'relevance',
    type: 'link'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}?${params}`, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        ...extraHeaders
      }
    });
    if (!response.ok) {
      throw new Error(cleanFetchError(response.status));
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      // Reddit returned its bot-check / interstitial HTML page instead of
      // JSON. This is the known fragility of the unauthenticated public
      // endpoint — it can reject script traffic even on a URL that works
      // fine in a real browser. Report this plainly rather than showing
      // the raw HTML.
      throw new Error(
        `Reddit returned a non-JSON response (likely its bot-check page), even though this endpoint works in a browser. ` +
        `This is a known limitation of the unauthenticated public endpoint, not a bug in this tool — the fix is switching ` +
        `to the authenticated API (set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET).`
      );
    }
    const data = await response.json();
    const children = data?.data?.children || [];
    return children
      .map((c) => c.data)
      .filter(Boolean)
      .map(shapeThread)
      .sort((a, b) => citationPotential(b) - citationPotential(a));
  } finally {
    clearTimeout(timer);
  }
}

function cleanFetchError(status) {
  if (status === 403 || status === 429) {
    return `Reddit blocked this request (${status}) — its bot-detection layer rejected script traffic on the public endpoint. ` +
      `This happens even though the same URL works fine typed directly into a browser. The reliable fix is the authenticated ` +
      `API (set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET) rather than retrying the public endpoint.`;
  }
  return `Reddit search failed (${status}).`;
}

function shapeThread(t) {
  return {
    id: t.id,
    title: t.title,
    subreddit: t.subreddit_name_prefixed || `r/${t.subreddit}`,
    permalink: `https://www.reddit.com${t.permalink}`,
    score: t.score ?? 0,
    numComments: t.num_comments ?? 0,
    createdUtc: t.created_utc ? new Date(t.created_utc * 1000).toISOString() : null,
    author: t.author,
    snippet: (t.selftext || '').slice(0, 240),
    isSelfPost: Boolean(t.is_self),
    citationPotential: citationPotential(t)
  };
}

// A plain, disclosed heuristic — not a claim about what any AI engine
// actually did. Rewards threads that are recent, have real discussion
// (comment count, not just upvotes — comment depth is what actually
// gets quoted), and sit in an active subreddit. This is a sort signal
// shown to the user, not a fact presented as ground truth.
function citationPotential(t) {
  const ageDays = t.created_utc ? (Date.now() / 1000 - t.created_utc) / 86400 : 9999;
  const recency = Math.max(0, 1 - ageDays / 365); // decays over a year
  const engagement = Math.log10((t.num_comments ?? 0) + 1) * 2 + Math.log10((t.score ?? 0) + 1);
  return Math.round((engagement * 10 + recency * 20) * 10) / 10;
}
