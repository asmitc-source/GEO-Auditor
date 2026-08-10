/* ---------------- Theme toggle ---------------- */

const themeToggle = document.querySelector('#themeToggle');
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('geo-auditor-theme', next);
});

/* ---------------- Tabs ---------------- */

const tabAudit = document.querySelector('#tab-audit');
const tabReddit = document.querySelector('#tab-reddit');
const panelAudit = document.querySelector('#panel-audit');
const panelReddit = document.querySelector('#panel-reddit');

function setTab(which) {
  const auditActive = which === 'audit';
  tabAudit.classList.toggle('active', auditActive);
  tabReddit.classList.toggle('active', !auditActive);
  tabAudit.setAttribute('aria-selected', String(auditActive));
  tabReddit.setAttribute('aria-selected', String(!auditActive));
  panelAudit.classList.toggle('hidden', !auditActive);
  panelReddit.classList.toggle('hidden', auditActive);
}

tabAudit.addEventListener('click', () => setTab('audit'));
tabReddit.addEventListener('click', () => setTab('reddit'));

/* ---------------- Status line ---------------- */

(async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    setStat('statAi', status.openai ? 'on' : 'off');
    setStat('statReddit', status.reddit ? 'on' : (status.redditPublicFallback ? 'partial' : 'off'));
  } catch {
    // Non-fatal — status line just stays in its default "off" state.
  }
})();

function setStat(id, state) {
  const dot = document.querySelector(`#${id} .status-dot`);
  if (!dot) return;
  dot.classList.remove('on', 'off', 'partial');
  dot.classList.add(state);
}

/* ==================================================================
   WEBSITE AUDIT
   ================================================================== */

const form = document.querySelector('#form');
const urlInput = document.querySelector('#url');
const reportEl = document.querySelector('#report');
const submitBtn = form.querySelector('button');

