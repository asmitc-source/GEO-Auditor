import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { auditSite } from '../src/auditor.js';
import { reportToMarkdown } from '../src/report.js';

// EDIT THIS LIST: pick 3-5 real businesses you know well enough to sanity
// check the output. A good mix: one well-known brand, one small/local
// business, and one you suspect is doing GEO badly (thin site, no schema).
const targets = [
  ['example-one', 'https://example.com'],
  ['example-two', 'https://example.org']
];

await mkdir('reports', { recursive: true });

for (const [name, url] of targets) {
  console.log(`Auditing ${url}...`);
  const report = await auditSite(url);
  await writeFile(`reports/${name}.json`, JSON.stringify(report, null, 2));
  await writeFile(`reports/${name}.md`, reportToMarkdown(report));
  console.log(`  -> reports/${name}.md  (status: ${report.status}, score: ${report.score ?? 'n/a'})`);
}

console.log('\nDone. Review reports/*.md before submitting — make sure none say "status: failed".');
