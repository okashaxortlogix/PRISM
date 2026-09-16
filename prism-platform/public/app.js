// PRISM Frontend Application Controller
const ORDERED_LIFECYCLE = [
  'DRAFT', 'SCOPING', 'INGESTING', 'EVIDENCE_COLLECTION',
  'HYPOTHESIS_GENERATION', 'HYPOTHESIS_TESTING', 'VERIFICATION',
  'ROOT_CAUSE_REVIEW', 'IMPACT_ASSESSMENT', 'RECOMMENDATION', 'COMPLETED'
];

let activeInvestigationId = null;
let currentInvestigation = null;
let allInvestigations = [];

let currentUser = null;
let currentOrg = null;

function getToken() {
  return localStorage.getItem('prism_session_token');
}

function setToken(token) {
  localStorage.setItem('prism_session_token', token);
}

function clearToken() {
  localStorage.removeItem('prism_session_token');
  currentUser = null;
  currentOrg = null;
}

function showAuthModal() {
  const modal = document.getElementById('modal-auth');
  if (modal) modal.classList.add('open');
}

function hideAuthModal() {
  const modal = document.getElementById('modal-auth');
  if (modal) modal.classList.remove('open');
}

function updateUserContext(authData) {
  currentUser = authData.user;
  currentOrg = authData.organization;

  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const avatarEl = document.getElementById('user-avatar');
  const tenantEl = document.getElementById('current-tenant-badge');

  if (nameEl) nameEl.textContent = authData.user.display_name;
  if (roleEl) roleEl.textContent = authData.role;
  if (avatarEl) {
    const initials = authData.user.display_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatarEl.textContent = initials || 'PR';
  }
  if (tenantEl) tenantEl.textContent = authData.organization.name;
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  setupAuthEventListeners();
});

async function initApp() {
  const token = getToken();
  if (!token) {
    showAuthModal();
    return;
  }

  try {
    const res = await fetchAPI('/api/v1/auth/me');
    updateUserContext(res.data);
    hideAuthModal();
    await loadProjects();
    await loadInvestigations();
  } catch (err) {
    console.warn('Authentication check failed:', err.message);
    clearToken();
    showAuthModal();
  }
}

// ----------------------------------------------------
// API Utilities
// ----------------------------------------------------
async function fetchAPI(url, options = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    const data = await res.json();
    if (res.status === 401) {
      clearToken();
      showAuthModal();
      throw new Error(data.error?.message || 'Session expired. Please sign in again.');
    }

    if (!res.ok) {
      throw new Error(data.error?.message || 'API request failed');
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `prism-toast show ${type}`;
  setTimeout(() => {
    toast.className = 'prism-toast';
  }, 4000);
}

// ----------------------------------------------------
// Authentication Handlers
// ----------------------------------------------------
async function handleLoginSubmit() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    alert('Please enter email and password.');
    return;
  }

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || 'Login failed.');
    }

    setToken(data.data.token);
    updateUserContext(data.data);
    hideAuthModal();
    showToast(`Signed in as ${data.data.user.display_name} (${data.data.organization.name})`, 'success');
    await loadProjects();
    await loadInvestigations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegisterSubmit() {
  const display_name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!display_name || !email || !password) {
    alert('Please fill all registration fields.');
    return;
  }

  try {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || 'Registration failed.');
    }

    setToken(data.data.token);
    updateUserContext(data.data);
    hideAuthModal();
    showToast(`Account created! Welcome, ${data.data.user.display_name}`, 'success');
    await loadProjects();
    await loadInvestigations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function quickLogin(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  await handleLoginSubmit();
}

async function handleLogout() {
  try {
    await fetchAPI('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Ignore error on logout
  }
  clearToken();
  showToast('Signed out of PRISM workspace.', 'info');
  showAuthModal();
}

function setupAuthEventListeners() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const modalTitle = document.getElementById('auth-modal-title');

  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'block';
      formRegister.style.display = 'none';
      modalTitle.textContent = 'Sign In to PRISM';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'block';
      formLogin.style.display = 'none';
      modalTitle.textContent = 'Register New PRISM Account';
    });
  }

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', (e) => {
      e.stopPropagation();
      handleLogout();
    });
  }
}

// ----------------------------------------------------
// Data Loading
// ----------------------------------------------------
async function loadProjects() {
  try {
    const res = await fetchAPI('/api/v1/projects');
    const select = document.getElementById('project-selector');
    select.innerHTML = '';
    res.data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load projects', err);
  }
}

async function loadInvestigations() {
  try {
    const res = await fetchAPI('/api/v1/investigations');
    allInvestigations = res.data;
    renderInvestigationsSidebar(allInvestigations);

    if (allInvestigations.length > 0) {
      if (!activeInvestigationId || !allInvestigations.some(i => i.id === activeInvestigationId)) {
        selectInvestigation(allInvestigations[0].id);
      } else {
        selectInvestigation(activeInvestigationId);
      }
    }
  } catch (err) {
    console.error('Failed to load investigations', err);
  }
}

async function selectInvestigation(id) {
  activeInvestigationId = id;
  renderInvestigationsSidebar(allInvestigations);

  try {
    const res = await fetchAPI(`/api/v1/investigations/${id}`);
    currentInvestigation = res.data;
    renderInvestigationWorkspace(currentInvestigation);
  } catch (err) {
    console.error('Failed to fetch full investigation details', err);
  }
}

