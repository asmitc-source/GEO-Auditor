<div align="center">

# GEO Auditor

**Evidence-first technical readiness and grounded source visibility**

Enter a business URL to receive a live crawl, an explainable technical AI-readiness score, a separate Groq web-grounded visibility snapshot, and a prioritized implementation brief.

</div>

## What this version fixes

- Technical readiness and observed AI visibility are separate scores. Missing provider data is never blended into a confident-looking total.
- The old OpenAI training-knowledge probe is replaced by Groq Compound Mini with live web search.
- The unreliable Reddit crawler is replaced by a source explorer that shows the exact web sources returned by a grounded category search. Reddit is excluded by default.
- The crawler follows real navigation and sitemap URLs instead of guessing `/about`, `/pricing`, and other paths.
- Seven-day caching, a 200-call local daily ceiling, per-client throttling, and no paid fallback protect the free MVP.
- Private-network URLs, unsafe redirect targets, and static path traversal are blocked.

## Run locally

```bash
git clone https://github.com/asmitc-source/GEO-Auditor.git
cd GEO-Auditor
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

The deterministic technical audit works without any LLM key. To enable grounded visibility and Source Explorer, create a free key at [GroqCloud](https://console.groq.com/keys) and add it to `.env`:

```dotenv
GROQ_API_KEY=gsk_...
GROQ_DAILY_LIMIT=200
GROQ_CACHE_TTL_HOURS=168
GROQ_EXCLUDE_DOMAINS=reddit.com
```

Use **Groq**, not xAI Grok. They are different products.

## Strict zero-cost mode

This release is intentionally configured for an initial free period:

1. Keep the GroqCloud account on its free plan and do not add a paid fallback provider.
2. The application is pinned to `groq/compound-mini` and hard-caps Groq usage at 200 requests per UTC day, even if a larger environment value is supplied.
3. Repeated category searches are cached in memory for seven days.
4. When Groq rejects a request or its quota is exhausted, the site returns the complete technical audit and labels observed visibility as **not measured**.
5. The API key is read only on the server. Never place it in `public/app.js` or any browser-visible file.

Free-plan limits and product pricing can change, so confirm the current values in [Groq's rate-limit documentation](https://console.groq.com/docs/rate-limits) before a public launch.

## Scoring model

### Technical AI-readiness score

This is a deterministic weighted score built only from fetched site evidence:

| Area | Weight | Examples of evidence |
|---|---:|---|
| Entity clarity | 30% | Organization schema, sameAs, description, About and Contact discovery |
| Answer readiness | 30% | FAQ, comparison content, proof points, quotable pages, native tables |
| Crawler extractability | 25% | AI crawler rules, sitemap, readable HTML, titles, canonicals |
| Trust and freshness | 15% | Authorship, dates, methodology, references, case evidence |

### Observed visibility snapshot

This is displayed separately. Groq performs one neutral, web-grounded category search without the audited brand in the search prompt. The application then inspects the returned raw sources for:

- the audited domain;
- third-party source snippets mentioning the brand;
- the best observed source position.

It is labeled **Groq grounded visibility snapshot**. It is not presented as a ChatGPT, Gemini, Perplexity, or Google AI Overview score.

## Source Explorer

Source Explorer accepts a buyer or research query, calls Groq Compound Mini with its web-search tool, and displays:

- the grounded answer;
- source titles and URLs;
- source domains;
- retrieved snippets;
- provider relevance scores when available;
- whether the result came from cache.

This replaces the Reddit-only workflow and makes the product useful across editorial sites, comparison pages, research sources, communities, and video results surfaced by the provider.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/status` | Provider, free-mode, cache, and local-quota status |
| `GET /api/audit?url=...` | Technical audit plus optional grounded visibility snapshot |
| `GET /api/sources?q=...` | Grounded source discovery for a buying query |

## Railway deployment

1. Deploy the repository from GitHub as a Node service.
2. Railway should run `npm install` and `npm start` automatically.
3. Add the four Groq variables shown above under **Variables**.
4. Keep `.env` out of Git. It is already ignored.
5. Deploy the review branch first, test it on a temporary Railway environment, and merge only after the output looks correct.

The cache and usage counter are currently in memory. That is deliberate for the free single-instance MVP. Before horizontal scaling, move both to a shared store so every instance respects the same quota and cache.

## Tests and CLI

```bash
npm test
npm run audit -- https://example.com reports/example
```

The test suite uses local fixtures and does not require a Groq key or consume provider quota.

## Honest limitations

- One grounded provider snapshot cannot represent every consumer AI product.
- Search results can vary by time, geography, and provider.
- JavaScript-only sites may expose less content to this lightweight HTML crawler.
- In-memory caching resets when the process restarts.
- A surfaced source is evidence of this provider's retrieval set, not proof that every LLM cites it.

<div align="center">

Built by Nakama Growth · MIT License

</div>
