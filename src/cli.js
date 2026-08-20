#!/usr/bin/env node
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { auditSite } from './auditor.js';
import { reportToMarkdown } from './report.js';

const url = process.argv[2];
const out = process.argv[3];

if (!url) {
  console.error('Usage: npm run audit -- <url> [output-prefix]');
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error('Note: GROQ_API_KEY is not set. The technical audit will run, but observed visibility will remain unmeasured.');
}

const report = await auditSite(url);
console.log(reportToMarkdown(report));

if (out) {
  await mkdir('reports', { recursive: true });
  await writeFile(`${out}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${out}.md`, reportToMarkdown(report));
  console.log(`\nSaved ${out}.json and ${out}.md`);
}
