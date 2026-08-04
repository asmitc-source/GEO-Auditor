import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { auditSite } from './auditor.js';

const port = process.env.PORT || 3000;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

if (!process.env.OPENAI_API_KEY) {
  console.log('Note: OPENAI_API_KEY is not set. The AI citation probe check will be skipped (not faked) until you add it to .env.');
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/audit') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, { error: 'Missing url' }, 400);
      const report = await auditSite(target);
      return json(res, report);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(join('public', file));
    res.writeHead(200, { 'content-type': types[extname(file)] || 'text/plain' });
    res.end(body);
  } catch (error) {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => console.log(`GEO Auditor running at http://localhost:${port}`));

function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
