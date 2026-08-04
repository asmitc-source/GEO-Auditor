import { mkdir, writeFile } from 'node:fs/promises';
import { auditSite } from '../src/auditor.js';
import { reportToMarkdown } from '../src/report.js';

const targets = [
  ['basecamp', 'https://www.basecamp.com'],
  ['linear', 'https://linear.app'],
  ['calendly', 'https://calendly.com']
];
await mkdir('reports', { recursive: true });
for (const [name, url] of targets) {
  console.log(`Auditing ${url}`);
  const report = await auditSite(url);
  await writeFile(`reports/${name}.json`, JSON.stringify(report, null, 2));
  await writeFile(`reports/${name}.md`, reportToMarkdown(report));
}
