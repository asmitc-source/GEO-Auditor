const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

// A realistic browser UA. Many sites 403/robot-block generic fetch UAs, which
// previously caused the auditor to silently misreport "missing" for content
// that was actually there — the crawler just never saw it. Retrying with a
// browser-like UA fixes most false negatives.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'GEO-Auditor/2.0 (+https://github.com/geo-auditor; audits AI-search visibility)'
];

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENTS[attempt] || USER_AGENTS[USER_AGENTS.length - 1],
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          'accept-language': 'en-US,en;q=0.9'
        }
      });
      const text = await response.text();
      clearTimeout(timer);
      return { ok: response.ok, status: response.status, text, attempt: attempt + 1 };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      // brief backoff before retrying with the next UA
      if (attempt < MAX_RETRIES - 1) await sleep(400);
    }
  }

  return { ok: false, status: null, text: '', error: describeError(lastError), attempt: MAX_RETRIES };
}

export async function fetchPage(url, options) {
  const result = await fetchText(url, options);
  return {
    url,
    ok: result.ok,
    status: result.status,
    html: result.text || '',
    error: result.ok ? null : (result.error || `HTTP ${result.status}`),
    attempts: result.attempt
  };
}

function describeError(error) {
  if (!error) return 'unknown fetch error';
  if (error.name === 'AbortError') return 'timed out';
  return error.message || String(error);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
