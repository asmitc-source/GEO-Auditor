import { fetchPage, fetchText } from './fetcher.js';
import { probeAiVisibility } from './groq.js';

const MAX_PAGES = 10;
const PAGE_PRIORITY = /\b(about|contact|faq|pricing|case-stud|customers|reviews|blog|resources|comparison|alternatives)\b/i;
const NON_HTML_EXTENSION = /\.(?:avif|css|csv|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webp|woff2?|xml|zip)$/i;

export async function auditSite(inputUrl, options = {}) {
  const startedAt = new Date().toISOString();
  const baseUrl = normalizeUrl(inputUrl);
  const origin = new URL(baseUrl).origin;
  const pages = [];

  const home = await fetchPage(baseUrl, options);
  pages.push(home);

  if (!home.ok) {
    return {
      status: 'failed',
      inputUrl,
      auditedUrl: baseUrl,
      businessName: hostnameOf(baseUrl),
      generatedAt: startedAt,
      score: null,
      readinessScore: null,
      visibility: { skipped: true, score: null, reason: 'The homepage could not be fetched.' },
      checks: [],
      findings: [],
      fixes: [],
      pages: pages.map(summarizePage),
      warnings: [
        `Could not fetch the homepage (${home.error || 'unknown error'}). No audit was run because a score would not be based on real evidence.`,
        'Common causes: the site blocks automated requests, requires JavaScript to render, or the URL is incorrect.'
      ]
    };
  }

  const robots = await fetchText(new URL('/robots.txt', origin).href, options)
    .catch(error => ({ ok: false, error: error.message, text: '' }));
  const sitemapUrls = discoverSitemaps(robots.text, origin);
  const sitemapDiscovery = await discoverPagesFromSitemaps(sitemapUrls, origin, options);
  const linkedPages = discoverInternalLinks(home.html, origin, baseUrl);
  const candidateUrls = rankCandidateUrls([...sitemapDiscovery.pages, ...linkedPages], origin, baseUrl)
    .slice(0, MAX_PAGES - 1);

  pages.push(...await mapWithConcurrency(candidateUrls, 3, url => fetchPage(url, options)));

  const failedSubpages = pages.slice(1).filter(page => !page.ok).length;
  const warnings = [];
  if (!candidateUrls.length) warnings.push('No crawlable internal HTML links or sitemap pages were discovered, so the audit is based on the homepage.');
  if (failedSubpages > 0) {
    warnings.push(`${failedSubpages} of ${pages.length - 1} discovered pages could not be fetched and were excluded from evidence.`);
  }

  return buildReport({
    inputUrl,
    baseUrl,
    startedAt,
    pages,
    robots,
    sitemapDiscovery,
    warnings,
    options
  });
}

async function buildReport({ inputUrl, baseUrl, startedAt, pages, robots, sitemapDiscovery, warnings, options }) {
  const okPages = pages.filter(page => page.ok);
  const home = pages[0];
  const businessName = inferBusinessName(home.html, baseUrl);
  const category = inferCategory(home.html);

  const checks = [
    entityClarityCheck(okPages, baseUrl, businessName),
    answerCitationCheck(okPages),
    crawlExtractCheck(okPages, robots, sitemapDiscovery),
    trustFreshnessCheck(okPages, baseUrl)
  ];
  const readinessScore = weightedScore(checks);

  const visibility = options.skipAiProbe
    ? { skipped: true, score: null, reason: 'Observed visibility snapshot skipped for this run.', sources: [] }
    : await probeAiVisibility({ businessName, baseUrl, category });

  if (visibility.skipped) warnings.push(`Observed AI visibility was not measured: ${visibility.reason}`);
  else if (visibility.score === null) warnings.push(`Observed AI visibility was not scored: ${visibility.reason}`);

  const checkFindings = checks.flatMap(check => check.findings.map(item => ({ ...item, check: check.name })));
  const visibilityFindings = buildVisibilityFindings(visibility, businessName, baseUrl);
  const findings = [...visibilityFindings, ...checkFindings];
  const fixes = prioritizeFixes(findings, businessName, baseUrl, visibility);

  return {
    status: 'complete',
    inputUrl,
    auditedUrl: baseUrl,
    businessName,
    category,
    generatedAt: startedAt,
    score: readinessScore,
    readinessScore,
    visibilityScore: visibility.score,
    visibility,
    checks,
    findings,
    fixes,
    pages: pages.map(summarizePage),
    warnings,
    methodology: {
      readiness: 'Deterministic score from the site crawl only.',
      visibility: 'A separate provider-specific snapshot from one neutral Groq web-grounded category search.'
    }
  };
}

