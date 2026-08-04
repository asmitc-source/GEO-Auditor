import { fetchPage, fetchText } from './fetcher.js';
import { probeAiCitation } from './aiProbe.js';

const MAX_PAGES = 8;

export async function auditSite(inputUrl, options = {}) {
  const startedAt = new Date().toISOString();
  const baseUrl = normalizeUrl(inputUrl);
  const origin = new URL(baseUrl).origin;
  const pages = [];

  const home = await fetchPage(baseUrl, options);
  pages.push(home);

  // Honesty gate: if we cannot even reach the homepage, do NOT run the
  // checks and print a confident-looking score of 0. That's not an audit,
  // it's a network error dressed up as findings. Say so plainly instead.
  if (!home.ok) {
    return {
      status: 'failed',
      inputUrl,
      auditedUrl: baseUrl,
      businessName: hostnameOf(baseUrl),
      generatedAt: startedAt,
      score: null,
      checks: [],
      findings: [],
      fixes: [],
      pages: pages.map(summarizePage),
      warnings: [
        `Could not fetch the homepage (${home.error || 'unknown error'}). No audit was run — a score would not be based on real evidence.`,
        'Common causes: the site blocks automated requests, requires JavaScript to render, or the URL is wrong. Try again, or try a different URL for this business.'
      ]
    };
  }

  const robots = await fetchText(new URL('/robots.txt', origin).href, options).catch(error => ({ ok: false, error: error.message, text: '' }));
  const sitemapUrls = discoverSitemaps(robots.text, origin);
  const sitemapPages = await discoverPagesFromSitemaps(sitemapUrls, origin, options);
  const linkedPages = discoverInternalLinks(home.html, origin, baseUrl);
  const candidateUrls = [...new Set([...priorityUrls(origin), ...sitemapPages, ...linkedPages])]
    .filter(url => url.startsWith(origin) && url !== baseUrl)
    .slice(0, MAX_PAGES - 1);

  for (const url of candidateUrls) pages.push(await fetchPage(url, options));

  const failedSubpages = pages.slice(1).filter(p => !p.ok).length;
  const warnings = [];
  if (failedSubpages > 0) {
    warnings.push(`${failedSubpages} of ${pages.length - 1} additional pages could not be fetched and were excluded from evidence (not counted as "missing").`);
  }

  return buildReport({ inputUrl, baseUrl, startedAt, pages, robots, warnings, options });
}

async function buildReport({ inputUrl, baseUrl, startedAt, pages, robots, warnings, options }) {
  const okPages = pages.filter(page => page.ok);
  const home = pages[0];
  const businessName = inferBusinessName(home?.html || '', baseUrl);
  const category = inferCategory(home?.html || '');

  const staticChecks = [
    entityClarityCheck(okPages, baseUrl, businessName),
    answerCitationCheck(okPages),
    crawlExtractCheck(okPages, robots)
  ];

  const aiCheck = options.skipAiProbe
    ? notRunAiCheck('AI probe skipped for this run.')
    : await buildAiCitationCheck({ businessName, baseUrl, category });

  const checks = [aiCheck, ...staticChecks];
  const scored = checks.filter(c => typeof c.score === 'number');
  const score = scored.length
    ? Math.round(scored.reduce((sum, c) => sum + c.score * c.weight, 0) / scored.reduce((sum, c) => sum + c.weight, 0))
    : null;

  const findings = checks.flatMap(check => check.findings.map(finding => ({ ...finding, check: check.name })));
  const fixes = prioritizeFixes(findings, businessName, baseUrl);

  return {
    status: 'complete',
    inputUrl,
    auditedUrl: baseUrl,
    businessName,
    category,
    generatedAt: startedAt,
    score,
    checks,
    findings,
    fixes,
    pages: pages.map(summarizePage),
    warnings
  };
}