form.addEventListener('submit', async event => {
  event.preventDefault();
  reportEl.classList.remove('hidden');
  submitBtn.disabled = true;
  reportEl.innerHTML = `<p class="loading">Crawling site, checking robots.txt, asking an AI model real questions<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>`;

  try {
    const response = await fetch(`/api/audit?url=${encodeURIComponent(urlInput.value.trim())}`);
    const report = await response.json();
    reportEl.innerHTML = render(report);
    wireCopyButtons();
  } catch (error) {
    reportEl.innerHTML = `<div class="failed-box"><h2>Something went wrong</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    submitBtn.disabled = false;
  }
});

function render(r) {
  if (r.status === 'failed') return renderFailed(r);
  return `
    ${renderVerdict(r)}
    ${renderWarnings(r)}
    ${renderAiProbe(r)}
    <h2 class="section-title">Evidence-backed findings</h2>
    ${renderFindings(r)}
    <h2 class="section-title">Monday-morning fix list</h2>
    ${renderFixes(r)}
    <h2 class="section-title">Crawled pages</h2>
    ${renderPages(r)}
  `;
}

function renderFailed(r) {
  return `<div class="failed-box">
    <h2>Audit could not run for ${escapeHtml(r.businessName)}</h2>
    <p>No score is shown — a number built on a failed fetch would be worse than no number.</p>
    <ul>${r.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
  </div>`;
}

function renderVerdict(r) {
  const hasScore = typeof r.score === 'number';
  const score = hasScore ? r.score : 0;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return `<div class="verdict">
    <div class="score-block">
      <div class="score-ring">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle class="score-ring-track" cx="46" cy="46" r="${radius}"></circle>
          <circle class="score-ring-fill" cx="46" cy="46" r="${radius}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${hasScore ? offset : circumference}"></circle>
        </svg>
        <div class="score-ring-num">${hasScore ? score : 'N/A'}</div>
      </div>
      <div>
        <p class="business-name" style="margin-bottom:6px;">${escapeHtml(r.businessName)}</p>
        <p class="business-url">${escapeHtml(r.auditedUrl)}</p>
        <p class="score-label" style="margin-top:8px;">AI search visibility${hasScore ? ' — /100' : ''}</p>
      </div>
    </div>
    <div class="signals">
      ${r.checks.map(renderSignalRow).join('')}
    </div>
  </div>`;
}

function renderSignalRow(c) {
  const has = typeof c.score === 'number';
  const filled = has ? Math.round(c.score / 10) : 0;
  const segs = Array.from({ length: 10 }, (_, i) => `<span class="signal-seg ${i < filled ? 'signal-fill' : 'signal-fill na'}"></span>`).join('');
  return `<div class="signal-row">
    <span class="signal-name">${escapeHtml(c.name)} <span style="color:var(--muted-2);font-weight:400;">(${c.weight}%)</span></span>
    <span class="signal-track">${segs}</span>
    <span class="signal-score">${has ? c.score : '—'}</span>
  </div>`;
}

function renderWarnings(r) {
  if (!r.warnings?.length) return '';
  return `<div class="warnings"><strong>Notes on this run</strong><ul>${r.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
}

function renderAiProbe(r) {
  const check = r.checks.find(c => c.id === 'ai-citation');
  if (!check || !check.evidence?.results) return '';
  return `<h2 class="section-title">AI engine citation probe (live)</h2>
    <p style="color:var(--muted);font-size:13px;margin-top:-10px;margin-bottom:16px;">${escapeHtml(check.evidence.note || '')}</p>
    ${check.evidence.results.map(res => `<div class="probe">
      <p class="probe-q">Q: ${escapeHtml(res.question)}</p>
      <p class="probe-a">${escapeHtml(res.answer || res.error || 'No response.')}</p>
      <span class="probe-tag ${res.mentioned ? 'yes' : 'no'}">${res.mentioned ? 'Mentioned' : 'Not mentioned'}</span>
    </div>`).join('')}`;
}

function renderFindings(r) {
  const findings = r.findings.filter(f => f.id !== 'ai-probe-not-run');
  if (!findings.length) return '<p style="color:var(--muted)">No major findings in the selected checks.</p>';
  return findings.map(f => `<div class="finding">
    <div class="finding-head">
      <span class="sev-chip ${f.severity.toLowerCase()}">${escapeHtml(f.severity)}</span>
      <p class="finding-summary">${escapeHtml(f.summary)}</p>
      ${f.page ? `<p class="finding-page">Page: <a href="${escapeAttr(f.page)}" target="_blank" rel="noopener">${escapeHtml(f.page)}</a></p>` : ''}
    </div>
    <div class="proof"><span class="proof-label">Proof</span>${escapeHtml(String(f.evidence))}</div>
    <div class="finding-fix"><strong>Fix:</strong> ${escapeHtml(f.recommendation)}</div>
  </div>`).join('');
}

function renderFixes(r) {
  if (!r.fixes.length) return '<p style="color:var(--muted)">No fixes required by these checks.</p>';
  return r.fixes.map(f => `<div class="fix">
    <div class="fix-rank">${f.rank}</div>
    <div style="flex:1;min-width:0;">
      <p class="fix-title">${escapeHtml(f.title)}</p>
      <p class="fix-why">${escapeHtml(f.whyNow)}</p>
      <p class="fix-meta">IMPACT ${f.impact}/5 · EFFORT ${f.effort}/5</p>
      <div class="fix-copy-wrap">
        <button class="copy-btn" data-copy="${escapeAttr(f.copyPaste)}">Copy</button>
        <pre class="fix-copy">${escapeHtml(f.copyPaste)}</pre>
      </div>
    </div>
  </div>`).join('');
}

function renderPages(r) {
  return `<table class="pages-table">${r.pages.map(p => `<tr>
    <td class="${p.ok ? 'ok' : 'fail'}">${p.ok ? 'OK' : 'FAIL'}</td>
    <td>${escapeHtml(p.url)}</td>
    <td>${escapeHtml(p.title || p.error || '')}</td>
  </tr>`).join('')}</table>`;
}

function wireCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  });
}

/* ==================================================================
   REDDIT DISCOVERY
   ================================================================== */

const redditForm = document.querySelector('#redditForm');
const redditQuery = document.querySelector('#redditQuery');
const redditResultsEl = document.querySelector('#redditResults');
const redditSubmitBtn = redditForm.querySelector('button');

redditForm.addEventListener('submit', async event => {
  event.preventDefault();
  redditResultsEl.classList.remove('hidden');
  redditSubmitBtn.disabled = true;
  redditResultsEl.innerHTML = `<p class="loading">Searching Reddit's public API for real threads<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>`;

  try {
    const response = await fetch(`/api/reddit-search?q=${encodeURIComponent(redditQuery.value.trim())}`);
    const data = await response.json();
    redditResultsEl.innerHTML = renderReddit(data);
    wireDraftButtons();
  } catch (error) {
    redditResultsEl.innerHTML = `<div class="failed-box"><h2>Something went wrong</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    redditSubmitBtn.disabled = false;
  }
});

function renderReddit(data) {
  if (data.skipped) {
    return `<div class="reddit-skip">
      <strong style="display:block;margin-bottom:8px;color:var(--ink);">Reddit Discovery isn't wired up yet</strong>
      ${escapeHtml(data.reason)}<br><br>
      Add <code>REDDIT_CLIENT_ID</code> and <code>REDDIT_CLIENT_SECRET</code> to your <code>.env</code> file
      (register a free "script" app at <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener">reddit.com/prefs/apps</a>) and restart the server.
    </div>`;
  }
  if (data.error) {
    return `<div class="failed-box"><h2>Reddit search failed</h2><p>${escapeHtml(data.error)}</p></div>`;
  }
  if (!data.results?.length) {
    return `<p style="color:var(--muted)">No threads found for "${escapeHtml(data.query || '')}". Try a broader phrase.</p>`;
  }
  const note = data.authenticated === false
    ? `<div class="reddit-note">Running on Reddit's public search endpoint (no API keys set yet) — works, but rate-limited harder than the authenticated API. Add <code>REDDIT_CLIENT_ID</code> / <code>REDDIT_CLIENT_SECRET</code> once you have them for reliable use.</div>`
    : '';
  return `${note}<p style="color:var(--muted);font-size:13.5px;margin:0 0 16px;">${data.results.length} real thread${data.results.length === 1 ? '' : 's'} for "<strong style="color:var(--ink)">${escapeHtml(data.query)}</strong>" — sorted by citation potential (recency + real discussion, not just upvotes).</p>
    ${data.results.map(renderRedditCard).join('')}`;
}

function renderRedditCard(t) {
  const tier = t.citationPotential >= 25 ? 'high' : t.citationPotential >= 10 ? 'medium' : 'low';
  const tierLabel = tier === 'high' ? 'High potential' : tier === 'medium' ? 'Medium potential' : 'Low potential';
  const age = t.createdUtc ? timeAgo(t.createdUtc) : 'unknown age';
  return `<div class="reddit-card">
    <div class="reddit-card-top">
      <span class="subreddit-chip">${escapeHtml(t.subreddit)}</span>
      <span class="potential-chip ${tier}">${tierLabel}</span>
      <span class="reddit-meta">${t.score} upvotes · ${t.numComments} comments · ${age}</span>
    </div>
    <a class="reddit-title" href="${escapeAttr(t.permalink)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
    ${t.snippet ? `<p class="reddit-snippet">${escapeHtml(t.snippet)}${t.snippet.length >= 240 ? '…' : ''}</p>` : ''}
    <div class="reddit-actions">
      <a class="ghost-btn" href="${escapeAttr(t.permalink)}" target="_blank" rel="noopener">Open thread ↗</a>
      <button class="ghost-btn draft-toggle" data-title="${escapeAttr(t.title)}" data-subreddit="${escapeAttr(t.subreddit)}">Draft a reply</button>
    </div>
    <div class="draft-box hidden"></div>
  </div>`;
}

function wireDraftButtons() {
  document.querySelectorAll('.draft-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.reddit-card').querySelector('.draft-box');
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      const template = `Genuinely relevant starting point for r/... — mention where you have real, first-hand experience with "${btn.dataset.title}", link back to something concrete if it's actually useful, and say who you are. Reddit's community norms (and its API terms) require that this goes out from your own account, written by you — this tool finds the thread, it doesn't post for you.`;
      box.innerHTML = `<textarea readonly>${escapeHtml(template)}</textarea>
        <p class="draft-note">This is a starting template, not an auto-generated final reply — edit it, make it genuinely yours, and post it from your own Reddit account.</p>`;
      box.classList.remove('hidden');
    });
  });
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.floor(months / 12)} yr ago`;
}

/* ---------------- Shared helpers ---------------- */

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s = '') {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