function buildVisibilityFindings(visibility, businessName, baseUrl) {
  if (visibility.skipped || typeof visibility.score !== 'number') return [];
  const evidence = visibility.sources.length
    ? visibility.sources.map((source, index) => `${index + 1}. ${source.title} — ${source.domain}`).join('\n')
    : 'No inspectable grounded sources were returned.';

  if (visibility.score === 0) {
    return [finding(
      'not-observed-in-grounded-sources',
      'High',
      `${businessName} was not found in the grounded source set for this neutral category search.`,
      baseUrl,
      evidence,
      'Build accurate third-party corroboration and a category page that directly answers the buying query shown in the visibility snapshot.',
      5,
      4,
      'Observed visibility'
    )];
  }
  if (visibility.score < 80) {
    return [finding(
      'partial-grounded-visibility',
      'Medium',
      `${businessName} appeared in part of the grounded source set, but its independent corroboration is limited.`,
      baseUrl,
      evidence,
      'Strengthen the specific owned or third-party coverage gap shown in the snapshot metrics.',
      4,
      3,
      'Observed visibility'
    )];
  }
  return [];
}

function entityClarityCheck(pages, baseUrl, businessName) {
  const home = pages[0] || { html: '', url: baseUrl };
  const title = extractTag(home.html, 'title');
  const metaDescription = extractMeta(home.html, 'description');
  const jsonLdText = JSON.stringify(extractJsonLd(home.html)).toLowerCase();
  const hasOrganizationSchema = /"@type"\s*:\s*"(?:organization|localbusiness|corporation|professionalservice)"/i.test(jsonLdText);
  const hasSameAs = /"sameas"\s*:/.test(jsonLdText);
  const hasAbout = pages.some(page => /\babout(?:-us)?\b/i.test(page.url) || /\bwho we are\b/i.test(htmlToText(page.html)));
  const hasContact = pages.some(page => /\bcontact\b/i.test(page.url) || /\b(?:email|phone|address)\b/i.test(htmlToText(page.html)));
  const signals = [title.length > 12, metaDescription.length > 50, hasOrganizationSchema, hasSameAs, hasAbout, hasContact];
  const findings = [];

  if (!hasOrganizationSchema) findings.push(finding('missing-entity-schema', 'High', 'The homepage does not package the business as a clear machine-readable entity.', home.url, 'No Organization or LocalBusiness JSON-LD was found.', 'Add Organization JSON-LD with the verified name, URL, logo, description, contact details, and official profiles.', 5, 2));
  if (!hasSameAs) findings.push(finding('missing-sameas', 'Medium', 'The site does not connect the entity to its official external profiles.', home.url, 'No sameAs property was found in homepage JSON-LD.', 'Add only verified official profiles to the Organization schema sameAs array.', 3, 1));
  if (metaDescription.length < 50) findings.push(finding('weak-description', 'Medium', 'The homepage summary is missing or too vague for fast entity classification.', home.url, `Meta description: "${metaDescription || 'none'}"`, 'Write a specific description naming the audience, product or service, and outcome.', 4, 1));
  if (!hasAbout || !hasContact) findings.push(finding('thin-trust-pages', 'Medium', 'The crawl could not verify both About and Contact information.', home.url, `About detected: ${hasAbout}. Contact detected: ${hasContact}.`, 'Link clear About and Contact pages from the primary navigation or footer.', 3, 2));

  return {
    id: 'entity-clarity',
    name: 'Entity clarity',
    weight: 30,
    score: percent(signals.filter(Boolean).length, signals.length),
    why: 'Answer engines need an unambiguous entity before they can confidently recommend it.',
    evidence: { title, metaDescription, businessName, hasOrganizationSchema, hasSameAs, hasAbout, hasContact },
    findings
  };
}

