const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Pin the only provider model used by the free MVP. This deliberately cannot
// be changed through an environment variable, preventing an accidental switch
// to a metered model while the product is in its zero-cost validation phase.
const MODEL = 'groq/compound-mini';
const BASIC_SEARCH_VERSION = '2025-07-23';
const MAX_FREE_DAILY_CALLS = 200;
const CACHE_LIMIT = 500;

const cache = new Map();
const inFlight = new Map();
let usage = { date: utcDate(), calls: 0 };

export async function probeAiVisibility({ businessName, baseUrl, category }) {
  if (!process.env.GROQ_API_KEY) return skipped('GROQ_API_KEY is not configured. The technical audit still ran in full.', { code: 'not_configured' });

  const domain = safeHostname(baseUrl);
  const neutralCategory = cleanCategory(category, businessName, domain);
  const search = await cachedGroqRequest(`category:${neutralCategory.toLowerCase()}`, () => runCategorySearch(neutralCategory));
  if (search.skipped) return search;

  const analysis = analyzeVisibilitySources(search.sources, {
    businessName,
    domain,
    queries: search.queries
  });

  return {
    skipped: false,
    provider: 'Groq',
    model: MODEL,
    label: 'Groq grounded visibility snapshot',
    measuredAt: search.measuredAt,
    cached: search.cached,
    cacheAgeSeconds: search.cacheAgeSeconds,
    category: neutralCategory,
    answer: search.answer,
    queries: search.queries,
    sources: search.sources,
    ...analysis,
    note: analysis.score === null
      ? analysis.reason
      : 'This score reflects one current Groq web-grounded category search. It is not a ChatGPT, Gemini, Perplexity, or Google AI Overview score.'
  };
}

export async function discoverCitationSources(query) {
  if (!process.env.GROQ_API_KEY) return skipped('GROQ_API_KEY is not configured. Add it on Railway to enable live source discovery.', { code: 'not_configured' });
  const cleaned = cleanQuery(query);
  return cachedGroqRequest(`sources:${cleaned.toLowerCase()}`, async () => {
    const prompt = [
      `Use live web search to answer this buying or research question: "${cleaned}"`,
      'Give a concise, neutral answer and cite the sources that materially support it.',
      'Prefer useful independent editorial, industry, comparison, community, video, or research sources over thin pages.'
    ].join('\n');
    const fallbackPrompt = `Search the web for "${cleaned}". Return a short neutral answer supported by up to five cited sources.`;
    return callGroq(prompt, {
      excludeDomains: excludedDomains(),
      fallbackPrompt,
      preferBasicSearch: cleaned.split(/\s+/).length <= 4
    });
  });
}

export function getGroqStatus() {
  resetUsageIfNeeded();
  const dailyLimit = configuredDailyLimit();
  return {
    enabled: Boolean(process.env.GROQ_API_KEY),
    provider: 'Groq',
    model: MODEL,
    freeMode: true,
    dailyLimit,
    callsToday: usage.calls,
    remainingToday: Math.max(0, dailyLimit - usage.calls),
    cacheTtlHours: cacheTtlMs() / 3600000
  };
}

async function runCategorySearch(category) {
  const prompt = [
    `Use live web search to answer this neutral buying-intent question: "What are the best options for ${category}?"`,
    'Search the category as written. Do not turn this into a direct brand-name lookup or favor a company because of prior conversation context.',
    'Name 3-5 credible options only when supported by retrieved sources, explain the main selection criteria, and cite the sources used.',
    'Keep the answer under 450 words.'
  ].join('\n');
  const fallbackPrompt = `Search the web for the best options for "${category}". Return a short neutral answer supported by up to five cited sources.`;
  return callGroq(prompt, { excludeDomains: excludedDomains(), fallbackPrompt });
}

async function callGroq(prompt, { excludeDomains = [], fallbackPrompt = prompt, preferBasicSearch = false } = {}) {
  const attempts = preferBasicSearch
    ? [{ prompt: fallbackPrompt, basicSearch: true }]
    : [
        { prompt, basicSearch: false },
        { prompt: fallbackPrompt, basicSearch: true }
      ];

  try {
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const response = await postGroq(attempt.prompt, {
        excludeDomains,
        basicSearch: attempt.basicSearch
      });

      if (response.status === 413 && index < attempts.length - 1) {
        await response.text().catch(() => '');
        continue;
      }
      if (!response.ok) throw await groqErrorForResponse(response);

      const data = await response.json();
      const message = data.choices?.[0]?.message || {};
      return {
        skipped: false,
        provider: 'Groq',
        model: data.model || MODEL,
        measuredAt: new Date().toISOString(),
        answer: String(message.content || '').trim(),
        queries: extractSearchQueries(message),
        sources: extractSearchSources(message).slice(0, 12),
        searchMode: attempt.basicSearch ? 'basic' : 'advanced',
        fallbackUsed: index > 0,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : null
      };
    }
  } catch (error) {
    if (error instanceof GroqError) return skipped(error.message, { code: error.code });
    if (error.name === 'AbortError') return skipped('Groq timed out. The technical audit still ran in full.', { code: 'timeout' });
    return skipped(`Groq request failed: ${error.message}`, { code: 'provider_error' });
  }

  return skipped('Groq could not complete this search. Try a more specific query.', { code: 'provider_error' });
}

