import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { auditHtmlSnapshot, auditSite } from '../src/auditor.js';
import { reportToMarkdown } from '../src/report.js';

const targets = [
  ['basecamp', 'https://basecamp.com/', 'snapshots/basecamp.html'],
  ['linear', 'https://linear.app/', 'snapshots/linear.html'],
  ['calendly', 'https://calendly.com/', 'snapshots/calendly.html']
];
await mkdir('reports', { recursive: true });
for (const [name, url, snapshotPath] of targets) {
  console.log(`Auditing ${url}`);
  let report;
  if (process.argv.includes('--live')) {
    report = await auditSite(url);
  } else {
    const html = await readFile(snapshotPath, 'utf8');
    report = auditHtmlSnapshot(url, html, { generatedAt: '2026-08-04T19:45:00.000Z' });
  }
  await writeFile(`reports/${name}.json`, JSON.stringify(report, null, 2));
  await writeFile(`reports/${name}.md`, reportToMarkdown(report));
}