function answerCitationCheck(pages) {
  const evidencePages = pages.map(page => ({ page, text: htmlToText(page.html), headings: extractHeadings(page.html) }));
  const hasFaq = evidencePages.some(({ text, headings }) => /\bfaq|frequently asked|questions\b/i.test(`${headings.join(' ')} ${text}`));
  const comparisonContent = evidencePages.filter(({ text }) => /\b(best|compare|versus|vs\.?|alternative|pricing|cost|case stud|results)\b/i.test(text));
  const proofPointPages = evidencePages.filter(({ text }) => /\b\d+%|[$₹€£]\s?\d+|\d+\s+(customers|clients|years|locations|projects|reviews)\b/i.test(text));
  const quotablePages = evidencePages.filter(({ text, headings }) => text.length > 900 && headings.length >= 2);
  const tablePages = pages.filter(page => /<table\b/i.test(page.html));
  const signals = [hasFaq, comparisonContent.length > 0, proofPointPages.length > 0, quotablePages.length >= Math.min(2, pages.length), tablePages.length > 0];
  const findings = [];

  if (!hasFaq) findings.push(finding('no-question-hub', 'High', 'No question-led answer hub was found in the crawled pages.', pages[0]?.url, 'No FAQ or question-led page was detected.', 'Add an FAQ or buyer-question section with short answer-first responses and supporting detail.', 5, 2));
  if (!comparisonContent.length) findings.push(finding('missing-buyer-intent-content', 'High', 'The crawl found little content for comparison, pricing, alternatives, or outcome prompts.', pages[0]?.url, 'No strong buyer-intent language appeared in the sampled pages.', 'Publish a transparent comparison or selection guide that explains fit, trade-offs, pricing approach, and alternatives.', 5, 3));
  if (!proofPointPages.length) findings.push(finding('no-proof-points', 'Medium', 'Important claims lack explicit, extractable proof points.', pages[0]?.url, 'No concrete percentages, prices, client counts, locations, years, projects, or reviews were detected.', 'Place verifiable numbers next to the claims they support and explain their source or timeframe.', 4, 1));
  if (!tablePages.length) findings.push(finding('no-structured-comparison', 'Low', 'No native HTML table was found for dense comparison information.', pages[0]?.url, 'The crawl did not detect a table element.', 'Use a concise native HTML table where buyers repeatedly compare the same fields.', 2, 2));

  return {
    id: 'answer-citation',
    name: 'Answer readiness',
    weight: 30,
    score: percent(signals.filter(Boolean).length, signals.length),
    why: 'Citable pages answer a real question with explicit facts, structure, and buyer context.',
    evidence: {
      hasFaq,
      comparisonPages: comparisonContent.map(item => item.page.url),
      proofPointPages: proofPointPages.map(item => item.page.url),
      quotablePages: quotablePages.map(item => item.page.url),
      tablePages: tablePages.map(page => page.url)
    },
    findings
  };
}

