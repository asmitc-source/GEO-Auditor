// Live AI-engine citation probe.
//
// This is the one check that measures the actual thing the product cares
// about: does an AI engine mention this business when someone asks a real
// buying question? Everything else in this tool is a proxy signal for
// crawlability/citability. This is ground truth from a real model.
//
// Honesty note (also in README): this calls the OpenAI Chat Completions API
// with a plain model (no live web browsing/search tool attached). It reflects
// that model's training-time knowledge of the business, not a live fetch of
// what ChatGPT-the-product or Perplexity would say today with browsing on.
// We label this explicitly in the report so nobody mistakes it for a live
// scrape of ChatGPT's UI. If OPENAI_API_KEY is not set, this check is SKIPPED
// (not faked) and the report says so.

const MODEL = 'gpt-4o-mini';
const API_URL = 'https://api.openai.com/v1/chat/completions';

export async function probeAiCitation({ businessName, baseUrl, category }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      skipped: true,
      reason: 'OPENAI_API_KEY not set — AI citation probe skipped, not simulated.'
    };
  }

  const domain = safeHostname(baseUrl);
  const prompts = buildPrompts({ businessName, domain, category });
  const results = [];

  for (const prompt of prompts) {
    try {
      const answer = await callOpenAi(prompt.text, apiKey);
      const mentioned = mentionsBusiness(answer, businessName, domain);
      results.push({ id: prompt.id, question: prompt.text, answer, mentioned });
    } catch (error) {
      results.push({ id: prompt.id, question: prompt.text, answer: '', mentioned: false, error: error.message });
    }
  }

  return { skipped: false, model: MODEL, results };
}

function buildPrompts({ businessName, domain, category }) {
  const cat = category || 'this kind of business';
  return [
    { id: 'direct-recall', text: `What do you know about "${businessName}" (${domain})? Answer in 2-3 sentences based on what you actually know, and say if you're not familiar with it.` },
    { id: 'buying-intent', text: `I'm looking for a good ${cat}. What are a few options you'd recommend and why? Keep it to a short list.` },
    { id: 'comparison', text: `What's a strong, well-regarded choice for ${cat} that people in the industry recommend? Name specific companies if you can.` }
  ];
}

async function callOpenAi(userPrompt, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are a helpful assistant answering a user question directly and concisely. Do not mention that you lack real-time browsing.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 220
      })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI API returned ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

function mentionsBusiness(answer, businessName, domain) {
  if (!answer) return false;
  const lower = answer.toLowerCase();
  const nameCore = (businessName || '').toLowerCase().split(/[.\s]/)[0];
  const domainCore = (domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
  return Boolean((nameCore && nameCore.length > 2 && lower.includes(nameCore)) ||
    (domainCore && domainCore.length > 2 && lower.includes(domainCore)));
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