async function postGroq(prompt, { excludeDomains, basicSearch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    consumeQuota();
    return await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        ...(basicSearch ? { 'Groq-Model-Version': BASIC_SEARCH_VERSION } : {})
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: basicSearch ? 700 : 1000,
        compound_custom: { tools: { enabled_tools: ['web_search'] } },
        ...(excludeDomains.length ? { search_settings: { exclude_domains: excludeDomains } } : {})
      })
    });
  } finally {
    clearTimeout(timer);
  }
}

async function groqErrorForResponse(response) {
  const body = await response.text().catch(() => '');
  const providerMessage = parseJson(body)?.error?.message;
  if (response.status === 401 || response.status === 403) {
    return new GroqError('Groq rejected the API key. Check GROQ_API_KEY on Railway.', 'invalid_key');
  }
  if (response.status === 413) {
    return new GroqError('Groq could not process this search even after the smaller-search fallback. Try a more specific query.', 'request_too_large');
  }
  if (response.status === 429) {
    return new GroqError('Groq free-tier quota is currently exhausted. The technical audit remains available.', 'quota_exhausted');
  }
  return new GroqError(
    `Groq request failed (${response.status})${providerMessage ? `: ${String(providerMessage).slice(0, 160)}` : '.'}`,
    'provider_error'
  );
}

async function cachedGroqRequest(key, producer) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.savedAt < cacheTtlMs()) {
    return { ...structuredClone(existing.value), cached: true, cacheAgeSeconds: Math.round((Date.now() - existing.savedAt) / 1000) };
  }
  if (inFlight.has(key)) {
    const shared = await inFlight.get(key);
    return { ...structuredClone(shared), cached: true, cacheAgeSeconds: 0 };
  }

  const promise = producer();
  inFlight.set(key, promise);
  try {
    const value = await promise;
    if (!value.skipped) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, { savedAt: Date.now(), value: structuredClone(value) });
    }
    return { ...value, cached: false, cacheAgeSeconds: 0 };
  } finally {
    inFlight.delete(key);
  }
}

export function extractSearchSources(message = {}) {
  const sources = [];
  for (const tool of message.executed_tools || []) {
    const results = Array.isArray(tool.search_results)
      ? tool.search_results
      : tool.search_results?.results;
    if (Array.isArray(results)) sources.push(...results);
    if (!results?.length && tool.output) sources.push(...parseToolOutput(tool.output));
  }

  const deduped = new Map();
  for (const source of sources) {
    const url = safeExternalUrl(source.url);
    if (!url || deduped.has(url)) continue;
    deduped.set(url, {
      title: String(source.title || safeHostname(url) || 'Untitled source').trim(),
      url,
      domain: safeHostname(url),
      snippet: String(source.content || source.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      relevance: Number.isFinite(Number(source.score)) ? Math.round(Number(source.score) * 1000) / 1000 : null
    });
  }
  return [...deduped.values()].sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1));
}