function crawlExtractCheck(pages, robots, sitemapDiscovery) {
  const blockedAgents = findBlockedAiAgents(robots?.text || '');
  const titleCount = pages.filter(page => extractTag(page.html, 'title')).length;
  const readableCount = pages.filter(page => htmlToText(page.html).length > 500).length;
  const canonicalCount = pages.filter(page => /<link[^>]+rel=["'][^"']*canonical/i.test(page.html) || /<link[^>]+href=["'][^"']+["'][^>]+rel=["'][^"']*canonical/i.test(page.html)).length;
  const denominator = Math.max(pages.length, 1);
  const signals = [
    blockedAgents.length === 0,
    sitemapDiscovery.fetched,
    titleCount / denominator > 0.75,
    readableCount / denominator > 0.6,
    canonicalCount / denominator > 0.5
  ];
  const findings = [];

  if (blockedAgents.length) findings.push(finding('ai-bots-blocked', 'High', 'Robots.txt blocks one or more major AI-related crawlers.', new URL('/robots.txt', pages[0].url).href, `Blocked agents: ${blockedAgents.join(', ')}.`, 'If AI visibility is the goal, allow public marketing content for the blocked agents after reviewing policy implications.', 5, 1));
  if (readableCount / denominator <= 0.6) findings.push(finding('low-readable-text', 'Medium', 'Too much important content may be unavailable as normal HTML text.', pages.find(page => htmlToText(page.html).length <= 500)?.url, `${readableCount}/${pages.length} fetched pages had more than 500 readable characters.`, 'Render primary claims, headings, proof, and navigation in server-delivered semantic HTML.', 4, 2));
  if (canonicalCount / denominator <= 0.5) findings.push(finding('missing-canonicals', 'Low', 'Canonical coverage is incomplete across the sampled pages.', pages[0]?.url, `${canonicalCount}/${pages.length} fetched pages exposed a canonical URL.`, 'Add a self-referencing canonical to each indexable page template.', 2, 1));
  if (!sitemapDiscovery.fetched) findings.push(finding('missing-sitemap', 'Low', 'No readable XML sitemap was discovered.', new URL('/sitemap.xml', pages[0].url).href, 'Neither a robots.txt-declared sitemap nor /sitemap.xml returned a usable URL set.', 'Publish an XML sitemap and reference it from robots.txt.', 2, 1));

  return {
    id: 'crawl-extract',
    name: 'Crawler extractability',
    weight: 25,
    score: percent(signals.filter(Boolean).length, signals.length),
    why: 'Content cannot be retrieved or cited if crawlers cannot safely discover, parse, and canonicalize it.',
    evidence: {
      robotsFetched: Boolean(robots?.ok),
      blockedAiAgents: blockedAgents,
      sitemapFetched: sitemapDiscovery.fetched,
      sitemapPagesFound: sitemapDiscovery.pages.length,
      fetchedPages: pages.length,
      pagesWithTitles: titleCount,
      readablePages: readableCount,
      pagesWithCanonicals: canonicalCount
    },
    findings
  };
}

function trustFreshnessCheck(pages, baseUrl) {
  const combinedHtml = pages.map(page => page.html).join('\n');
  const combinedText = htmlToText(combinedHtml);
  const jsonLd = JSON.stringify(pages.flatMap(page => extractJsonLd(page.html))).toLowerCase();
  const hasAuthor = /"author"\s*:/.test(jsonLd) || /\b(?:written|reviewed) by\b|\bby [A-Z][a-z]+ [A-Z][a-z]+\b/.test(combinedText);
  const hasFreshness = /"date(?:published|modified)"\s*:/.test(jsonLd) || /\b(?:updated|published|last modified)\b.{0,40}\b20\d{2}\b/i.test(combinedText);
  const hasEditorialPage = pages.some(page => /\b(editorial|methodology|standards|fact-check)\b/i.test(`${page.url} ${htmlToText(page.html)}`));
  const hasCaseEvidence = pages.some(page => /\b(case stud|customer stor|testimonial|results|reviews)\b/i.test(`${page.url} ${htmlToText(page.html)}`));
  const externalReferenceCount = countExternalReferences(pages, new URL(baseUrl).origin);
  const signals = [hasAuthor, hasFreshness, hasEditorialPage, hasCaseEvidence, externalReferenceCount >= 2];
  const findings = [];

  if (!hasAuthor || !hasFreshness) findings.push(finding('weak-authorship-freshness', 'Medium', 'The sampled content does not consistently expose authorship and freshness signals.', pages[0]?.url, `Author detected: ${hasAuthor}. Published/updated date detected: ${hasFreshness}.`, 'Show a real author or reviewer plus visible published and updated dates on substantial content.', 4, 2));
  if (!hasEditorialPage) findings.push(finding('missing-editorial-methodology', 'Low', 'No editorial or methodology page was discovered.', pages[0]?.url, 'The sampled navigation and page text did not expose editorial standards, methodology, or fact-checking information.', 'Publish a short standards page explaining sourcing, review, corrections, and commercial relationships.', 3, 2));
  if (!hasCaseEvidence) findings.push(finding('missing-first-party-evidence', 'Medium', 'No clear case study, customer story, testimonial, review, or results page was found.', pages[0]?.url, 'The sampled pages lacked a discoverable first-party evidence section.', 'Publish a specific outcome page with customer context, method, timeframe, and verifiable results.', 4, 3));

  return {
    id: 'trust-freshness',
    name: 'Trust & freshness',
    weight: 15,
    score: percent(signals.filter(Boolean).length, signals.length),
    why: 'Authorship, dates, methodology, references, and first-party evidence help systems verify a claim.',
    evidence: { hasAuthor, hasFreshness, hasEditorialPage, hasCaseEvidence, externalReferenceCount },
    findings
  };
}

function prioritizeFixes(findings, businessName, baseUrl, visibility) {
  return findings
    .filter(item => item.effort > 0)
    .sort((a, b) => (b.impact / b.effort) - (a.impact / a.effort) || b.impact - a.impact)
    .slice(0, 8)
    .map((item, index) => ({
      rank: index + 1,
      title: item.recommendation,
      sourceFinding: item.id,
      impact: item.impact,
      effort: item.effort,
      whyNow: item.summary,
      copyPaste: implementationBrief(item.id, businessName, baseUrl, visibility)
    }));
}

function implementationBrief(id, businessName, baseUrl, visibility) {
  if (id === 'missing-entity-schema' || id === 'missing-sameas') {
    return `<script type="application/ld+json">\n${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: businessName,
      url: baseUrl,
      description: '[Use the verified one-sentence company description]',
      logo: '[Absolute logo URL]',
      sameAs: ['[Verified LinkedIn/company profile URL]']
    }, null, 2)}\n</script>`;
  }
  if (id === 'no-question-hub') return `Page brief: ${businessName} buyer questions\n\nFor each question:\n1. Give a 40-80 word direct answer.\n2. Add criteria, limits, and a concrete example.\n3. Link to the page that proves the claim.\n4. Add FAQPage schema only when the answers are visible on the page.`;
  if (id === 'weak-description') return `<meta name="description" content="${businessName} provides [specific product/service] for [specific audience], helping them achieve [verified outcome].">`;
  if (id === 'missing-canonicals') return `<link rel="canonical" href="${baseUrl}">`;
  if (id === 'missing-sitemap') return `robots.txt\n\nUser-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', baseUrl).href}`;
  if (id === 'not-observed-in-grounded-sources' || id === 'partial-grounded-visibility') {
    const domains = [...new Set((visibility.sources || []).map(source => source.domain))].slice(0, 6);
    return `Visibility coverage brief for ${businessName}\n\nNeutral query category: ${visibility.category || '[category]'}\nSources surfaced: ${domains.join(', ') || 'none returned'}\n\nCreate or earn coverage that adds genuinely new evidence: a transparent comparison, verified customer result, expert contribution, original dataset, or independently reviewable product information. Do not manufacture reviews or spam communities.`;
  }
  if (id === 'weak-authorship-freshness') return `Content trust block\n\nWritten by: [real author name and relevant role]\nReviewed by: [reviewer, when appropriate]\nPublished: [YYYY-MM-DD]\nLast updated: [YYYY-MM-DD]\nSources and methodology: [link]`;
  return `Implementation brief for ${businessName}\n\nEvidence: use the finding above as the acceptance test.\nChange: implement the recommended fix only with verified facts.\nQA: re-run this audit and confirm the underlying evidence changes, not only the displayed score.`;
}

function weightedScore(checks) {
  const scored = checks.filter(check => typeof check.score === 'number');
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, check) => sum + check.score * check.weight, 0) / scored.reduce((sum, check) => sum + check.weight, 0));
}

