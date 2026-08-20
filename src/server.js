import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditSite } from './auditor.js';
import { discoverCitationSources, getGroqStatus } from './groq.js';

const port = Number(process.env.PORT || 3000);
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const clientWindows = new Map();

export function createAppServer() {
  return createServer(async (req, res) => {
    securityHeaders(res);
    try {
      const requestUrl = new URL(req.url, `http://localhost:${port}`);
      if (requestUrl.pathname.startsWith('/api/')) return handleApi(req, res, requestUrl);
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Method not allowed' }, 405);
      return serveStatic(req, res, requestUrl.pathname);
    } catch (error) {
      const status = error.statusCode || classifyError(error);
      return json(res, { error: publicErrorMessage(error, status) }, status, error.retryAfter);
    }
  });
}

async function handleApi(req, res, requestUrl) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);

  if (requestUrl.pathname === '/api/status') {
    return json(res, {
      crawl: true,
      groq: getGroqStatus(),
      sourceExplorer: true,
      strictFreeMode: true
    });
  }

  if (requestUrl.pathname === '/api/audit') {
    consumeClientQuota(req, 'audit', 15, 3600000);
    const target = requestUrl.searchParams.get('url');
    if (!target) return json(res, { error: 'Missing url' }, 400);
    if (target.length > 2048) return json(res, { error: 'URL is too long' }, 400);
    return json(res, await auditSite(target));
  }

  if (requestUrl.pathname === '/api/sources') {
    consumeClientQuota(req, 'sources', 10, 3600000);
    const query = requestUrl.searchParams.get('q');
    if (!query) return json(res, { error: 'Missing q' }, 400);
    if (query.trim().length < 3) return json(res, { error: 'Enter a more specific query' }, 400);
    if (query.length > 180) return json(res, { error: 'Query must be 180 characters or fewer' }, 400);
    return json(res, await discoverCitationSources(query));
  }

  return json(res, { error: 'Not found' }, 404);
}

async function serveStatic(req, res, pathname) {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  if (decoded.includes('\0')) return json(res, { error: 'Not found' }, 404);
  const filePath = resolve(publicRoot, `.${decoded}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    return json(res, { error: 'Not found' }, 404);
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    return json(res, { error: 'Not found' }, 404);
  }
}

function consumeClientQuota(req, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${clientIp(req)}:${bucket}`;
  let state = clientWindows.get(key);
  if (!state || now >= state.resetAt) state = { count: 0, resetAt: now + windowMs };
  state.count += 1;
  clientWindows.set(key, state);

  if (clientWindows.size > 5000) {
    for (const [candidate, value] of clientWindows) if (now >= value.resetAt) clientWindows.delete(candidate);
  }
  if (state.count > limit) {
    const error = new Error(`Too many ${bucket} requests. Try again later.`);
    error.statusCode = 429;
    error.retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
    throw error;
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 100);
}

function classifyError(error) {
  const message = String(error?.message || '');
  if (/URL|hostname|private|local|resolve|http:\/\/|https:\/\//i.test(message)) return 400;
  return 500;
}

function publicErrorMessage(error, status) {
  if (status < 500) return error.message || 'Invalid request';
  console.error(error);
  return 'The request could not be completed. Please try again.';
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

function json(res, data, status = 200, retryAfter) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  };
  if (retryAfter) headers['retry-after'] = String(retryAfter);
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  if (!process.env.GROQ_API_KEY) {
    console.log('GROQ_API_KEY is not set. Technical audits remain available; grounded visibility and source discovery will show as not measured.');
  }
  createAppServer().listen(port, () => console.log(`GEO Auditor running at http://localhost:${port}`));
}
