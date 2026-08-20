import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVisibilitySources, discoverCitationSources, extractSearchSources } from '../src/groq.js';

test('extractSearchSources returns deduplicated, ranked, inspectable web results', () => {
  const message = {
    executed_tools: [{
      arguments: JSON.stringify({ query: 'best proposal software' }),
      search_results: {
        results: [
          { title: 'Second', url: 'https://example.org/two', content: 'B', score: 0.4 },
          { title: 'First', url: 'https://example.com/one', content: 'A', score: 0.9 },
          { title: 'Duplicate', url: 'https://example.com/one', content: 'A', score: 0.8 },
          { title: 'Unsafe', url: 'javascript:alert(1)', content: 'C', score: 1 }
        ]
      }
    }]
  };

  const sources = extractSearchSources(message);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].domain, 'example.com');
  assert.equal(sources[0].relevance, 0.9);
  assert.equal(sources[1].domain, 'example.org');
});

test('visibility analysis scores owned and independent brand evidence without using model prose', () => {
  const sources = [
    { title: 'Acme official guide', url: 'https://acme.com/guide', domain: 'acme.com', snippet: 'Official selection guide' },
    { title: 'Independent comparison', url: 'https://industry.example/best', domain: 'industry.example', snippet: 'Acme is one of several options reviewed.' }
  ];
  const result = analyzeVisibilitySources(sources, {
    businessName: 'Acme',
    domain: 'acme.com',
    queries: ['best widget platforms']
  });

  assert.equal(result.score, 100);
  assert.equal(result.metrics.ownedSourceCount, 1);
  assert.equal(result.metrics.thirdPartyMentionCount, 1);
  assert.equal(result.metrics.bestPosition, 1);
});

test('visibility analysis refuses a brand-contaminated search instead of inflating the score', () => {
  const result = analyzeVisibilitySources([
    { title: 'Acme', url: 'https://acme.com', domain: 'acme.com', snippet: 'Acme' }
  ], {
    businessName: 'Acme',
    domain: 'acme.com',
    queries: ['Acme reviews']
  });

  assert.equal(result.score, null);
  assert.equal(result.contaminated, true);
});

test('source discovery uses one web-only Groq request and caches the inspectable result', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  let calls = 0;
  process.env.GROQ_API_KEY = 'test-key';
  globalThis.fetch = async (url, options) => {
    calls += 1;
    const payload = JSON.parse(options.body);
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(payload.model, 'groq/compound-mini');
    assert.equal(payload.max_completion_tokens, 1000);
    assert.deepEqual(payload.compound_custom.tools.enabled_tools, ['web_search']);
    assert.deepEqual(payload.search_settings.exclude_domains, ['reddit.com']);
    return new Response(JSON.stringify({
      model: 'groq/compound-mini',
      choices: [{ message: {
        content: 'A grounded answer.',
        executed_tools: [{
          arguments: JSON.stringify({ query: 'unique fixture buying query 7319' }),
          search_results: { results: [{ title: 'Fixture', url: 'https://fixture.example/guide', content: 'Fixture source', score: 0.8 }] }
        }]
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const first = await discoverCitationSources('unique fixture buying query 7319');
    const second = await discoverCitationSources('unique fixture buying query 7319');
    assert.equal(first.skipped, false);
    assert.equal(first.sources[0].domain, 'fixture.example');
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});