function finding(id, severity, summary, page, evidence, recommendation, impact, effort, check) {
  return { id, severity, summary, page, evidence, recommendation, impact, effort, ...(check ? { check } : {}) };
}

function findBlockedAiAgents(text) {
  const targetAgents = new Set(['gptbot', 'chatgpt-user', 'perplexitybot', 'claudebot', 'anthropic-ai', 'google-extended', 'ccbot']);
  const blocked = new Set();
  let agents = [];
  let groupHasDirective = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const agent = line.match(/^user-agent\s*:\s*(.+)$/i)?.[1]?.trim().toLowerCase();
    if (agent) {
      if (groupHasDirective) {
        agents = [];
        groupHasDirective = false;
      }
      agents.push(agent);
      continue;
    }
    const disallow = line.match(/^disallow\s*:\s*(.*)$/i)?.[1]?.trim();
    if (/^(allow|disallow|crawl-delay)\s*:/i.test(line)) groupHasDirective = true;
    if (disallow === '/') {
      for (const candidate of agents) if (targetAgents.has(candidate)) blocked.add(candidate);
    }
  }
  return [...blocked];
}

function rankCandidateUrls(urls, origin, baseUrl) {
  const normalizedBase = canonicalUrl(baseUrl);
  return [...new Set(urls.map(canonicalUrl).filter(Boolean))]
    .filter(url => new URL(url).origin === origin && url !== normalizedBase && !NON_HTML_EXTENSION.test(new URL(url).pathname))
    .sort((a, b) => Number(PAGE_PRIORITY.test(b)) - Number(PAGE_PRIORITY.test(a)) || new URL(a).pathname.length - new URL(b).pathname.length);
}

