/* ---------------- Theme ---------------- */

const themeToggle = document.querySelector('#themeToggle');
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('geo-auditor-theme', next);
});

/* ---------------- Tabs ---------------- */

const tabAudit = document.querySelector('#tab-audit');
const tabSources = document.querySelector('#tab-sources');
const panelAudit = document.querySelector('#panel-audit');
const panelSources = document.querySelector('#panel-sources');

function setTab(which) {
  const auditActive = which === 'audit';
  tabAudit.classList.toggle('active', auditActive);
  tabSources.classList.toggle('active', !auditActive);
  tabAudit.setAttribute('aria-selected', String(auditActive));
  tabSources.setAttribute('aria-selected', String(!auditActive));
  panelAudit.classList.toggle('hidden', !auditActive);
  panelSources.classList.toggle('hidden', auditActive);
}

tabAudit.addEventListener('click', () => setTab('audit'));
tabSources.addEventListener('click', () => setTab('sources'));

/* ---------------- Deployment status ---------------- */

(async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    setStat('statAi', status.groq?.enabled ? 'on' : 'off');
    setStat('statFree', status.strictFreeMode ? 'on' : 'partial');
    const statusLine = document.querySelector('#statusLine');
    if (status.groq) {
      statusLine.title = status.groq.enabled
        ? `Groq ${status.groq.model}: ${status.groq.remainingToday}/${status.groq.dailyLimit} locally allowed calls remain today; ${status.groq.cacheTtlHours}h cache.`
        : 'Technical crawl is live. Add GROQ_API_KEY on Railway to enable the free grounded snapshot and source explorer.';
    }
  } catch {
    // The audit remains usable even if the small status request fails.
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
  reportEl.innerHTML = `<p class="loading">Crawling discovered pages and checking grounded visibility when available<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>`;

  try {
    const response = await fetch(`/api/audit?url=${encodeURIComponent(urlInput.value.trim())}`);
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || `Audit failed (${response.status})`);
    reportEl.innerHTML = renderAudit(report);
    wireCopyButtons();
  } catch (error) {
    reportEl.innerHTML = renderError('Audit could not complete', error.message);
  } finally {
    submitBtn.disabled = false;
  }
});

function renderAudit(report) {
  if (report.status === 'failed') return renderFailed(report);
  return `
    ${renderReadiness(report)}
    ${renderVisibility(report.visibility)}
    ${renderWarnings(report)}
    <h2 class="section-title">Evidence-backed findings</h2>
    ${renderFindings(report)}
    <h2 class="section-title">Prioritized implementation list</h2>
    ${renderFixes(report)}
    <h2 class="section-title">Pages actually crawled</h2>
    ${renderPages(report)}
  `;
}

function renderFailed(report) {
  return `<div class="failed-box">
    <h2>Audit could not run for ${escapeHtml(report.businessName)}</h2>
    <p>No score is shown because a number built on a failed fetch would not be evidence.</p>
    <ul>${(report.warnings || []).map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
  </div>`;
}

function renderReadiness(report) {
  const score = typeof report.readinessScore === 'number' ? report.readinessScore : report.score;
  return `<div class="score-kicker">Technical score · crawl evidence only</div>
  <div class="verdict">
    <div class="score-block">
      ${scoreRing(score)}
      <div>
        <p class="business-name">${escapeHtml(report.businessName)}</p>
        <p class="business-url">${escapeHtml(report.auditedUrl)}</p>
        <p class="score-label">AI-readiness score — not an observed citation score</p>
      </div>
    </div>
    <div class="signals">
      ${(report.checks || []).map(renderSignalRow).join('')}
    </div>
  </div>`;
}

function scoreRing(score, small = false) {
  const hasScore = typeof score === 'number';
  const radius = small ? 31 : 38;
  const size = small ? 76 : 92;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((hasScore ? score : 0) / 100) * circumference;
  return `<div class="score-ring ${small ? 'small' : ''}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="score-ring-track" cx="${center}" cy="${center}" r="${radius}"></circle>
      <circle class="score-ring-fill" cx="${center}" cy="${center}" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${hasScore ? offset : circumference}"></circle>
    </svg>
    <div class="score-ring-num">${hasScore ? score : 'N/A'}</div>
  </div>`;
}