// ----------------------------------------------------
// Rendering Functions
// ----------------------------------------------------
function renderInvestigationsSidebar(list) {
  const container = document.getElementById('investigations-list');
  const countEl = document.getElementById('investigations-count');
  countEl.textContent = `${list.length} Active`;
  container.innerHTML = '';

  list.forEach(inv => {
    const card = document.createElement('div');
    card.className = `inv-nav-card ${inv.id === activeInvestigationId ? 'active' : ''}`;
    card.onclick = () => selectInvestigation(inv.id);

    const sevClass = inv.severity === 'SEV1' ? 'badge-sev1' : (inv.severity === 'SEV2' ? 'badge-sev2' : 'badge-sev3');

    card.innerHTML = `
      <div class="inv-card-header">
        <span class="badge ${sevClass}">${inv.severity}</span>
        <span class="mono-tag">${inv.id}</span>
      </div>
      <div class="inv-card-title">${escapeHTML(inv.title)}</div>
      <div class="inv-card-meta">
        <span class="badge badge-subtle">${inv.status}</span>
        <span>${new Date(inv.started_at).toLocaleDateString()}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderInvestigationWorkspace(inv) {
  document.getElementById('active-inv-id').textContent = inv.id;
  document.getElementById('active-inv-title').textContent = inv.title;
  document.getElementById('active-inv-problem').textContent = inv.problem_statement;
  
  const sevEl = document.getElementById('active-inv-sev');
  sevEl.textContent = inv.severity;
  sevEl.className = `badge ${inv.severity === 'SEV1' ? 'badge-sev1' : (inv.severity === 'SEV2' ? 'badge-sev2' : 'badge-sev3')}`;

  const statusEl = document.getElementById('active-inv-status');
  statusEl.textContent = inv.status;

  // Counter badges
  document.getElementById('badge-evidence-count').textContent = inv.evidence ? inv.evidence.length : 0;
  document.getElementById('badge-hypotheses-count').textContent = inv.hypotheses ? inv.hypotheses.length : 0;
  document.getElementById('badge-verification-count').textContent = inv.verifications ? inv.verifications.length : 0;

  // Render Stepper
  renderStepper(inv.status);

  // Render Sub-panes
  renderEvidencePane(inv.evidence || []);
  renderHypothesesPane(inv.hypotheses || []);
  renderVerificationPane(inv.experiments || [], inv.verifications || []);
  renderRootCausePane(inv.rootCauses || [], inv.impact);
  renderRecommendationsPane(inv.recommendations || []);

  // Update FinOps cost indicators
  updateInvestigationCost(inv.id);
}

function renderStepper(currentStatus) {
  const track = document.getElementById('lifecycle-stepper');
  track.innerHTML = '';

  const currentIndex = ORDERED_LIFECYCLE.indexOf(currentStatus);

  ORDERED_LIFECYCLE.forEach((step, idx) => {
    const node = document.createElement('div');
    node.className = 'step-node';
    if (idx < currentIndex) {
      node.classList.add('completed');
    } else if (idx === currentIndex) {
      node.classList.add('active');
    }

    node.innerHTML = `
      <span>${idx + 1}. ${step.replace(/_/g, ' ')}</span>
    `;
    track.appendChild(node);

    if (idx < ORDERED_LIFECYCLE.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'step-arrow';
      arrow.textContent = '→';
      track.appendChild(arrow);
    }
  });
}

function renderEvidencePane(evidenceList) {
  const grid = document.getElementById('evidence-grid');
  grid.innerHTML = '';

  if (evidenceList.length === 0) {
    grid.innerHTML = '<div class="subtext" style="grid-column: 1/-1; padding: 20px;">No evidence items recorded yet. Click "Ingest Evidence" to collect logs, code diffs, or metrics.</div>';
    return;
  }

  evidenceList.forEach(e => {
    const card = document.createElement('div');
    card.className = 'evidence-card';
    card.innerHTML = `
      <div class="evidence-header">
        <span class="badge badge-status">${e.type}</span>
        <span class="subtext">Reliability: ${(e.reliability * 100).toFixed(0)}%</span>
      </div>
      <div class="evidence-title">${escapeHTML(e.title)}</div>
      <div class="evidence-code-box">${escapeHTML(e.content)}</div>
      <div class="evidence-footer">
        <span>Source: <code>${escapeHTML(e.source)}</code></span>
        <button class="hash-verify-btn" onclick="verifyHash('${e.id}')">
          Verify SHA-256
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderHypothesesPane(hypothesesList) {
  const container = document.getElementById('hypotheses-list');
  container.innerHTML = '';

  if (hypothesesList.length === 0) {
    container.innerHTML = '<div class="subtext" style="padding: 20px;">No hypotheses proposed yet. Click "Propose Hypothesis" to add competing theories.</div>';
    return;
  }

  hypothesesList.forEach(h => {
    const card = document.createElement('div');
    const isVerified = h.status === 'VERIFIED';
    const isRejected = h.status === 'REJECTED';
    card.className = `hypothesis-card ${isVerified ? 'verified' : (isRejected ? 'rejected' : '')}`;

    const supporting = JSON.parse(h.supporting_evidence_ids || '[]');
    const conflicting = JSON.parse(h.conflicting_evidence_ids || '[]');
    const pct = Math.round((h.confidence || 0) * 100);
    const meterClass = pct >= 70 ? 'meter-high' : (pct >= 40 ? 'meter-med' : 'meter-low');

    card.innerHTML = `
      <div class="hypothesis-top-bar">
        <div class="confidence-bar-container">
          <span class="subtext">Confidence: <strong>${pct}%</strong></span>
          <div class="meter-track">
            <div class="meter-fill ${meterClass}" style="width: ${pct}%;"></div>
          </div>
          <span class="badge ${isVerified ? 'badge-success' : (isRejected ? 'badge-sev1' : 'badge-subtle')}">${h.status}</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="reEvaluateHypothesis('${h.id}')">
          Calibrate
        </button>
      </div>
      <div class="hypothesis-statement">${escapeHTML(h.statement)}</div>
      <div class="hypothesis-rationale">${escapeHTML(h.rationale)}</div>
      <div class="evidence-tags-row">
        ${supporting.map(id => `<span class="chip-support">✔ Supported by ${id}</span>`).join('')}
        ${conflicting.map(id => `<span class="chip-conflict">✖ Contradicted by ${id}</span>`).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

function renderVerificationPane(experiments, verifications) {
  const expContainer = document.getElementById('experiments-list');
  expContainer.innerHTML = '';

  if (experiments.length === 0) {
    expContainer.innerHTML = '<div class="subtext" style="padding: 10px;">No experiments defined yet.</div>';
  } else {
    experiments.forEach(exp => {
      const card = document.createElement('div');
      card.className = 'experiment-card';
      const isCompleted = exp.status === 'COMPLETED';
      card.innerHTML = `
        <div class="inv-card-header">
          <span class="mono-tag">${exp.id}</span>
          <span class="badge ${isCompleted ? 'badge-success' : 'badge-subtle'}">${exp.status}</span>
        </div>
        <div style="font-size: 0.88rem; font-weight: 500;">${escapeHTML(exp.plan)}</div>
        <div class="subtext">Target: ${escapeHTML(exp.hypothesis_statement || 'Linked Hypothesis')}</div>
        <div style="margin-top: 6px; display: flex; gap: 8px;">
          ${!isCompleted ? `<button class="btn btn-accent btn-sm" onclick="runExperiment('${exp.id}')">Execute Sandbox Run</button>` : `<span class="mono-tag">Run: ${exp.result_ref || 'Sandbox OK'}</span>`}
          <button class="btn btn-secondary btn-sm" onclick="openVerificationModal('${exp.id}')">Record Formal Verification</button>
        </div>
      `;
      expContainer.appendChild(card);
    });
  }

  const verContainer = document.getElementById('verifications-list');
  verContainer.innerHTML = '';

  if (verifications.length === 0) {
    verContainer.innerHTML = '<div class="subtext" style="padding: 10px;">No verification outcomes recorded yet.</div>';
  } else {
    verifications.forEach(v => {
      const card = document.createElement('div');
      card.className = 'verification-card';
      const outcomeBadge = v.outcome === 'VERIFIED' ? 'badge-success' : (v.outcome === 'REJECTED' ? 'badge-sev1' : 'badge-sev2');
      card.innerHTML = `
        <div class="inv-card-header">
          <span class="badge ${outcomeBadge}">${v.outcome}</span>
          <span class="subtext">${new Date(v.performed_at).toLocaleString()}</span>
        </div>
        <div style="font-size: 0.88rem; font-weight: 600;">Claim: ${escapeHTML(v.claim)}</div>
        <div class="subtext">Method: ${escapeHTML(v.method)}</div>
        <div class="evidence-code-box" style="margin-top: 6px; font-size: 0.74rem;">${escapeHTML(v.actual_result)}</div>
        ${v.limitations ? `<div class="subtext" style="color: #fbbf24;">Limitations: ${escapeHTML(v.limitations)}</div>` : ''}
      `;
      verContainer.appendChild(card);
    });
  }
}

function renderRootCausePane(rootCauses, impact) {
  const rcBox = document.getElementById('root-cause-content');
  const rcConfidence = document.getElementById('rc-confidence-badge');
  const rcVerRef = document.getElementById('rc-ver-ref');

  if (rootCauses.length > 0) {
    const primary = rootCauses[0];
    rcBox.textContent = primary.statement;
    rcConfidence.textContent = `${(primary.confidence * 100).toFixed(0)}% Confidence`;
    rcVerRef.textContent = `Verified by: ${primary.verification_ref}`;
  } else {
    rcBox.innerHTML = '<em>No definitive root cause established yet. Complete a verification experiment and click "Establish Root Cause".</em>';
    rcConfidence.textContent = 'Pending Verification';
    rcVerRef.textContent = '';
  }

  const impactBox = document.getElementById('impact-content');
  const blastBadge = document.getElementById('blast-radius-badge');

  if (impact) {
    blastBadge.textContent = `${impact.blast_radius_level} BLAST RADIUS`;
    blastBadge.className = `badge ${impact.blast_radius_level === 'CRITICAL' || impact.blast_radius_level === 'HIGH' ? 'badge-sev1' : 'badge-sev2'}`;

    const components = JSON.parse(impact.affected_components || '[]');
    impactBox.innerHTML = `
      <div><strong>Affected Components:</strong></div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${components.map(c => `<span class="badge badge-subtle">📦 ${escapeHTML(c)}</span>`).join('')}
      </div>
      <div style="margin-top: 8px;"><strong>User Impact:</strong> ${escapeHTML(impact.user_impact)}</div>
      <div style="margin-top: 4px;"><strong>Data Integrity:</strong> ${escapeHTML(impact.data_integrity_impact)}</div>
      ${impact.financial_cost_estimate ? `<div style="margin-top: 4px; color: #f87171;"><strong>Cost Estimate:</strong> ${escapeHTML(impact.financial_cost_estimate)}</div>` : ''}
    `;
  } else {
    blastBadge.textContent = 'UNASSESSED';
    impactBox.innerHTML = '<em>Blast radius and downstream component impact have not been calculated yet.</em>';
  }
}

function renderRecommendationsPane(recommendations) {
  const container = document.getElementById('recommendations-list');
  container.innerHTML = '';

  if (recommendations.length === 0) {
    container.innerHTML = '<div class="subtext" style="padding: 20px;">No recommendations filed yet. Click "Add Recommendation" to formulate preventative actions.</div>';
    return;
  }

  recommendations.forEach(r => {
    const card = document.createElement('div');
    card.className = 'rec-card';
    const priBadge = r.priority === 'P0' ? 'badge-sev1' : (r.priority === 'P1' ? 'badge-sev2' : 'badge-status');

    card.innerHTML = `
      <div class="rec-top-row">
        <span class="badge ${priBadge}">${r.priority} ACTION</span>
        <span class="subtext">Risk: <strong>${escapeHTML(r.risk)}</strong></span>
      </div>
      <div class="rec-action">${escapeHTML(r.action)}</div>
      <div class="rec-grid-cols">
        <div><strong>Rationale:</strong> ${escapeHTML(r.rationale)}</div>
        <div><strong>Trade-offs:</strong> ${escapeHTML(r.tradeoffs)}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ----------------------------------------------------
// Actions & Handlers
// ----------------------------------------------------
window.verifyHash = async function(evidenceId) {
  try {
    const res = await fetchAPI(`/api/v1/evidence/${evidenceId}/verify-integrity`);
    if (res.data.valid) {
      showToast(`✔ Cryptographic Integrity Verified! SHA-256: ${res.data.computedHash.substring(0, 16)}...`, 'success');
    } else {
      showToast(`✖ Tamper Detected! Stored hash does not match computed content hash!`, 'error');
    }
  } catch (err) {
    console.error(err);
  }
};

window.reEvaluateHypothesis = async function(hypId) {
  try {
    const res = await fetchAPI(`/api/v1/hypotheses/${hypId}/evaluate`, { method: 'POST' });
    showToast(`Hypothesis calibrated! New confidence: ${(res.data.confidence * 100).toFixed(0)}% (${res.data.status})`);
    selectInvestigation(activeInvestigationId);
  } catch (err) {
    console.error(err);
  }
};

window.runExperiment = async function(expId) {
  try {
    showToast('Initializing staging sandbox and executing test run...');
    const res = await fetchAPI(`/api/v1/experiments/${expId}/run`, { method: 'POST' });
    showToast('✔ Experiment sandbox run finished successfully!', 'success');
    selectInvestigation(activeInvestigationId);
  } catch (err) {
    console.error(err);
  }
};

function setupEventListeners() {
  // Tabs navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Modals close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.prism-modal-backdrop').forEach(m => m.classList.remove('open'));
    });
  });

  // Export dropdown
  const exportBtn = document.getElementById('btn-export-menu');
  const exportDropdown = document.querySelector('.export-dropdown');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    exportDropdown.classList.remove('open');
  });

  document.getElementById('export-markdown').addEventListener('click', (e) => {
    e.preventDefault();
    if (activeInvestigationId) {
      window.location.href = `/api/v1/investigations/${activeInvestigationId}/report?format=markdown`;
    }
  });

  document.getElementById('export-json').addEventListener('click', (e) => {
    e.preventDefault();
    if (activeInvestigationId) {
      window.location.href = `/api/v1/investigations/${activeInvestigationId}/report?format=json`;
    }
  });

  document.getElementById('export-html').addEventListener('click', (e) => {
    e.preventDefault();
    if (activeInvestigationId) {
      window.open(`/api/v1/investigations/${activeInvestigationId}/report?format=html`, '_blank');
    }
  });

  // New Investigation Modal
  document.getElementById('btn-new-investigation').addEventListener('click', () => {
    document.getElementById('modal-new-inv').classList.add('open');
  });

  document.getElementById('btn-submit-new-inv').addEventListener('click', async () => {
    const title = document.getElementById('new-inv-title').value.trim();
    const problem = document.getElementById('new-inv-problem').value.trim();
    const severity = document.getElementById('new-inv-severity').value;
    const scopeVal = document.getElementById('new-inv-scope').value.trim();

    if (!title || !problem) {
      alert('Please fill in title and problem statement');
      return;
    }

    try {
      const res = await fetchAPI('/api/v1/investigations', {
        method: 'POST',
        body: JSON.stringify({
          title,
          problem_statement: problem,
          severity,
          scope: { components: scopeVal.split(',').map(s => s.trim()).filter(Boolean) }
        })
      });

      document.getElementById('modal-new-inv').classList.remove('open');
      showToast('Investigation created successfully!', 'success');
      await loadInvestigations();
      selectInvestigation(res.data.id);
    } catch (err) {
      console.error(err);
    }
  });

  // State Transition Modal
  document.getElementById('btn-advance-state').addEventListener('click', () => {
    if (!currentInvestigation) return;
    const select = document.getElementById('modal-target-state');
    select.innerHTML = '';
    const currentIndex = ORDERED_LIFECYCLE.indexOf(currentInvestigation.status);

    if (currentIndex >= 0 && currentIndex < ORDERED_LIFECYCLE.length - 1) {
      const nextStep = ORDERED_LIFECYCLE[currentIndex + 1];
      const opt = document.createElement('option');
      opt.value = nextStep;
      opt.textContent = `Advance to: ${nextStep}`;
      select.appendChild(opt);
    }

    // Add side states
    ['NEEDS_MORE_EVIDENCE', 'BLOCKED', 'CANCELLED'].forEach(s => {
      if (s !== currentInvestigation.status) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = `Side State: ${s}`;
        select.appendChild(opt);
      }
    });

    document.getElementById('modal-transition').classList.add('open');
  });

  document.getElementById('btn-submit-transition').addEventListener('click', async () => {
    const targetState = document.getElementById('modal-target-state').value;
    try {
      await fetchAPI(`/api/v1/investigations/${activeInvestigationId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ targetState })
      });

      document.getElementById('modal-transition').classList.remove('open');
      showToast(`Investigation advanced to state: ${targetState}`, 'success');
      selectInvestigation(activeInvestigationId);
    } catch (err) {
      // Show guard error
      const warnBox = document.getElementById('transition-guard-warning');
      warnBox.textContent = err.message;
      warnBox.style.display = 'block';
    }
  });

  // Add Evidence Modal
  document.getElementById('btn-add-evidence').addEventListener('click', () => {
    document.getElementById('modal-add-evidence').classList.add('open');
  });

  document.getElementById('btn-submit-evidence').addEventListener('click', async () => {
    const type = document.getElementById('evi-type').value;
    const title = document.getElementById('evi-title').value.trim();
    const source = document.getElementById('evi-source').value.trim();
    const sourceRef = document.getElementById('evi-source-ref').value.trim();
    const content = document.getElementById('evi-content').value.trim();

    if (!title || !source || !sourceRef || !content) {
      alert('Please fill in all evidence fields.');
      return;
    }

    try {
      await fetchAPI(`/api/v1/investigations/${activeInvestigationId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          title,
          source,
          source_ref: sourceRef,
          content
        })
      });

      document.getElementById('modal-add-evidence').classList.remove('open');
      showToast('Evidence hashed and ingested into vault!', 'success');
      selectInvestigation(activeInvestigationId);
    } catch (err) {
      console.error(err);
    }
  });

  // Evidence Gap Analysis
  document.getElementById('btn-check-gaps').addEventListener('click', async () => {
    try {
      const res = await fetchAPI(`/api/v1/investigations/${activeInvestigationId}/evidence/gaps`);
      const banner = document.getElementById('evidence-gaps-alert');
      if (res.data.missingGaps.length === 0) {
        banner.style.display = 'block';
        banner.innerHTML = '<strong>✔ Evidence Coverage 100%:</strong> All critical runtime, code diff, and test evidence categories are present!';
      } else {
        banner.style.display = 'block';
        banner.innerHTML = `<strong>⚠️ Evidence Gaps Detected (${res.data.missingGaps.length}):</strong><br>` +
          res.data.missingGaps.map(g => `&bull; <strong>${g.category}</strong>: ${g.recommendation}`).join('<br>');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Add Hypothesis Modal
  document.getElementById('btn-add-hypothesis').addEventListener('click', () => {
    if (!currentInvestigation) return;
    const supList = document.getElementById('hyp-supporting-select-list');
    const conList = document.getElementById('hyp-conflicting-select-list');
    supList.innerHTML = '';
    conList.innerHTML = '';

    (currentInvestigation.evidence || []).forEach(e => {
      supList.innerHTML += `
        <label class="checkbox-item">
          <input type="checkbox" name="hyp-sup" value="${e.id}">
          <span>[${e.type}] ${escapeHTML(e.title)}</span>
        </label>
      `;
      conList.innerHTML += `
        <label class="checkbox-item">
          <input type="checkbox" name="hyp-con" value="${e.id}">
          <span>[${e.type}] ${escapeHTML(e.title)}</span>
        </label>
      `;
    });

    document.getElementById('modal-add-hypothesis').classList.add('open');
  });

  document.getElementById('btn-submit-hypothesis').addEventListener('click', async () => {
    const statement = document.getElementById('hyp-statement').value.trim();
    const rationale = document.getElementById('hyp-rationale').value.trim();

    const supporting = Array.from(document.querySelectorAll('input[name="hyp-sup"]:checked')).map(i => i.value);
    const conflicting = Array.from(document.querySelectorAll('input[name="hyp-con"]:checked')).map(i => i.value);

    if (!statement || !rationale) {
      alert('Please fill in statement and rationale.');
      return;
    }

    try {
      await fetchAPI(`/api/v1/investigations/${activeInvestigationId}/hypotheses`, {
        method: 'POST',
        body: JSON.stringify({
          statement,
          rationale,
          supporting_evidence_ids: supporting,
          conflicting_evidence_ids: conflicting
        })
      });

      document.getElementById('modal-add-hypothesis').classList.remove('open');
      showToast('Hypothesis registered and calibrated!', 'success');
      selectInvestigation(activeInvestigationId);
    } catch (err) {
      console.error(err);
    }
  });

  // Establish Root Cause Modal
  document.getElementById('btn-record-root-cause').addEventListener('click', () => {
    if (!currentInvestigation) return;
    const select = document.getElementById('rc-ver-select');
    select.innerHTML = '';

    const verifiedItems = (currentInvestigation.verifications || []).filter(v => v.outcome === 'VERIFIED');
    if (verifiedItems.length === 0) {
      alert('Cannot establish root cause yet: No experiments with outcome "VERIFIED" exist. Please complete and verify an experiment first.');
      return;
    }

    verifiedItems.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.id} - ${v.claim}`;
      select.appendChild(opt);
    });

    document.getElementById('modal-record-rootcause').classList.add('open');
  });

  document.getElementById('btn-submit-rootcause').addEventListener('click', async () => {
    const statement = document.getElementById('rc-statement-input').value.trim();
    const verRef = document.getElementById('rc-ver-select').value;

    if (!statement || !verRef) {
      alert('Please enter a root cause statement and select a verified experiment.');
      return;
    }

    try {
      await fetchAPI(`/api/v1/investigations/${activeInvestigationId}/root-cause`, {
        method: 'POST',
        body: JSON.stringify({
          statement,
          verification_ref: verRef,
          confidence: 0.96
        })
      });

      document.getElementById('modal-record-rootcause').classList.remove('open');
      showToast('✔ Verified Root Cause formally established!', 'success');
      selectInvestigation(activeInvestigationId);
    } catch (err) {
      console.error(err);
    }
  });

  // Memory Search Modal
  document.getElementById('btn-memory-search').addEventListener('click', async () => {
    document.getElementById('modal-memory-bank').classList.add('open');
    loadMemories();
  });

  document.getElementById('btn-do-memory-search').addEventListener('click', () => {
    const q = document.getElementById('memory-search-input').value.trim();
    loadMemories(q);
  });

  async function loadMemories(q = '') {
    try {
      const res = await fetchAPI(`/api/v1/memories?q=${encodeURIComponent(q)}`);
      const container = document.getElementById('memory-results-list');
      container.innerHTML = '';

      if (res.data.length === 0) {
        container.innerHTML = '<div class="subtext" style="padding: 10px;">No matching historical incident memories found.</div>';
        return;
      }

      res.data.forEach(mem => {
        const item = document.createElement('div');
        item.className = 'evidence-card';
        const tags = JSON.parse(mem.tags || '[]');
        item.innerHTML = `
          <div class="evidence-header">
            <span class="mono-tag">${mem.id}</span>
            <span class="badge badge-success">Freshness: ${(mem.freshness * 100).toFixed(0)}%</span>
          </div>
          <div style="font-weight: 700; font-size: 0.95rem;">${escapeHTML(mem.title)}</div>
          <div style="font-size: 0.84rem; color: #cbd5e1;">${escapeHTML(mem.summary)}</div>
          <div class="evidence-code-box" style="margin-top: 6px;">
            <strong>Root Cause:</strong> ${escapeHTML(mem.root_cause)}<br>
            <strong>Resolution:</strong> ${escapeHTML(mem.resolution)}
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
            ${tags.map(t => `<span class="badge badge-subtle">#${escapeHTML(t)}</span>`).join('')}
          </div>
        `;
        container.appendChild(item);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Audit Trail Modal
  document.getElementById('btn-audit-log').addEventListener('click', async () => {
    document.getElementById('modal-audit-trail').classList.add('open');
    try {
      const res = await fetchAPI('/api/v1/audit?limit=30');
      const container = document.getElementById('audit-trail-list');
      container.innerHTML = '';

      res.data.forEach(aud => {
        const row = document.createElement('div');
        row.className = 'inv-card-meta';
        row.style.cssText = 'padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between;';
        row.innerHTML = `
          <div>
            <span class="badge badge-status">${aud.event_type}</span>
            <span class="mono-tag" style="margin-left: 8px;">Target: ${aud.target_type} (${aud.target_id})</span>
            <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 4px;">Actor: ${aud.actor_id} | Meta: ${aud.metadata}</div>
          </div>
          <span class="subtext">${new Date(aud.created_at).toLocaleTimeString()}</span>
        `;
        container.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  });

  // Code Intelligence Tab Handlers
  const btnRefreshCodeIntel = document.getElementById('btn-refresh-codeintel');
  if (btnRefreshCodeIntel) {
    btnRefreshCodeIntel.addEventListener('click', loadCodeIntelData);
  }

  const btnTriggerIngest = document.getElementById('btn-trigger-ingest');
  if (btnTriggerIngest) {
    btnTriggerIngest.addEventListener('click', async () => {
      try {
        const repoSelector = document.getElementById('project-selector');
        const projId = repoSelector ? repoSelector.value : 'prj_checkout';
        showToast('Enqueuing repository ingestion background worker job...');
        await fetchAPI(`/api/v1/projects/${projId}/repositories/ingest-job`, {
          method: 'POST',
          body: JSON.stringify({ branch: 'main' })
        }).catch(() => {
          // Fallback direct endpoint
          return fetchAPI(`/api/v1/repositories/repo_checkout_core/ingest`, { method: 'POST' });
        });
        showToast('✔ Repository ingestion initiated successfully!', 'success');
        loadCodeIntelData();
        loadBackgroundJobs();
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Background Jobs Tab Handlers
  const btnRefreshJobs = document.getElementById('btn-refresh-jobs');
  if (btnRefreshJobs) {
    btnRefreshJobs.addEventListener('click', loadBackgroundJobs);
  }

  // FinOps Modal Handlers
  const btnFinopsModal = document.getElementById('btn-finops-modal');
  if (btnFinopsModal) {
    btnFinopsModal.addEventListener('click', () => {
      document.getElementById('modal-finops').classList.add('open');
      loadFinopsSummary();
    });
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----------------------------------------------------
// Code Intelligence & AST Handlers
// ----------------------------------------------------
async function loadCodeIntelData() {
  try {
    const filesContainer = document.getElementById('repo-files-list');
    const symbolsContainer = document.getElementById('repo-symbols-list');
    const badgeSymbols = document.getElementById('badge-symbols-count');

    // Fetch repositories
    const repoRes = await fetchAPI('/api/v1/repositories').catch(() => ({ data: [] }));
    const repos = repoRes.data || [];
    const activeRepo = repos[0] || { id: 'repo_checkout_core', name: 'checkout-service' };

    // Fetch repository files
    const filesRes = await fetchAPI(`/api/v1/repositories/${activeRepo.id}/files`).catch(() => ({ data: [] }));
    const files = filesRes.data || [];

    if (filesContainer) {
      filesContainer.innerHTML = '';
      if (files.length === 0) {
        filesContainer.innerHTML = '<div class="subtext" style="padding: 12px;">No indexed files found. Click "Ingest Repository" to scan the tree.</div>';
      } else {
        files.forEach(f => {
          const card = document.createElement('div');
          card.className = 'experiment-card';
          card.style.cursor = 'pointer';
          card.onclick = () => loadSymbolsForFile(activeRepo.id, f.path);
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 600; color: #38bdf8;">📄 ${escapeHTML(f.path)}</span>
              <span class="badge badge-subtle">${f.language || 'code'}</span>
            </div>
            <div class="evidence-footer" style="padding-top: 4px; margin-top: 4px;">
              <span class="subtext">SHA: ${escapeHTML((f.content_hash || f.sha || 'e3b0c442').substring(0, 12))}...</span>
              <span class="subtext">${f.byte_size || f.size || 0} bytes</span>
            </div>
          `;
          filesContainer.appendChild(card);
        });
      }
    }

    // Fetch AST symbols
    const symbolsRes = await fetchAPI(`/api/v1/repositories/${activeRepo.id}/symbols`).catch(() => ({ data: [] }));
    const symbols = symbolsRes.data || [];
    if (badgeSymbols) badgeSymbols.textContent = symbols.length;

    if (symbolsContainer) {
      renderSymbolsList(symbols);
    }
  } catch (err) {
    console.error('Error loading Code Intel:', err);
  }
}

