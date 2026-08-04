const form = document.querySelector('#form');
const reportEl = document.querySelector('#report');
form.addEventListener('submit', async event => {
  event.preventDefault();
  reportEl.classList.remove('hidden');
  reportEl.innerHTML = '<h2>Running live crawl…</h2><p>This usually takes 10–30 seconds.</p>';
  const response = await fetch(`/api/audit?url=${encodeURIComponent(document.querySelector('#url').value)}`);
  const report = await response.json();
  reportEl.innerHTML = render(report);
});
function render(r){return `<h2>${r.businessName}</h2><div class="score">${r.score}/100</div><p>AI search visibility score</p><h3>Score breakdown</h3><div class="grid">${r.checks.map(c=>`<div class="tile"><strong>${c.name}</strong><div class="score">${c.score}</div><p>${c.why}</p></div>`).join('')}</div><h3>Evidence-backed findings</h3>${(r.findings.length?r.findings:[{severity:'Good',summary:'No major findings in selected checks',page:r.auditedUrl,evidence:'All selected signals passed.',recommendation:'Keep content current.'}]).map(f=>`<div class="tile"><p class="sev">${f.severity}</p><h4>${f.summary}</h4><p><strong>Page:</strong> <a href="${f.page}">${f.page}</a></p><p><strong>Proof:</strong> ${escapeHtml(f.evidence)}</p><p><strong>Fix:</strong> ${f.recommendation}</p></div>`).join('')}<h3>Prioritized fixes</h3>${r.fixes.map(f=>`<div class="tile"><h4>${f.rank}. ${f.title}</h4><p>${f.whyNow} Impact ${f.impact}/5, effort ${f.effort}/5.</p><pre>${escapeHtml(f.copyPaste)}</pre></div>`).join('')}<h3>Crawled pages</h3><ul>${r.pages.map(p=>`<li>${p.ok?'✅':'❌'} ${p.url} — ${p.title||p.error}</li>`).join('')}</ul>`}
function escapeHtml(s=''){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
