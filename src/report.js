export function reportToMarkdown(report) {
  if (report.status === 'failed') {
    return `# GEO Audit: ${report.businessName}\n\nGenerated: ${report.generatedAt}\nURL requested: ${report.inputUrl}\n\n## Audit could not run\n\n${report.warnings.map(w => `- ${w}`).join('\n')}\n\nNo score is shown because no evidence was gathered. This is intentional: a confident-looking score built on a failed fetch would be worse than no score.\n`;
  }

  const checks = report.checks.map(c => `| ${c.name} | ${c.weight}% | ${typeof c.score === 'number' ? `${c.score}/100` : 'not run'} | ${c.why} |`).join('\n');
  const findings = report.findings.length
    ? report.findings.map(f => `### ${f.severity}: ${f.summary}\n- **Page:** ${f.page || report.auditedUrl}\n- **Proof:**\n\n  \`\`\`\n  ${String(f.evidence).split('\n').join('\n  ')}\n  \`\`\`\n- **Fix:** ${f.recommendation}${f.impact ? `\n- **Impact / effort:** ${f.impact}/5 / ${f.effort}/5` : ''}`).join('\n\n')
    : 'No major findings detected in the selected checks.';
  const fixes = report.fixes.map(f => `### ${f.rank}. ${f.title}\n- **Why now:** ${f.whyNow}\n- **Impact / effort:** ${f.impact}/5 / ${f.effort}/5\n\n\`\`\`\n${f.copyPaste}\n\`\`\``).join('\n\n');

  return `# GEO Audit Report: ${report.businessName}

Generated: ${report.generatedAt}
URL: ${report.auditedUrl}
${report.category ? `Category (inferred): ${report.category}\n` : ''}
## AI Search Visibility Score: ${typeof report.score === 'number' ? `${report.score}/100` : 'not scored (see warnings)'}

| Check | Weight | Score | Why it matters |
| --- | ---: | ---: | --- |
${checks}

${report.warnings.length ? `## Notes on this run\n\n${report.warnings.map(w => `- ${w}`).join('\n')}\n` : ''}
## What is broken, with evidence

${findings}

## Monday-morning fix list

${fixes || 'No fixes required by these checks.'}

## Crawled pages

${report.pages.map(p => `- ${p.ok ? 'OK' : 'FAIL'} ${p.status || ''} ${p.url} — ${p.title || p.error || 'No title'} (${p.readableCharacters || 0} readable chars)`).join('\n')}

## Methodology notes

- The AI engine citation probe calls the OpenAI API directly (no browsing/search tool attached). It reflects the model's trained knowledge of the business, not a live scrape of ChatGPT/Perplexity's product UI. If \`OPENAI_API_KEY\` is unset, this check is skipped and excluded from the score — never simulated.
- All other checks are built from a live crawl of the site performed during this run. Pages that failed to fetch are excluded from evidence rather than counted as "missing."
`;
}
