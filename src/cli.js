#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { auditSite } from './auditor.js';
import { reportToMarkdown } from './report.js';

const url = process.argv[2];
const out = process.argv[3];
if (!url) {
  console.error('Usage: npm run audit -- <url> [output-prefix]');
  process.exit(1);
}
const report = await auditSite(url);
console.log(reportToMarkdown(report));
if (out) {
  await mkdir('reports', { recursive: true });
  await writeFile(`${out}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${out}.md`, reportToMarkdown(report));
}