async function discoverPagesFromSitemaps(urls, origin, options) {
  const pages = [];
  let fetched = false;
  const queue = urls.slice(0, 3);
  const visited = new Set();
  while (queue.length && visited.size < 6) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const response = await fetchText(url, options).catch(() => null);
    if (!response?.ok || !/<(?:urlset|sitemapindex|loc)\b/i.test(response.text)) continue;
    fetched = true;
    const locations = [...response.text.matchAll(/<loc>(.*?)<\/loc>/gim)].map(match => decodeEntities(match[1].trim()));
    for (const location of locations.slice(0, 40)) {
      try {
        const parsed = new URL(location);
        if (parsed.origin !== origin) continue;
        if (parsed.pathname.endsWith('.xml')) {
          if (queue.length < 6) queue.push(parsed.href);
        } else {
          pages.push(parsed.href);
        }
      } catch {
        // Ignore malformed sitemap entries.
      }
    }
  }
  return { pages, fetched };
}

function discoverSitemaps(text, origin) {
  const matches = [...String(text || '').matchAll(/^sitemap\s*:\s*(.+)$/gim)].map(match => match[1].trim());
  return matches.length ? matches : [new URL('/sitemap.xml', origin).href];
}

function discoverInternalLinks(html, origin, baseUrl) {
  return [...String(html || '').matchAll(/href=["']([^"'#]+)["']/gim)]
    .map(match => {
      try {
        const url = new URL(decodeEntities(match[1]), baseUrl);
        url.hash = '';
        return url.origin === origin ? url.href : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function countExternalReferences(pages, origin) {
  const excluded = /(?:facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok)\.com$/i;
  const unique = new Set();
  for (const page of pages) {
    for (const match of page.html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gim)) {
      try {
        const url = new URL(match[1]);
        if (url.origin !== origin && !excluded.test(url.hostname)) unique.add(url.href);
      } catch {
        // Ignore malformed links.
      }
    }
  }
  return unique.size;
}

function extractTag(html, tag) {
  return decodeEntities((String(html || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractMeta(html, name) {
  const value = String(html || '').match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1]
    || String(html || '').match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'))?.[1]
    || '';
  return decodeEntities(value);
}

function extractHeadings(html) {
  return [...String(html || '').matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gim)]
    .map(match => decodeEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function inferBusinessName(html, baseUrl) {
  const og = String(html || '').match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1];
  return decodeEntities(og || extractTag(html, 'title').split(/[|–—-]/)[0].trim() || new URL(baseUrl).hostname.replace(/^www\./, ''));
}

function inferCategory(html) {
  const description = extractMeta(html, 'description');
  const title = extractTag(html, 'title');
  const value = description || title;
  return value ? truncate(value, 140) : 'this type of business';
}

function extractJsonLd(html) {
  return [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim)]
    .flatMap(match => {
      try { return [JSON.parse(match[1].trim())]; } catch { return []; }
    });
}

function summarizePage(page) {
  return {
    url: page.url,
    finalUrl: page.finalUrl && page.finalUrl !== page.url ? page.finalUrl : undefined,
    ok: page.ok,
    status: page.status,
    title: page.ok ? extractTag(page.html, 'title') : '',
    readableCharacters: page.ok ? htmlToText(page.html).length : 0,
    error: page.error
  };
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Enter a website URL.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// URLs can be audited.');
  url.hash = '';
  return canonicalUrl(url.href);
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key)) url.searchParams.delete(key);
    }
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    return url.href;
  } catch {
    return null;
  }
}

function hostnameOf(value) {
  try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./, ''); } catch { return String(value || ''); }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function percent(a, b) { return Math.max(0, Math.min(100, Math.round((a / Math.max(b, 1)) * 100))); }
function truncate(value = '', length) { return value.length > length ? `${value.slice(0, length)}…` : value; }