async function buildAiCitationCheck({ businessName, baseUrl, category }) {
  const probe = await probeAiCitation({ businessName, baseUrl, category });
  if (probe.skipped) return notRunAiCheck(probe.reason);

  const mentioned = probe.results.filter(r => r.mentioned).length;
  const total = probe.results.length;
  const score = total ? Math.round((mentioned / total) * 100) : null;
  const findings = [];

  if (mentioned === 0) {
    findings.push(finding(
      'not-cited-by-ai',
      'High',
      `${businessName} was not mentioned by the AI model in any of ${total} realistic buying-intent questions.`,
      baseUrl,
      probe.results.map(r => `Q: "${r.question}" -> A: "${truncate(r.answer, 160)}"`).join('\n'),
      'This is the core visibility gap. Fixing entity clarity, adding citable answer content, and ensuring crawlability (the other checks below) is how you earn a mention over time — there is no shortcut that directly edits what a model recalls.',
      5, 4
    ));
  } else if (mentioned < total) {
    findings.push(finding(
      'partially-cited-by-ai',
      'Medium',
      `${businessName} was mentioned in ${mentioned}/${total} probe questions, not consistently.`,
      baseUrl,
      probe.results.map(r => `Q: "${r.question}" -> mentioned: ${r.mentioned}`).join('\n'),
      'Strengthen the specific content gaps flagged in the other checks so the business shows up regardless of how the question is phrased.',
      4, 3
    ));
  }

  return {
    id: 'ai-citation',
    name: 'AI engine citation probe',
    weight: 30,
    score,
    why: 'This is the direct test: does a real AI model actually mention this business for realistic buying questions? Everything else in this report is a proxy for this outcome.',
    evidence: {
      model: probe.model,
      note: 'Uses the OpenAI Chat Completions API without browsing/search — reflects the model\'s trained knowledge, not a live fetch of ChatGPT/Perplexity\'s web UI.',
      results: probe.results
    },
    findings
  };
}

function notRunAiCheck(reason) {
  return {
    id: 'ai-citation',
    name: 'AI engine citation probe',
    weight: 30,
    score: null,
    why: 'This is the direct test: does a real AI model actually mention this business for realistic buying questions? Everything else in this report is a proxy for this outcome.',
    evidence: { note: reason },
    findings: [finding(
      'ai-probe-not-run',
      'Info',
      'AI citation probe was not run.',
      null,
      reason,
      'Set OPENAI_API_KEY in .env and re-run to enable the live citation probe.',
      0, 0
    )]
  };
}

function entityClarityCheck(pages, baseUrl, businessName) {
  const home = pages[0] || { html: '', url: baseUrl };
  const text = htmlToText(home.html);
  const title = extractTag(home.html, 'title');
  const metaDescription = extractMeta(home.html, 'description');
  const jsonLd = extractJsonLd(home.html);
  const hasOrganizationSchema = jsonLd.some(item => JSON.stringify(item).toLowerCase().includes('organization') || JSON.stringify(item).toLowerCase().includes('localbusiness'));
  const hasAbout = pages.some(p => /\babout\b/i.test(p.url) || /\bwho we are\b/i.test(htmlToText(p.html)));
  const hasContact = pages.some(p => /\bcontact\b/i.test(p.url) || /\b(email|phone|address)\b/i.test(htmlToText(p.html)));
  const signals = [title && title.length > 12, metaDescription && metaDescription.length > 50, hasOrganizationSchema, hasAbout, hasContact];
  const score = percent(signals.filter(Boolean).length, signals.length);
  const findings = [];
  if (!hasOrganizationSchema) findings.push(finding('missing-entity-schema', 'High', 'Your business identity is not packaged for AI engines.', home.url, 'No Organization/LocalBusiness JSON-LD was found on the homepage.', 'Add structured data that states the business name, URL, description, logo, sameAs profiles, and contact details.', 5, 2));
  if (!metaDescription || metaDescription.length < 50) findings.push(finding('weak-description', 'Medium', 'The homepage does not clearly summarize what the business does.', home.url, `Meta description found: "${metaDescription || 'none'}"`, 'Write a plain-English 150–170 character description that says who you help, what you sell, and where/for whom.', 4, 1));
  if (!hasAbout || !hasContact) findings.push(finding('thin-trust-pages', 'Medium', 'AI answers need corroborating entity pages.', home.url, `About page detected: ${hasAbout}. Contact page detected: ${hasContact}.`, 'Expose obvious About and Contact pages in the main navigation so crawlers can verify the entity.', 3, 2));
  return { id: 'entity-clarity', name: 'Entity clarity', weight: 25, score, why: 'AI engines need to understand what entity the site represents before they can confidently recommend or cite it.', evidence: { title, metaDescription, businessName, hasOrganizationSchema, hasAbout, hasContact }, findings };
}

