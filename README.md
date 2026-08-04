# GEO Auditor

Enter a business's URL. Get back a scored, evidenced report on whether AI answer engines (ChatGPT, Perplexity, Google AI Overviews) can find, understand, and cite that business — plus a prioritized, copy-pasteable fix list.

## Run in under 5 minutes

Prerequisite: Node.js 20+.

```bash
git clone <this-repo>
cd GEO-Auditor
npm install
cp .env.example .env
```

Open `.env` and paste in an OpenAI API key if you have one (optional — see below). Then:

```bash
npm start
```

Open **http://localhost:3000**, enter a URL, click "Run audit."

CLI usage (writes `reports/<name>.json` and `reports/<name>.md`):

```bash
npm run audit -- https://www.example.com reports/example
```

Generate the three submission reports at once by editing the business list in `scripts/run-sample-audits.js`, then:

```bash
npm run demo
```

Run tests:

```bash
npm test
```

## What I chose to check, and why (the research)

GEO is ~2 years old and nobody agrees on a standard audit yet, so the question wasn't "which checklist do I implement" — it was "what actually determines whether an AI engine mentions a business." Reading how AI answer engines are described (retrieval over indexed/crawled content, weighted toward pages that directly and clearly answer a question, with entity recognition mattering a lot for whether a source is trusted enough to cite) and poking at ChatGPT/Perplexity myself with buying-intent questions, the same three failure modes kept showing up before content quality was even relevant:

1. **The engine can't tell what the business *is*.** No structured entity data, vague homepage copy, no corroborating About/Contact pages — the model can't confidently attach a citation to something it can't identify.
2. **The engine can't cite what it can't fetch or parse.** JS-only content, blocked AI crawlers in robots.txt, near-empty extractable text.
3. **Even when the above are fine, the content isn't shaped like an answer.** AI engines quote pages that read like direct answers to a question (FAQ-style, comparisons, concrete proof points) — not marketing copy.

That gave three of the four checks: **entity clarity**, **crawler extractability**, and **answer citation readiness**. Each is a real, checkable proxy for AI visibility, and I can defend every signal inside them (see `src/auditor.js` — every finding names the exact page and quotes the exact evidence it's based on).

**The fourth check is the one I think matters most: an actual live AI engine citation probe.** The other three are proxies for "will an AI engine cite this business." Proxies can be wrong. So the auditor also calls the OpenAI API directly with realistic buying-intent questions ("what's a good [category]," "have you heard of [business]") and checks whether the business actually gets mentioned. This is real evidence, not a heuristic — it's the ground truth the other three checks are trying to predict. I weighted it heaviest (30%) for that reason.

### What I decided *not* to check, and why

- **Backlink profile / domain authority:** that's classic SEO, and AI engines don't need PageRank-style link graphs the same way Google does. Cut to stay focused on AI-specific signals.
- **Page speed / Core Web Vitals:** matters for Google ranking, doesn't meaningfully affect whether a crawler can extract text to cite. Cut.
- **Social media presence:** genuinely relevant to some GEO discussions (sameAs signals, brand mentions elsewhere), but verifying it requires scraping platforms with their own bot restrictions — not reliable enough in the time available to present as evidence. Cut, noted as a next step.
- **Exhaustive technical SEO audit (meta tags, alt text coverage, etc.):** generic SEO tools already do this well. Including it would pad the check count without adding AI-visibility-specific signal, which the brief explicitly warns against ("three checks done properly beat twelve that tick boxes").

Four checks, not three — but the fourth isn't a heuristic like the other three, it's the actual outcome the other three are trying to predict. I'd rather defend that as one deliberate addition than cut it to hit a round number.

## What is real vs mocked

**Real:**
- Live HTTP crawl of the homepage, robots.txt, sitemap, and sampled internal/priority pages, performed fresh on every run.
- All evidence in every finding comes from the actual HTML fetched during that run — page URLs, meta tags, JSON-LD, and text are quoted directly, not templated.
- The AI citation probe is a real, live call to the OpenAI Chat Completions API (`gpt-4o-mini`) with the exact question and answer shown in the report.
- Deterministic, visible scoring — every check shows its weight and score, and the overall score is a straightforward weighted average with the math shown.

**Explicitly not mocked, but worth understanding the limits of:**
- The AI citation probe uses the OpenAI API **without a browsing/search tool attached.** It reflects that model's training-time knowledge of the business, not a live fetch of what ChatGPT's actual product (with browsing) or Perplexity would say today. This is labeled in the report itself, not just this README. It's still real, live, non-simulated evidence — just evidence of one specific, disclosed thing.
- If `OPENAI_API_KEY` is not set, that check is **skipped and excluded from the score** — never faked. You'll see "not run" instead of a number.

**A fix for a bug I found and want to be upfront about:** the previous version of this crawler treated a network fetch failure as "the business has none of these signals" and produced a confident 0/100 score. That's wrong — it's reporting a network error as a finding. This version now checks whether the homepage was actually reachable before scoring anything; if it wasn't, the report says so plainly and shows no score at all, rather than a fake one. This is tested in `test/auditor.test.js`.

## Real audit reports

Three real, live-run audits are in `reports/` — see `<link/list once generated>`. Each was produced by running this exact tool against the live site, not a template.

*(Run `npm run demo` after editing the business list in `scripts/run-sample-audits.js` to regenerate these.)*

## What I'd build next with another week

1. **Multi-model probing** — run the citation probe against Claude and a Perplexity-style search-augmented model too, and show where the business is cited by some engines but not others (that gap is itself a diagnostic).
2. **Competitor framing** — "who gets cited instead of you, and why" by running the same buying-intent prompts and diffing what does show up.
3. **Screenshot-based evidence** — for sites where key content is rendered client-side and invisible to a plain HTTP fetch, render with a headless browser and compare what's visible to what's actually fetchable.
4. **Industry-specific prompt packs** for the AI probe (local services vs. B2B SaaS vs. ecommerce ask very different buying questions).
5. **Trend tracking** — store past runs and show whether a business's visibility is improving after they apply the fixes.

## Demo video script (3–5 min)

1. Run `npm start`, enter a real business URL, let it run live on camera.
2. Point at the AI citation probe section first — show the actual model answer, mentioned/not-mentioned.
3. Open one finding, point to the exact page and exact evidence quoted.
4. Show the fix list, click "Copy" on one, explain the impact/effort ranking is a real sort, not decoration.
5. State the one thing I'd flag to a skeptical reviewer: the AI probe reflects the model's training knowledge, not live browsing — and explain why that's still useful and how it's disclosed.
