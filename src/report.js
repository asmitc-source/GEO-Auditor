export function reportToMarkdown(report) {
  if (report.status === 'failed') {
    return `# GEO Audit: ${report.businessName}\n\nGenerated: ${report.generatedAt}\nURL requested: ${report.inputUrl}\n\n## Audit could not run\n\n${report.warnings.map(warning => `- ${warning}`).join('\n')}\n\nNo score is shown because no reliable site evidence was gathered.\n`;
  }

  const checks = report.checks
    .map(check => `| ${check.name} | ${check.weight}% | ${check.score}/100 | ${check.why} |`)
    .join('\n');
  const findings = report.findings.length
    ? report.findings.map(item => `### ${item.severity}: ${item.summary}\n- **Area:** ${item.check || 'Audit'}\n- **Page:** ${item.page || report.auditedUrl}\n- **Evidence:**\n\n  \`\`\`\n  ${String(item.evidence).split('\n').join('\n  ')}\n  \`\`\`\n- **Recommendation:** ${item.recommendation}${item.impact ? `\n- **Impact / effort:** ${item.impact}/5 / ${item.effort}/5` : ''}`).join('\n\n')
    : 'No major findings detected in the sampled checks.';
  const fixes = report.fixes
    .map(fix => `### ${fix.rank}. ${fix.title}\n- **Why now:** ${fix.whyNow}\n- **Impact / effort:** ${fix.impact}/5 / ${fix.effort}/5\n\n\`\`\`\n${fix.copyPaste}\n\`\`\``)
    .join('\n\n');

  return `# GEO Audit Report: ${report.businessName}

Generated: ${report.generatedAt}
URL: ${report.auditedUrl}
Category inferred from the homepage: ${report.category}

## Technical AI-readiness score: ${report.readinessScore}/100

This score is deterministic and based only on evidence from the site crawl. It is not presented as observed visibility.

| Check | Weight | Score | Why it matters |
| --- | ---: | ---: | --- |
${checks}

${renderVisibility(report.visibility)}

${report.warnings.length ? `## Notes on this run\n\n${report.warnings.map(warning => `- ${warning}`).join('\n')}\n` : ''}
## Evidence-backed findings

${findings}

## Prioritized implementation list

${fixes || 'No fixes required by these checks.'}

## Crawled pages

${report.pages.map(page => `- ${page.ok ? 'OK' : 'FAIL'} ${page.status || ''} ${page.url} — ${page.title || page.error || 'No title'} (${page.readableCharacters || 0} readable characters)`).join('\n')}

## Methodology notes

- Technical readiness and observed visibility are deliberately separate. A technically excellent site can still be absent from grounded answers.
- The optional visibility snapshot uses one neutral category search through Groq Compound Mini with web search. It inspects the returned source set for the audited brand and domain.
- This does not measure ChatGPT, Gemini, Perplexity, or Google AI Overviews and is never labeled as such.
- Failed pages are excluded from evidence rather than counted as missing features.
`;
}

function renderVisibility(visibility) {
  if (!visibility || visibility.skipped) {
    return `## Observed visibility snapshot: not measured\n\n${visibility?.reason || 'No provider response was available.'}`;
  }
  const score = typeof visibility.score === 'number' ? `${visibility.score}/100` : 'not scored';
  const sources = visibility.sources?.length
    ? visibility.sources.map(source => `- [${source.title}](${source.url}) — ${source.domain}`).join('\n')
    : '- No inspectable grounded sources returned.';
  return `## Observed visibility snapshot: ${score}

Provider: ${visibility.provider} / ${visibility.model}
Category query: ${visibility.category}
Measured: ${visibility.measuredAt}${visibility.cached ? ' (cached result)' : ''}

### Grounded answer

${visibility.answer || 'No answer returned.'}

### Sources inspected

${sources}

> ${visibility.note || ''}`;
}
