<div align="center">

# GEO Auditor

**Is your business visible to AI search?**

Enter a URL. Get a scored, evidenced report on whether ChatGPT, Perplexity, and Google AI Overviews can find, understand, and cite that business — plus a prioritized, copy-pasteable fix list.

![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)

</div>

---

## Quick start

```bash
git clone https://github.com/asmitc-source/GEO-Auditor.git
cd GEO-Auditor
npm install
cp .env.example .env
npm start
```

Open **http://localhost:3000**, paste in a URL, click **Run audit**. That's it — no API key required to get real results (see [why below](#what-is-real-vs-mocked)).

Want the live AI-citation check too? Open `.env` and add an OpenAI key:
```
OPENAI_API_KEY=sk-...
```

<details>
<summary><strong>Other ways to run it</strong> (CLI, batch reports, tests)</summary>

```bash
# Audit one URL from the command line, save json + markdown
npm run audit -- https://www.example.com reports/example

# Generate the 3-5 submission reports at once
# (edit the business list in scripts/run-sample-audits.js first)
npm run demo

# Run the test suite
npm test
```
</details>

---

## What it checks

| Check | Weight | What it actually measures |
|---|---|---|
| **AI engine citation probe** | 30% | Live call to a real AI model with buying-intent questions — does the business actually get mentioned? |
| **Answer citation readiness** | 25% | Does the site have FAQ / comparison / proof-point content AI engines can quote as an answer? |
| **Entity clarity** | 25% | Can an AI engine tell what real-world business this is (schema, meta description, About/Contact)? |
| **Crawler extractability** | 20% | Can AI bots actually fetch and parse the site (robots.txt, readable text, canonicals)? |

Every finding names the exact page, quotes the exact evidence found, and ships a copy-pasteable fix. The score is a plain weighted average — shown, not hidden.

---

## The reasoning behind those four checks

<details>
<summary><strong>Why these checks, and what I deliberately left out</strong> (click to expand)</summary>

GEO is ~2 years old and nobody agrees on a standard audit yet, so the real question wasn't "which checklist do I implement" — it was "what actually determines whether an AI engine mentions a business." Reading how AI answer engines work (retrieval over crawled content, weighted toward pages that directly answer a question, with entity recognition mattering a lot for whether a source is trusted enough to cite) and testing ChatGPT/Perplexity myself with buying-intent questions, three failure modes kept showing up before content quality was even relevant:

1. **The engine can't tell what the business *is*.** No structured entity data, vague homepage copy, no corroborating About/Contact pages.
2. **The engine can't cite what it can't fetch or parse.** JS-only content, blocked AI crawlers, near-empty extractable text.
3. **Even when the above are fine, the content isn't shaped like an answer.** AI engines quote pages that read like direct answers to a question — not marketing copy.

That's three of the four checks: **entity clarity**, **crawler extractability**, **answer citation readiness**. Each is a defensible proxy for AI visibility — every finding in `src/auditor.js` names the exact page and quotes the exact evidence.

**The fourth check is the one that matters most: a live AI citation probe.** The other three are proxies for "will an AI engine cite this business." Proxies can be wrong. So the tool also calls the OpenAI API directly with realistic buying questions and checks whether the business actually gets mentioned — real evidence, not a heuristic, and the ground truth the other three are trying to predict. Weighted heaviest (30%) for that reason.

**What I decided not to check:**
- **Backlink profile / domain authority** — classic Google SEO, not how AI engines select sources. Cut.
- **Page speed / Core Web Vitals** — affects Google ranking, not whether a crawler can extract text to cite. Cut.
- **Social media presence** — genuinely relevant (sameAs signals, brand mentions elsewhere) but scraping platforms reliably wasn't feasible in the time available. Cut, noted as a next step.
- **Exhaustive technical SEO** — generic SEO tools already do this well; it would pad the check count without adding AI-visibility-specific signal.

Four checks, not three — but the fourth isn't a heuristic like the other three, it's the actual outcome they're all trying to predict.

</details>

---

## What is real vs mocked

- [x] Live HTTP crawl of the homepage, robots.txt, sitemap, and sampled pages — fresh on every run
- [x] Every finding's evidence is quoted directly from the HTML fetched during that run
- [x] The AI citation probe is a real, live OpenAI API call (`gpt-4o-mini`) — question and answer shown verbatim in the report
- [x] Deterministic, visible scoring — every check shows its weight and score, math not hidden

**One honest caveat:** the AI citation probe calls the OpenAI API without a browsing/search tool attached. It reflects that model's trained knowledge of the business, not a live fetch of what ChatGPT-the-product or Perplexity would say today with browsing on. This is disclosed in the report itself, not just here. If `OPENAI_API_KEY` isn't set, this check is **skipped and excluded from the score** — never faked; you'll see "not run" instead of a number.

**A bug I found and fixed:** the earlier version of this crawler treated a failed network fetch as "this business has none of these signals" and produced a confident 0/100. That's a network error dressed up as findings. This version checks reachability first — if the homepage can't be fetched, the report says so plainly and shows **no score at all**, rather than a fake one. Covered by `test/auditor.test.js`.

---

## Real audit reports

Three live-run audits are in [`reports/`](./reports) — generated by running this exact tool against real sites, not templated.

*(Run `npm run demo` after editing the business list in `scripts/run-sample-audits.js` to regenerate these.)*

---

## What I'd build next with another week

1. **Multi-model probing** — run the citation probe against Claude and a search-augmented model too, and surface where a business is cited by some engines but not others.
2. **Competitor framing** — "who gets cited instead of you, and why," by diffing what shows up for the same prompts.
3. **Screenshot-based evidence** — headless-browser rendering for sites where key content is client-side only.
4. **Industry-specific prompt packs** — local services vs. B2B SaaS vs. ecommerce ask very different buying questions.
5. **Trend tracking** — store past runs, show whether visibility improves after fixes are applied.

---

## Demo video script (3–5 min)

1. Run `npm start`, enter a real business URL, let it run live on camera.
2. Point at the AI citation probe first — show the actual model answer, mentioned or not.
3. Open one finding, point to the exact page and exact evidence quoted.
4. Show the fix list, click Copy on one, note the impact/effort ranking is a real sort.
5. Flag the one caveat proactively: the AI probe reflects trained knowledge, not live browsing — and why that's still useful.

---

<div align="center">

Built by [Asmit](https://github.com/asmitc-source) · MIT License

</div>