function answerCitationCheck(pages) {
  const evidencePages = pages.map(page => ({ page, text: htmlToText(page.html), headings: extractHeadings(page.html) }));
  const hasFaq = evidencePages.some(({ text, headings }) => /\bfaq|frequently asked|questions\b/i.test(`${headings.join(' ')} ${text}`));
  const comparisonContent = evidencePages.filter(({ text }) => /\b(best|compare|versus|vs\.|alternative|pricing|cost|service area|case study|results)\b/i.test(text));
  const statEvidence = evidencePages.filter(({ text }) => /\b\d+%|\$\d+|\d+\s+(customers|clients|years|locations|projects|reviews)\b/i.test(text));
  const quotablePages = evidencePages.filter(({ text, headings }) => text.length > 900 && headings.length >= 2);
  const signals = [hasFaq, comparisonContent.length > 0, statEvidence.length > 0, quotablePages.length >= 2];
  const score = percent(signals.filter(Boolean).length, signals.length);
  const findings = [];
  if (!hasFaq) findings.push(finding('no-question-hub', 'High', 'The site lacks a question-and-answer page AI engines can quote.', pages[0]?.url, 'No FAQ or question-led page was detected in the crawled pages.', 'Create an FAQ answering buying questions in complete, citation-friendly sentences.', 5, 2));
  if (comparisonContent.length === 0) findings.push(finding('missing-buyer-intent-content', 'High', 'There is little content for "best / cost / compare" AI-search prompts.', pages[0]?.url, 'No crawled page contained strong comparison, pricing, alternative, or case-study language.', 'Publish one page that directly answers how to choose, compare, and budget for this type of business.', 5, 3));
  if (statEvidence.length === 0) findings.push(finding('no-proof-points', 'Medium', 'Claims are hard to cite because proof points are not explicit.', pages[0]?.url, 'No concrete numbers such as years, locations, reviews, prices, or client counts were detected.', 'Add verifiable proof points near service claims.', 4, 1));
  return { id: 'answer-citation', name: 'Answer citation readiness', weight: 25, score, why: 'AI engines cite pages that directly answer natural-language questions with specific facts, comparisons, and proof.', evidence: { hasFaq, comparisonPages: comparisonContent.map(x => x.page.url), proofPointPages: statEvidence.map(x => x.page.url), quotablePages: quotablePages.map(x => x.page.url) }, findings };
}