function renderSignalRow(check) {
  const filled = Math.round(check.score / 10);
  const segments = Array.from({ length: 10 }, (_, index) => `<span class="signal-seg ${index < filled ? 'signal-fill' : 'signal-fill na'}"></span>`).join('');
  return `<div class="signal-row">
    <span class="signal-name">${escapeHtml(check.name)} <span class="signal-weight">(${check.weight}%)</span></span>
    <span class="signal-track">${segments}</span>
    <span class="signal-score">${check.score}</span>
  </div>`;
}

function renderVisibility(visibility) {
  if (!visibility || visibility.skipped) {
    return `<section class="visibility-card unavailable">
      <div>
        <p class="card-eyebrow">Observed visibility · not measured</p>
        <h2>Technical audit complete; grounded snapshot unavailable</h2>
        <p>${escapeHtml(visibility?.reason || 'No grounded provider response was available.')}</p>
      </div>
    </section>`;
  }

  const metrics = visibility.metrics || {};
  const cacheNote = visibility.cached ? `Cached ${formatAge(visibility.cacheAgeSeconds)}` : `Measured ${formatDate(visibility.measuredAt)}`;
  return `<section class="visibility-card">
    <div class="visibility-head">
      ${scoreRing(visibility.score, true)}
      <div>
        <p class="card-eyebrow">Observed visibility · ${escapeHtml(visibility.provider)} grounded snapshot</p>
        <h2>${escapeHtml(visibility.category || 'Neutral category search')}</h2>
        <p>${escapeHtml(cacheNote)} · ${escapeHtml(visibility.model || '')}</p>
      </div>
    </div>
    <div class="metric-row">
      ${metric('Sources inspected', metrics.sourceCount ?? visibility.sources?.length ?? 0)}
      ${metric('Owned sources', metrics.ownedSourceCount ?? 0)}
      ${metric('Third-party mentions', metrics.thirdPartyMentionCount ?? 0)}
      ${metric('Best source position', metrics.bestPosition || '—')}
    </div>
    <div class="grounded-answer">
      <span class="proof-label">Grounded answer</span>
      <p>${formatAnswer(visibility.answer || 'No answer returned.')}</p>
    </div>
    ${renderSourceCards(visibility.sources || [], true)}
    <p class="method-note">${escapeHtml(visibility.note || '')}</p>
  </section>`;
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderWarnings(report) {
  if (!report.warnings?.length) return '';
  return `<div class="warnings"><strong>Notes on this run</strong><ul>${report.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>`;
}

function renderFindings(report) {
  if (!report.findings?.length) return '<p class="empty-state">No major findings in the sampled checks.</p>';
  return report.findings.map(item => `<article class="finding">
    <div class="finding-head">
      <div class="finding-labels"><span class="sev-chip ${item.severity.toLowerCase()}">${escapeHtml(item.severity)}</span>${item.check ? `<span class="area-chip">${escapeHtml(item.check)}</span>` : ''}</div>
      <p class="finding-summary">${escapeHtml(item.summary)}</p>
      ${item.page ? `<p class="finding-page">Page: <a href="${safeHref(item.page)}" target="_blank" rel="noopener">${escapeHtml(item.page)}</a></p>` : ''}
    </div>
    <div class="proof"><span class="proof-label">Evidence</span>${escapeHtml(String(item.evidence))}</div>
    <div class="finding-fix"><strong>Recommendation:</strong> ${escapeHtml(item.recommendation)}</div>
  </article>`).join('');
}

function renderFixes(report) {
  if (!report.fixes?.length) return '<p class="empty-state">No fixes required by these checks.</p>';
  return report.fixes.map(fix => `<article class="fix">
    <div class="fix-rank">${fix.rank}</div>
    <div class="fix-body">
      <p class="fix-title">${escapeHtml(fix.title)}</p>
      <p class="fix-why">${escapeHtml(fix.whyNow)}</p>
      <p class="fix-meta">IMPACT ${fix.impact}/5 · EFFORT ${fix.effort}/5</p>
      <div class="fix-copy-wrap">
        <button class="copy-btn" data-copy="${escapeAttr(fix.copyPaste)}">Copy brief</button>
        <pre class="fix-copy">${escapeHtml(fix.copyPaste)}</pre>
      </div>
    </div>
  </article>`).join('');
}

function renderPages(report) {
  return `<div class="table-wrap"><table class="pages-table"><thead><tr><th>Status</th><th>Discovered URL</th><th>Evidence</th></tr></thead><tbody>${(report.pages || []).map(page => `<tr>
    <td class="${page.ok ? 'ok' : 'fail'}">${page.ok ? 'OK' : 'FAIL'}</td>
    <td>${escapeHtml(page.url)}</td>
    <td>${escapeHtml(page.title || page.error || '')}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function wireCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = original; }, 1200);
      } catch {
        button.textContent = 'Copy failed';
      }
    });
  });
}

