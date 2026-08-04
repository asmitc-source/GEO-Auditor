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
  const scoreDisplay = typeof r.score === 'number' ? r.score : 'N/A';
  return `<div class="verdict">
    <div class="score-block">
      <div class="score-number ${typeof r.score === 'number' ? '' : 'na'}">${scoreDisplay}${typeof r.score === 'number' ? '<span style="font-size:22px;color:var(--muted)">/100</span>' : ''}</div>
      <div class="score-label">AI search visibility</div>
    </div>
    <div style="flex-basis:100%;height:0;"></div>
    <div style="min-width:200px;">
      <p class="business-name">${escapeHtml(r.businessName)}</p>
      <p class="business-url">${escapeHtml(r.auditedUrl)}</p>
    </div>
    <div class="signals">
      ${r.checks.map(renderSignalRow).join('')}
    </div>
  </div>`;
}

function renderSignalRow(c) {
  const has = typeof c.score === 'number';
  const filled = has ? Math.round(c.score / 10) : 0;
  const segs = Array.from({ length: 10 }, (_, i) => `<span class="signal-seg ${i < filled ? 'signal-fill' : 'signal-fill na'}" style="width:${has ? 10 : 100 / 10}%;"></span>`).join('');
  return `<div class="signal-row">
    <span class="signal-name">${escapeHtml(c.name)} <span style="color:var(--muted)">(${c.weight}%)</span></span>
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
    <p style="color:var(--muted);font-size:13px;margin-top:-8px;">${escapeHtml(check.evidence.note || '')}</p>
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
    <div>
      <p class="fix-title">${escapeHtml(f.title)}</p>
      <p class="fix-why">${escapeHtml(f.whyNow)}</p>
      <p class="fix-meta">Impact ${f.impact}/5 · Effort ${f.effort}/5</p>
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

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s = '') {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