function crawlExtractCheck(pages, robots) {
  const ok = pages.length > 0;
  const robotsBlocksAI = /User-agent:\s*(GPTBot|ChatGPT-User|PerplexityBot|ClaudeBot|Google-Extended)[\s\S]{0,120}Disallow:\s*\//i.test(robots?.text || '');
  const titles = pages.filter(p => extractTag(p.html, 'title')).length;
  const readable = pages.filter(p => htmlToText(p.html).length > 500).length;
  const canonical = pages.filter(p => /rel=["']canonical["']/i.test(p.html)).length;
  const signals = [ok, !robotsBlocksAI, titles / Math.max(pages.length, 1) > .75, readable / Math.max(pages.length, 1) > .6, canonical > 0];
  const score = percent(signals.filter(Boolean).length, signals.length);
  const findings = [];
  if (robotsBlocksAI) findings.push(finding('ai-bots-blocked', 'High', 'Robots.txt appears to block at least one major AI crawler.', new URL('/robots.txt', pages[0].url).href, 'Found an AI crawler user-agent followed by Disallow: /.', 'Only block AI crawlers intentionally. If visibility is the goal, allow crawling of public marketing pages.', 5, 1));
  if (pages.length > 0 && readable / Math.max(pages.length, 1) <= .6) findings.push(finding('low-readable-text', 'Medium', 'Several pages have too little extractable text.', pages.find(p => htmlToText(p.html).length <= 500)?.url, `${readable}/${pages.length} fetched pages had more than 500 readable characters.`, 'Move important claims out of images/scripts and into normal HTML text.', 4, 2));
  if (canonical === 0) findings.push(finding('missing-canonicals', 'Low', 'Canonical URLs were not detected.', pages[0]?.url, 'No rel="canonical" tags were found in fetched pages.', 'Add canonical tags to clarify the preferred URL for each page.', 2, 1));
  return { id: 'crawl-extract', name: 'Crawler extractability', weight: 20, score, why: 'An AI engine cannot cite what it cannot crawl, parse, or identify as the primary page.', evidence: { robotsFetched: Boolean(robots), robotsBlocksAI, fetchedPages: pages.length, pagesWithTitles: titles, readablePages: readable, pagesWithCanonicals: canonical }, findings };
}

function prioritizeFixes(findings, businessName, baseUrl) {
  return findings
    .filter(f => f.effort > 0)
    .sort((a, b) => (b.impact / b.effort) - (a.impact / a.effort))
    .map((f, index) => ({ rank: index + 1, title: f.recommendation, sourceFinding: f.id, impact: f.impact, effort: f.effort, whyNow: f.summary, copyPaste: copyPasteFor(f.id, businessName, baseUrl) }));
}

function copyPasteFor(id, businessName, baseUrl) {
  if (id === 'missing-entity-schema') return `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: businessName, url: baseUrl, description: `${businessName} helps customers with [specific outcome].`, sameAs: ['https://www.linkedin.com/company/your-company'] }, null, 2)}\n</script>`;
  if (id === 'no-question-hub') return `FAQ starter:\nQ: What should customers know before choosing ${businessName}?\nA: Customers should compare [criterion 1], [criterion 2], and [criterion 3]. ${businessName} is a strong fit when [specific buyer situation].`;
  if (id === 'weak-description') return `<meta name="description" content="${businessName} helps [ideal customer] achieve [specific outcome] with [product/service] in [market/location].">`;
  if (id === 'missing-canonicals') return `<link rel="canonical" href="${baseUrl}">`;
  if (id === 'missing-buyer-intent-content') return `Section starter:\nHow to choose [a ${businessName.toLowerCase()}-type provider]\n1. [Criterion buyers actually compare]\n2. [Second criterion]\n3. Typical cost range: $[low]–$[high]\nWhy ${businessName}: [one specific, provable differentiator].`;
  return 'Use the evidence above as the edit brief; keep the answer specific, factual, and written in complete sentences.';
}

function finding(id, severity, summary, page, evidence, recommendation, impact, effort) { return { id, severity, summary, page, evidence, recommendation, impact, effort }; }
function percent(a, b) { return Math.max(0, Math.min(100, Math.round((a / b) * 100))); }
function truncate(s = '', n) { return s.length > n ? `${s.slice(0, n)}…` : s; }
function normalizeUrl(value) { const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`; const url = new URL(withProtocol); url.hash = ''; return url.href.replace(/\/$/, '/'); }
function hostnameOf(value) { try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./, ''); } catch { return value; } }
function discoverSitemaps(text = '', origin) { const matches = [...text.matchAll(/^Sitemap:\s*(.+)$/gim)].map(m => m[1].trim()); return matches.length ? matches : [new URL('/sitemap.xml', origin).href]; }
async function discoverPagesFromSitemaps(urls, origin, options) { const pages = []; for (const url of urls.slice(0, 3)) { const res = await fetchText(url, options).catch(() => null); if (!res?.ok) continue; pages.push(...[...res.text.matchAll(/<loc>(.*?)<\/loc>/gim)].map(m => m[1]).filter(u => u.startsWith(origin)).slice(0, 12)); } return pages; }
function priorityUrls(origin) { return ['/about', '/about-us', '/contact', '/faq', '/pricing', '/case-studies', '/blog'].map(p => new URL(p, origin).href); }
function discoverInternalLinks(html, origin, baseUrl) { return [...html.matchAll(/href=["']([^"'#]+)["']/gim)].map(m => { try { return new URL(m[1], baseUrl).href.split('#')[0]; } catch { return null; } }).filter(Boolean).filter(u => u.startsWith(origin)); }
function extractTag(html, tag) { return (html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractMeta(html, name) { return html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'))?.[1] || ''; }
function extractHeadings(html) { return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gim)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean); }
function htmlToText(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function inferBusinessName(html, baseUrl) { const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]; return og || extractTag(html, 'title').split(/[|–-]/)[0].trim() || new URL(baseUrl).hostname.replace(/^www\./, ''); }
function inferCategory(html) { const meta = extractMeta(html, 'description') || extractTag(html, 'title'); return meta ? truncate(meta, 60) : 'this type of business'; }
function extractJsonLd(html) { return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim)].flatMap(m => { try { return [JSON.parse(m[1].trim())]; } catch { return []; } }); }
function summarizePage(page) { return { url: page.url, ok: page.ok, status: page.status, title: page.ok ? extractTag(page.html, 'title') : '', readableCharacters: page.ok ? htmlToText(page.html).length : 0, error: page.error }; }
