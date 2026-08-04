# GEO Auditor

A focused Generative Engine Optimization auditor for business owners. Enter a website URL and receive a scored report explaining whether AI answer engines can understand, trust, and cite the business.

## Run in under 5 minutes

Prerequisite: Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000 and audit a URL.

CLI usage:

```bash
npm run audit -- https://www.example.com reports/example
```

That prints Markdown and writes `reports/example.json` plus `reports/example.md`.

## What I chose to build

I built a local web app and CLI that performs a live crawl of the submitted site, then scores three GEO checks:

1. **Entity clarity (35%)** — AI engines need to know what real-world entity the site represents. The auditor looks for title/meta description quality, Organization or LocalBusiness JSON-LD, and obvious About/Contact corroboration.
2. **Answer citation readiness (40%)** — AI answers tend to cite pages that directly answer natural-language buying questions. The auditor looks for FAQ/question-led content, comparison/pricing/case-study language, concrete proof points, and pages with enough structured headings and readable text to quote.
3. **Crawler extractability (25%)** — AI systems cannot cite pages they cannot fetch or parse. The auditor checks fetch success, robots.txt AI-bot blocking patterns, titles, readable text volume, and canonical tags.

The score is intentionally visible: each check reports its weight, score, evidence, findings, and prioritized fixes. Findings name the page, proof, impact, effort, and a copy-pasteable starting point where possible.

## What I cut and why

- **Direct ChatGPT/Claude/Perplexity querying:** cut because it requires paid credentials, results vary by account/location/time, and a fake mocked answer would be misleading. I would add it only with clear labeling and stored prompts/responses.
- **Large whole-site crawling:** cut to keep audits fast and robust for a take-home. The crawler samples the homepage, sitemap URLs, priority business pages, and internal links.
- **PDF export/auth/billing/database:** cut because the report quality matters more than operational scaffolding.
- **Exhaustive technical SEO:** cut because generic SEO tools already do that. This tool focuses on AI-answer visibility signals a business owner can act on.

## What is real vs mocked

Real:

- Live HTTP fetches of the homepage, robots.txt, sitemap, and sampled pages.
- Evidence extraction from actual HTML returned during the run.
- Deterministic scoring and prioritization.
- Web UI and CLI.

Mocked:

- Nothing is presented as a live external AI-engine result. The sample JSON/Markdown reports are real runs from this tool, but they are point-in-time crawl snapshots.

## Included real audit reports

Three point-in-time reports are included in `reports/`:

- Basecamp — `reports/basecamp.md`
- Linear — `reports/linear.md`
- Calendly — `reports/calendly.md`

Regenerate them with:

```bash
npm run demo
```

## What I would build next with another week

1. Add optional API-backed prompt probes for ChatGPT, Perplexity, Claude, and Google AI Overviews, storing the exact prompt, answer, citations, timestamp, and engine.
2. Add competitor comparison: “which businesses are cited instead of you, and why?”
3. Add industry-specific prompt packs for restaurants, B2B SaaS, local services, ecommerce, healthcare, and legal.
4. Export polished PDFs and shareable report links.
5. Add screenshot-based evidence for pages where important content is hidden in images or client-side rendering.

## Demo video script

A 3–5 minute walkthrough should cover:

1. Run `npm start` and enter one of the sample URLs.
2. Explain the three checks and why they map to AI search visibility.
3. Open one finding and point to the exact evidence.
4. Show the prioritized copy-paste fix list.
5. State the key cut: no fake AI-engine answers; direct answer-engine probes are the next paid/API-backed layer.