export function analyzeVisibilitySources(sources, { businessName, domain, queries = [] }) {
  const normalizedName = normalizeText(businessName).replace(/\b(inc|llc|ltd|limited|company|co)\b/g, '').trim();
  const domainCore = String(domain || '').toLowerCase().replace(/^www\./, '');
  const contaminated = queries.some(query => {
    const normalized = normalizeText(query);
    return (normalizedName.length > 3 && normalized.includes(normalizedName)) || (domainCore && normalized.includes(domainCore));
  });

  const ownedSources = [];
  const thirdPartyMentions = [];
  let bestPosition = null;

  sources.forEach((source, index) => {
    const sourceDomain = String(source.domain || safeHostname(source.url)).replace(/^www\./, '').toLowerCase();
    const owned = Boolean(domainCore && (sourceDomain === domainCore || sourceDomain.endsWith(`.${domainCore}`)));
    const haystack = normalizeText(`${source.title || ''} ${source.snippet || ''} ${source.url || ''}`);
    const mentioned = Boolean(
      (normalizedName.length > 3 && haystack.includes(normalizedName)) ||
      (domainCore && haystack.includes(normalizeText(domainCore)))
    );
    if (owned) ownedSources.push(source);
    else if (mentioned) thirdPartyMentions.push(source);
    if ((owned || mentioned) && bestPosition === null) bestPosition = index + 1;
  });

  if (!sources.length) {
    return { score: null, reason: 'Groq returned no inspectable web-search sources, so visibility was not scored.', contaminated: false, metrics: { sourceCount: 0, ownedSourceCount: 0, thirdPartyMentionCount: 0, bestPosition: null }, ownedSources, thirdPartyMentions };
  }
  if (contaminated) {
    return { score: null, reason: 'The provider searched for the brand directly, so this run was excluded rather than presented as unaided visibility.', contaminated: true, metrics: { sourceCount: sources.length, ownedSourceCount: ownedSources.length, thirdPartyMentionCount: thirdPartyMentions.length, bestPosition }, ownedSources, thirdPartyMentions };
  }

  let score = 0;
  if (ownedSources.length) score += 45;
  if (thirdPartyMentions.length) score += 35;
  if (bestPosition !== null && bestPosition <= 5) score += 20;

  return {
    score,
    contaminated: false,
    metrics: {
      sourceCount: sources.length,
      ownedSourceCount: ownedSources.length,
      thirdPartyMentionCount: thirdPartyMentions.length,
      bestPosition
    },
    ownedSources,
    thirdPartyMentions
  };
}

function extractSearchQueries(message) {
  const queries = [];
  for (const tool of message.executed_tools || []) {
    const args = typeof tool.arguments === 'string' ? parseJson(tool.arguments) : tool.arguments;
    if (args?.query) queries.push(String(args.query));
  }
  return [...new Set(queries)];
}

function parseToolOutput(output) {
  const text = String(output || '');
  const matches = [...text.matchAll(/Title:\s*(.*?)\s+URL:\s*(https?:\/\/\S+?)\s+Content:\s*([\s\S]*?)(?=\s+Title:|$)/gi)];
  return matches.map(match => {
    const score = match[3].match(/\s+Score:\s*([\d.]+)\s*$/i)?.[1];
    const content = match[3].replace(/\s+Score:\s*[\d.]+\s*$/i, '').trim();
    return { title: match[1], url: match[2], content, score };
  });
}

function consumeQuota() {
  resetUsageIfNeeded();
  if (usage.calls >= configuredDailyLimit()) {
    throw new GroqError(`The local free-mode safety limit of ${configuredDailyLimit()} Groq calls per day has been reached.`);
  }
  usage.calls += 1;
}

function resetUsageIfNeeded() {
  const today = utcDate();
  if (usage.date !== today) usage = { date: today, calls: 0 };
}

function configuredDailyLimit() {
  const requested = Number.parseInt(process.env.GROQ_DAILY_LIMIT || '200', 10);
  return Math.min(MAX_FREE_DAILY_CALLS, Math.max(1, Number.isFinite(requested) ? requested : 200));
}

function cacheTtlMs() {
  const hours = Number.parseInt(process.env.GROQ_CACHE_TTL_HOURS || '168', 10);
  return Math.min(720, Math.max(1, Number.isFinite(hours) ? hours : 168)) * 3600000;
}

function excludedDomains() {
  return String(process.env.GROQ_EXCLUDE_DOMAINS || 'reddit.com')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function cleanCategory(category, businessName, domain) {
  let value = String(category || '').replace(/\s+/g, ' ').trim();
  for (const removable of [businessName, domain, String(domain || '').split('.')[0]]) {
    if (!removable) continue;
    value = value.replace(new RegExp(escapeRegExp(removable), 'ig'), ' ');
  }
  value = value.replace(/[|–—]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,.:;-]+|[,.:;-]+$/g, '');
  return value.length >= 8 ? value.slice(0, 140) : 'businesses and software in this category';
}

function cleanQuery(query) {
  const value = String(query || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (value.length < 3) throw new Error('Enter a more specific source-search query.');
  return value.slice(0, 180);
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/https?:\/\//g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function safeHostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function skipped(reason, { code = 'provider_unavailable' } = {}) {
  return { skipped: true, reason, code, provider: 'Groq', model: MODEL, score: null, sources: [] };
}

function utcDate() { return new Date().toISOString().slice(0, 10); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

class GroqError extends Error {
  constructor(message, code = 'provider_error') {
    super(message);
    this.code = code;
  }
}