/* ==================================================================
   GROUNDED SOURCE EXPLORER
   ================================================================== */

const sourceForm = document.querySelector('#sourceForm');
const sourceQuery = document.querySelector('#sourceQuery');
const sourceResults = document.querySelector('#sourceResults');
const sourceSubmit = sourceForm.querySelector('button');

sourceForm.addEventListener('submit', async event => {
  event.preventDefault();
  sourceResults.classList.remove('hidden');
  sourceSubmit.disabled = true;
  sourceResults.innerHTML = `<p class="loading">Searching the live web and collecting the grounded source set<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>`;

  try {
    const response = await fetch(`/api/sources?q=${encodeURIComponent(sourceQuery.value.trim())}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Source search failed (${response.status})`);
    sourceResults.innerHTML = renderSourceSearch(data);
  } catch (error) {
    sourceResults.innerHTML = renderError('Source search could not complete', error.message);
  } finally {
    sourceSubmit.disabled = false;
  }
});

function renderSourceSearch(data) {
  if (data.skipped) {
    const missingKey = data.code === 'not_configured';
    const title = missingKey ? 'Source Explorer is not enabled yet' : 'Source search could not complete';
    const nextStep = missingKey
      ? 'Add <code>GROQ_API_KEY</code> as a Railway variable. Keep the Groq account on its free plan.'
      : 'Try a more specific query. The technical website audit remains available, and no result is being invented.';
    return `<div class="source-skip"><strong>${title}</strong><p>${escapeHtml(data.reason)}</p><p>${nextStep}</p></div>`;
  }
  const cacheNote = data.cached ? `Cached ${formatAge(data.cacheAgeSeconds)}` : `Searched ${formatDate(data.measuredAt)}`;
  return `<section class="source-summary">
    <div class="result-meta"><span class="live-chip">Groq grounded web</span><span>${escapeHtml(cacheNote)}</span><span>${data.sources?.length || 0} inspectable sources</span></div>
    <h2>Answer generated from the retrieved source set</h2>
    <div class="source-answer">${formatAnswer(data.answer || 'No answer returned.')}</div>
  </section>
  <h2 class="section-title">Sources used by the grounded search</h2>
  ${renderSourceCards(data.sources || [], false)}`;
}

function renderSourceCards(sources, compact) {
  if (!sources.length) return '<p class="empty-state">No inspectable source records were returned, so nothing is being implied.</p>';
  return `<div class="source-grid ${compact ? 'compact' : ''}">${sources.map((source, index) => `<article class="source-card">
    <div class="source-index">${index + 1}</div>
    <div class="source-content">
      <div class="source-domain">${escapeHtml(source.domain || '')}${typeof source.relevance === 'number' ? `<span>${Math.round(source.relevance * 100)}% relevance</span>` : ''}</div>
      <a href="${safeHref(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title || source.url)}</a>
      ${source.snippet ? `<p>${escapeHtml(source.snippet)}</p>` : ''}
    </div>
  </article>`).join('')}</div>`;
}

function renderError(title, message) {
  return `<div class="failed-box"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
}

/* ---------------- Shared helpers ---------------- */

function formatAnswer(value) {
  return escapeHtml(value).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
}

function formatDate(value) {
  if (!value) return 'just now';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatAge(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return 'less than a minute ago';
  if (value < 3600) return `${Math.round(value / 60)} minutes ago`;
  if (value < 86400) return `${Math.round(value / 3600)} hours ago`;
  return `${Math.round(value / 86400)} days ago`;
}

function safeHref(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? escapeAttr(url.href) : '#';
  } catch {
    return '#';
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}

function escapeAttr(value = '') {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