async function loadSymbolsForFile(repoId, filePath) {
  try {
    const symbolsRes = await fetchAPI(`/api/v1/repositories/${repoId}/symbols?file=${encodeURIComponent(filePath)}`).catch(() => ({ data: [] }));
    renderSymbolsList(symbolsRes.data || []);
  } catch (err) {
    console.error('Error loading file symbols:', err);
  }
}

function renderSymbolsList(symbols) {
  const container = document.getElementById('repo-symbols-list');
  if (!container) return;
  container.innerHTML = '';

  if (symbols.length === 0) {
    container.innerHTML = '<div class="subtext" style="padding: 12px;">No AST symbols extracted yet.</div>';
    return;
  }

  symbols.forEach(sym => {
    const card = document.createElement('div');
    card.className = 'verification-card';
    const kindBadge = sym.kind === 'CLASS' ? 'badge-sev2' : (sym.kind === 'FUNCTION' ? 'badge-status' : 'badge-subtle');
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-family: var(--font-mono); font-weight: 700; color: #e2e8f0;">${escapeHTML(sym.name)}</span>
        <span class="badge ${kindBadge}">${escapeHTML(sym.kind || 'SYMBOL')}</span>
      </div>
      <div class="subtext" style="font-family: var(--font-mono); font-size: 0.74rem;">
        ${escapeHTML(sym.file_path || 'unknown')}:${sym.line_start || 1}-${sym.line_end || 1}
      </div>
      ${sym.docstring ? `<div style="font-size: 0.78rem; color: #94a3b8;">${escapeHTML(sym.docstring)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// ----------------------------------------------------
// Background Job Queue Handlers
// ----------------------------------------------------
async function loadBackgroundJobs() {
  try {
    const res = await fetchAPI('/api/v1/jobs').catch(() => ({ data: [] }));
    const jobs = res.data || [];
    const badgeJobs = document.getElementById('badge-jobs-count');
    const container = document.getElementById('jobs-list');

    if (badgeJobs) badgeJobs.textContent = jobs.length;
    if (!container) return;
    container.innerHTML = '';

    if (jobs.length === 0) {
      container.innerHTML = '<div class="subtext" style="padding: 16px;">No background jobs queued or executing.</div>';
      return;
    }

    jobs.forEach(j => {
      const card = document.createElement('div');
      card.className = 'hypothesis-card';
      const statusBadge = j.status === 'SUCCEEDED' ? 'badge-success' : (j.status === 'FAILED' ? 'badge-sev1' : (j.status === 'RUNNING' ? 'badge-status' : 'badge-subtle'));
      card.innerHTML = `
        <div class="hypothesis-top-bar">
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="mono-tag">${j.id}</span>
            <span class="badge ${statusBadge}">${j.status}</span>
            <span class="badge badge-subtle">PRIORITY: ${j.priority_score || j.priority || 'NORMAL'}</span>
          </div>
          <div>
            ${(j.status === 'QUEUED' || j.status === 'RUNNING') ? `<button class="btn btn-secondary btn-sm" onclick="cancelJob('${j.id}')">Cancel Job</button>` : ''}
          </div>
        </div>
        <div style="font-size: 0.88rem; font-weight: 600;">Type: ${escapeHTML(j.type || j.job_type || 'INVESTIGATION_RUN')}</div>
        <div class="evidence-code-box" style="font-size: 0.74rem;">Payload: ${escapeHTML(typeof j.payload === 'object' ? JSON.stringify(j.payload) : (j.payload || '{}'))}</div>
        <div class="evidence-footer">
          <span>Worker Lease: ${escapeHTML(j.worker_id || 'unassigned')}</span>
          <span>Updated: ${new Date(j.updated_at || j.created_at).toLocaleTimeString()}</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading background jobs:', err);
  }
}

window.cancelJob = async function(jobId) {
  try {
    await fetchAPI(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
    showToast(`✔ Job ${jobId} cancelled successfully!`, 'info');
    loadBackgroundJobs();
  } catch (err) {
    console.error(err);
  }
};

// ----------------------------------------------------
// FinOps Real-Time Cost Handlers
// ----------------------------------------------------
async function updateInvestigationCost(invId) {
  if (!invId) return;
  try {
    const res = await fetchAPI(`/api/v1/investigations/${invId}/cost`).catch(() => ({ data: { totalCostUsd: 0 } }));
    const cost = res.data?.totalCostUsd || 0;
    const headerCost = document.getElementById('finops-header-cost');
    if (headerCost) {
      headerCost.textContent = `$${cost.toFixed(4)}`;
    }
  } catch {
    // Non-blocking
  }
}

async function loadFinopsSummary() {
  try {
    const invId = activeInvestigationId;
    let invCost = 0;
    let invRecords = [];

    if (invId) {
      const invRes = await fetchAPI(`/api/v1/investigations/${invId}/cost`).catch(() => ({ data: { totalCostUsd: 0, records: [] } }));
      invCost = invRes.data?.totalCostUsd || 0;
      invRecords = invRes.data?.records || [];

      const invCostBadge = document.getElementById('finops-inv-cost-badge');
      const invBreakdown = document.getElementById('finops-inv-breakdown');
      if (invCostBadge) invCostBadge.textContent = `$${invCost.toFixed(4)}`;
      if (invBreakdown) {
        invBreakdown.innerHTML = `
          <div><strong>Tokens & Sandbox Cost:</strong> $${invCost.toFixed(4)}</div>
          <div><strong>Billable Ledger Entries:</strong> ${invRecords.length} records</div>
        `;
      }
    }

    const orgRes = await fetchAPI('/api/v1/finops/summary').catch(() => ({ data: { totalSpend: 0, budget: 100, isOverBudget: false, anomalies: [] } }));
    const orgSpendBadge = document.getElementById('finops-org-spend-badge');
    const orgBreakdown = document.getElementById('finops-org-breakdown');

    if (orgSpendBadge) {
      orgSpendBadge.textContent = `$${(orgRes.data.totalSpend || 0).toFixed(2)} / $${(orgRes.data.budget || 100).toFixed(2)}`;
      orgSpendBadge.className = `badge ${orgRes.data.isOverBudget ? 'badge-sev1' : 'badge-status'}`;
    }

    if (orgBreakdown) {
      orgBreakdown.innerHTML = `
        <div><strong>Total Spend MTD:</strong> $${(orgRes.data.totalSpend || 0).toFixed(4)}</div>
        <div><strong>Budget Limit:</strong> $${(orgRes.data.budget || 100).toFixed(2)} (${orgRes.data.isOverBudget ? '<span style="color:#ef4444;">OVER BUDGET</span>' : '<span style="color:#10b981;">HEALTHY</span>'})</div>
        <div><strong>Spend Anomalies Detected:</strong> ${orgRes.data.anomalies?.length || 0}</div>
      `;
    }

    const recordsContainer = document.getElementById('finops-records-list');
    if (recordsContainer) {
      recordsContainer.innerHTML = '';
      const list = invRecords.length > 0 ? invRecords : (orgRes.data.recentRecords || []);
      if (list.length === 0) {
        recordsContainer.innerHTML = '<div class="subtext" style="padding: 8px;">No billable FinOps transactions recorded yet.</div>';
      } else {
        list.slice(0, 20).forEach(rec => {
          const row = document.createElement('div');
          row.className = 'verification-card';
          row.style.padding = '8px 12px';
          row.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="badge badge-subtle">${rec.usage_type}</span>
              <span style="font-family: var(--font-mono); font-weight: 700; color: #10b981;">+$${parseFloat(rec.cost_usd || 0).toFixed(4)}</span>
            </div>
            <div class="subtext" style="font-size: 0.74rem;">
              Units: ${rec.quantity} | Model/Resource: ${escapeHTML(rec.model || rec.details || 'N/A')}
            </div>
          `;
          recordsContainer.appendChild(row);
        });
      }
    }
  } catch (err) {
    console.error('Error loading FinOps summary:', err);
  }
}

