/* ═══════════════════════════════════════════════
   BARITA WEALTH ADVISOR — app.js
   Firebase Auth + Firestore + Flask backend
═══════════════════════════════════════════════ */

// ─── FIREBASE CONFIG — replace with yours ─────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCYCE51wwDyxJ93Md7-SB3Vu0MouAkmupE",
  authDomain: "barita-soc-team-c.firebaseapp.com",
  projectId: "barita-soc-team-c",
  storageBucket: "barita-soc-team-c.firebasestorage.app",
  messagingSenderId: "363840368061",
  appId: "1:363840368061:web:d9c69645015d196e3236d4",
  measurementId: "G-D4E0HQSSFS"
};

// ─── BACKEND URL — Shar remember to replace with your Render/Railway URL after deploying ───────
// For local testing: const BACKEND_URL = "http://localhost:5000";
const BACKEND_URL = "http://localhost:5000";

// ─── FIREBASE IMPORTS ─────────────────────────────────────────────────────────
import { initializeApp }                              from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut,
         GoogleAuthProvider, signInWithPopup,
         signInWithEmailAndPassword,
         createUserWithEmailAndPassword,
         updateProfile, sendPasswordResetEmail }      from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc,
         collection, addDoc, query, orderBy,
         limit, getDocs, serverTimestamp }            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  user:        null,
  firebaseToken: null,
  answers:     {},
  qStep:       0,
  report:      null,
  chatHistory: [],
  currentView: 'dashboard',
  isRegister:  false,
};

// ─── QUESTIONNAIRE DEFINITION ─────────────────────────────────────────────────
// Each section has: id, title, questions[]
// Each question: id, text, type (single|multi|text|textarea), options[], conditional?
const SECTIONS = [
  // PAGE 1: Profile
  {
    id: 'profile', title: 'Your Profile',
    questions: [
      { id: 'first_name', text: 'First Name', type: 'text', placeholder: 'e.g. Jane' },
      { id: 'last_name',  text: 'Last Name',  type: 'text', placeholder: 'e.g. Smith' },
      { id: 'age',        text: 'Age',        type: 'text', placeholder: 'e.g. 28' },
    ],
  },
  // PAGE 2: Background
  {
    id: 'background', title: 'Your Background',
    questions: [
      {
        id: 'knowledge_level', text: 'How much do you know about investing?', type: 'single',
        options: ["I'm completely new to investing", 'I have basic knowledge but no real experience', "I've been learning and have some experience", 'I have a lot of investing experience'],
      },
      {
        id: 'employment_status', text: 'What is your employment status?', type: 'single',
        options: ['Salaried employee', 'Self-employed / business owner', 'Part-time / contract', 'Unemployed', 'Retired'],
      },
      {
        id: 'pay_frequency', text: 'How often do you get paid?', type: 'single',
        options: ['Monthly', 'Weekly', 'Commission-based', 'Self-employed (irregular)'],
      },
    ],
  },
  // PAGE 3: Dependents
  {
    id: 'dependents', title: 'Financial Dependents',
    questions: [
      {
        id: 'dependents', text: 'Do you have financial dependents?', type: 'single',
        options: ['None', '1-2 children', '3+ children', 'Elderly parents', 'Children + parents', 'Other dependents'],
      },
    ],
  },
  // PAGE 4: Existing Investments
  {
    id: 'existing_investments', title: 'Existing Investments',
    questions: [
      {
        id: 'other_investments', text: 'Do you hold investments or pensions elsewhere?', type: 'multi',
        hint: 'Select all that apply',
        options: ['No other investments', 'Local stocks / bonds', 'Pension / NIS', 'Foreign investments', 'Real estate'],
      },
    ],
  },
  // PAGE 5: Tax Residency
  {
    id: 'tax', title: 'Tax Residency',
    questions: [
      {
        id: 'tax_residency', text: 'In which country are you a tax resident?', type: 'multi',
        hint: 'Select all that apply',
        options: ['Jamaica only', 'USA', 'UK', 'Canada', 'Other'],
      },
    ],
  },
  // PAGE 6: Financial Goals
  {
    id: 'goals', title: 'Financial Goals',
    questions: [
      {
        id: 'primary_goal', text: 'What is your primary financial goal?', type: 'single',
        options: ['Wealth accumulation / growth', 'Retirement planning', 'Education funding', 'Property purchase', 'Income generation', 'Capital preservation', 'Emergency fund building'],
      },
      {
        id: 'goal_priority', text: 'How would you describe the priority of this goal?', type: 'single',
        options: ['Essential - I must achieve this', 'Aspirational - I would like to achieve this'],
      },
      {
        id: 'withdrawal_time', text: 'Over the next 2 years, how much do you expect to withdraw from this portfolio?', type: 'single',
        options: ['No withdrawals', 'Less than 10%', '10-25%', 'More than 25%'],
      },
    ],
  },
  // PAGE 7: Risk Reaction
  {
    id: 'risk_reaction', title: 'Risk Reaction',
    questions: [
      {
        id: 'drop_reaction', text: 'How would you react if your investment dropped by 20%?', type: 'single',
        options: ['Sell everything to avoid further losses', 'Sell some to reduce losses', 'Wait for recovery', 'Invest more at lower prices'],
      },
    ],
  },
  // PAGE 8: Risk Profile
  {
    id: 'risk_profile', title: 'Risk Profile',
    questions: [
      {
        id: 'risk_relationship', text: 'Which best describes your relationship with investment risk?', type: 'single',
        options: ["I'm okay with small changes, but big losses stress me", 'I understand ups and downs and stay calm', "I'm comfortable with big risks and see drops as opportunities", 'I worry a lot about losing money'],
      },
      {
        id: 'loss_vs_gain', text: 'Which outcome would upset you more?', type: 'single',
        options: ['Missing a 20% gain', 'Suffering a 20% loss'],
      },
      {
        id: 'performance_benchmark', text: 'When reviewing your portfolio, what do you mainly compare it to?', type: 'single',
        options: ['The amount I originally invested', 'The overall increase in value (JMD gains)', 'My expected return', 'A market index', 'The rate of inflation'],
      },
      {
        id: 'max_loss', text: 'What is the maximum annual loss you could tolerate without changing strategy?', type: 'single',
        options: ['Up to 10%', 'Up to 20%', 'Up to 40%', 'More than 40%'],
      },
    ],
  },
  // PAGE 9: Financial Resilience
  {
    id: 'resilience', title: 'Financial Resilience',
    questions: [
      {
        id: 'income_loss_runway', text: 'If you lost your primary income, how long could you maintain your lifestyle without touching investments?', type: 'single',
        options: ['Less than 3 months', '3-6 months', '6-12 months', '1-2 years', 'More than 2 years'],
      },
      {
        id: 'debt_situation', text: 'What best describes your current debt situation?', type: 'single',
        options: ['Debt-free', 'Minor debt', 'Moderate debt', 'Significant debt'],
      },
    ],
  },
  // PAGE 10: Currency
  {
    id: 'currency', title: 'Currency Profile',
    questions: [
      {
        id: 'earn_currency', text: 'In what currency do you primarily earn?', type: 'single',
        options: ['JMD only', 'USD only', 'Mostly JMD', 'Mostly USD', 'Equal amounts of JMD and USD'],
      },
      {
        id: 'spend_currency', text: 'In what currency do you primarily spend?', type: 'single',
        options: ['JMD only', 'USD only', 'Mostly JMD', 'Mostly USD', 'Equal amounts of JMD and USD'],
      },
      {
        id: 'usd_liabilities', text: 'Do you have USD-denominated liabilities?', type: 'single',
        options: ['None', 'Under USD $10K', 'USD $10K-$50K', 'USD $50K-$200K', 'Over USD $200K'],
      },
      {
        id: 'inflation_impact', text: 'How much does JMD inflation affect your cost of living?', type: 'single',
        options: ['Not sure', 'Minimal', 'Moderate', 'Significant', 'Severe'],
      },
    ],
  },
  // PAGE 11: Portfolio Management
  {
    id: 'management', title: 'Portfolio Management',
    questions: [
      {
        id: 'review_frequency', text: 'How often should your portfolio be reviewed and rebalanced?', type: 'single',
        options: ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'Only when needed'],
      },
      {
        id: 'market_adjustment', text: 'Are you open to adjusting your portfolio based on market conditions?', type: 'single',
        options: ['No - keep it fixed', 'Yes - small changes', 'Yes - moderate changes', 'Yes - fully active'],
      },
      {
        id: 'inflation_protection', text: 'Do you want inflation protection in your portfolio?', type: 'single',
        options: ['Yes - strong focus', 'Somewhat', 'Not necessary', 'Not sure'],
      },
      {
        id: 'invest_style', text: 'What is your preferred investment style?', type: 'single',
        options: ['Fully passive', 'Mostly passive', 'Balanced', 'Mostly active', 'Fully active'],
      },
      {
        id: 'involvement_level', text: 'How involved do you want to be in decisions?', type: 'single',
        options: ['Hands-off', 'Consulted on major changes', 'Approve major decisions', 'Fully involved'],
      },
    ],
  },
];
// ─── HELPERS ──────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const titles = { dashboard: 'Dashboard', questionnaire: 'Questionnaire', portfolio: 'My Portfolio', advisor: 'AI Advisor', reports: 'Reports' };
  $('topbar-title').textContent = titles[view] || view;
  renderView(view);
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    state.user = user;
    state.firebaseToken = await user.getIdToken();
    // Refresh token periodically
    setInterval(async () => { state.firebaseToken = await user.getIdToken(true); }, 50 * 60 * 1000);

    $('screen-login').classList.add('hidden');
    $('screen-app').classList.remove('hidden');

    const name = user.displayName || user.email.split('@')[0];
    const initial = name[0].toUpperCase();
    $('sidebar-name').textContent  = name;
    $('sidebar-email').textContent = user.email;
    $('sidebar-avatar').textContent = initial;
    $('topbar-avatar').textContent  = initial;

    await loadSession();
    switchView('dashboard');
  } else {
    state.user = null;
    $('screen-app').classList.add('hidden');
    $('screen-login').classList.remove('hidden');
  }
});

function setLoginError(msg) { $('login-error-text').textContent = msg; $('login-error').classList.remove('hidden'); }
function clearLoginError()  { $('login-error').classList.add('hidden'); }

async function handleGoogleSignIn() {
  clearLoginError();
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') setLoginError('Google sign-in failed: ' + e.message);
  }
}

async function handleEmailAuth() {
  clearLoginError();
  const email = $('input-email').value.trim();
  const pass  = $('input-password').value;
  if (!email || !pass) { setLoginError('Please enter email and password.'); return; }
  if (pass.length < 6) { setLoginError('Password must be at least 6 characters.'); return; }

  $('btn-email-auth').disabled = true;
  $('btn-email-text').textContent = state.isRegister ? 'Creating…' : 'Signing in…';
  $('btn-email-arrow').classList.add('hidden');
  $('btn-email-spinner').classList.remove('hidden');

  try {
    if (state.isRegister) {
      const name    = $('input-name').value.trim();
      const confirm = $('input-confirm').value;
      if (!name)          { setLoginError('Please enter your full name.');    throw new Error(); }
      if (pass !== confirm){ setLoginError('Passwords do not match.');         throw new Error(); }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch(e) {
    const msgs = {
      'auth/user-not-found':       'No account found with this email.',
      'auth/wrong-password':       'Incorrect password.',
      'auth/email-already-in-use': 'This email is already registered.',
      'auth/invalid-email':        'Please enter a valid email.',
      'auth/too-many-requests':    'Too many attempts — please wait.',
    };
    if (e.code) setLoginError(msgs[e.code] || e.message);
    $('btn-email-auth').disabled = false;
    $('btn-email-text').textContent = state.isRegister ? 'Create Account' : 'Sign In';
    $('btn-email-arrow').classList.remove('hidden');
    $('btn-email-spinner').classList.add('hidden');
  }
}

function toggleRegisterMode() {
  state.isRegister = !state.isRegister;
  $('register-fields').classList.toggle('hidden', !state.isRegister);
  $('register-confirm').classList.toggle('hidden', !state.isRegister);
  $('auth-title').textContent     = state.isRegister ? 'Create your account' : 'Sign in to your account';
  $('auth-sub').textContent       = state.isRegister ? 'Join the Barita SOC 2026 platform.' : 'Welcome back. Enter your details below.';
  $('toggle-label').textContent   = state.isRegister ? 'Already have an account?' : "Don't have an account?";
  $('btn-toggle-mode').textContent= state.isRegister ? 'Sign in instead' : 'Create one';
  $('btn-email-text').textContent = state.isRegister ? 'Create Account' : 'Sign In';
  clearLoginError();
}

window.handleSignOut = async () => {
  state.answers = {}; state.report = null; state.chatHistory = [];
  await signOut(auth);
};

// ─── FIRESTORE ─────────────────────────────────────────────────────────────────
async function saveSession() {
  if (!state.user) return;
  try {
    await setDoc(doc(db, 'sessions', state.user.uid), {
      answers:   state.answers,
      report:    state.report ? { profile: state.report.profile, metrics: state.report.metrics, profile_label: state.report.profile_label } : null,
      updatedAt: serverTimestamp(),
    });
  } catch(e) { console.warn('Save failed:', e.message); }
}

async function loadSession() {
  if (!state.user) return;
  try {
    const snap = await getDoc(doc(db, 'sessions', state.user.uid));
    if (snap.exists()) {
      const d = snap.data();
      if (d.answers) state.answers = d.answers;
      if (d.report)  state.report  = d.report;
    }
  } catch(e) { console.warn('Load failed:', e.message); }
}

async function loadReportHistory() {
  if (!state.user) return [];
  try {
    const q    = query(collection(db, 'users', state.user.uid, 'reports'), orderBy('createdAt','desc'), limit(10));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { return []; }
}

// ─── BACKEND CALLS ─────────────────────────────────────────────────────────────
async function callBackend(endpoint, body) {
  const token = state.firebaseToken || await state.user.getIdToken();
  const res   = await fetch(`${BACKEND_URL}${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function downloadPDF(reportId) {
  const token = state.firebaseToken || await state.user.getIdToken();
  const res   = await fetch(`${BACKEND_URL}/generate_report`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ answers: state.answers, report: state.report, report_id: reportId }),
  });
  if (!res.ok) { alert('Failed to generate PDF. Please try again.'); return; }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const name = state.user?.displayName || 'Client';
  a.href = url; a.download = `Barita_Portfolio_Report_${name.replace(/\s+/g,'_')}.pdf`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function renderView(view) {
  const area = $('view-area');
  area.innerHTML = '';
  if      (view === 'dashboard')     renderDashboard(area);
  else if (view === 'questionnaire') renderQuestionnaireView(area);
  else if (view === 'portfolio')     renderPortfolioView(area);
  else if (view === 'advisor')       renderAdvisorView(area);
  else if (view === 'reports')       renderReportsView(area);
}

// ── DASHBOARD ──
function renderDashboard(area) {
  const name    = state.user?.displayName || state.user?.email?.split('@')[0] || 'there';
  const profile = state.report?.profile || null;
  const label   = state.report?.profile_label || null;
  const done    = Object.keys(state.answers).length > 5;

  area.innerHTML = `
    <!-- Welcome banner -->
    <div class="dash-welcome">
      <div>
        <div class="dash-welcome-h">Welcome back, ${esc(name.split(' ')[0])} 👋</div>
        <p class="dash-welcome-p">${done
          ? `Your <strong style="color:var(--teal-light)">${esc(profile)}</strong> portfolio is ready. View your allocation and download your report.`
          : 'Complete the risk profiling questionnaire to get your personalised portfolio recommendation.'
        }</p>
      </div>
      <button class="dash-welcome-btn" onclick="${done ? "switchView('portfolio')" : "openQuestionnaire()"}">
        ${done ? '📊 View Portfolio' : '📋 Start Questionnaire'}
      </button>
    </div>

    <!-- Stat cards -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label"><div class="stat-card-icon teal">📋</div>Questionnaire</div>
        <div class="stat-card-val">${done ? '100%' : Math.round((Object.keys(state.answers).length / 15) * 100) + '%'}</div>
        <div class="stat-card-sub">${done ? 'Completed' : 'In progress'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label"><div class="stat-card-icon teal">🎯</div>Risk Profile</div>
        <div class="stat-card-val" style="font-size:18px">${profile ? `<span class="profile-badge ${profile.toLowerCase()}">${profile}</span>` : '—'}</div>
        <div class="stat-card-sub">${label || 'Not yet assessed'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label"><div class="stat-card-icon green">📈</div>Expected Return</div>
        <div class="stat-card-val ${profile ? 'green' : ''}">${state.report?.metrics?.expected_return || '—'}</div>
        <div class="stat-card-sub">Annualised estimate</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label"><div class="stat-card-icon blue">📄</div>Reports</div>
        <div class="stat-card-val">${done ? '1' : '0'}</div>
        <div class="stat-card-sub">${done ? '<span class="badge-up">↑ Ready to download</span>' : 'Complete questionnaire first'}</div>
      </div>
    </div>

    ${done && state.report?.allocations ? renderMiniAllocation() : `
    <div class="panel">
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-h">Start Your Risk Profile</div>
        <p class="empty-p">Answer 12 sections about your goals, risk tolerance, and financial situation to get a personalised portfolio.</p>
        <button class="btn-action" onclick="openQuestionnaire()">Begin Questionnaire →</button>
      </div>
    </div>
    `}
  `;
}

function renderMiniAllocation() {
  const allocs = state.report.allocations || [];
  return `
    <div class="three-col">
      <div class="panel">
        <div class="panel-header">
          <div><div class="panel-title">Portfolio Allocation</div><div class="panel-sub">Recommended asset mix</div></div>
          <button class="btn-dl" onclick="switchView('portfolio')">View full →</button>
        </div>
        <div class="panel-body">
          <div class="alloc-table" id="mini-alloc"></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Performance Metrics</div></div>
        <div class="panel-body">
          ${renderMetrics()}
        </div>
      </div>
    </div>
  `;
}

function renderMetrics() {
  const m = state.report?.metrics || {};
  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div><div class="stat-card-label">Expected Return</div><div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--green)">${m.expected_return || '—'}</div></div>
      <div class="divider"></div>
      <div><div class="stat-card-label">Volatility</div><div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--red)">${m.volatility || '—'}</div></div>
      <div class="divider"></div>
      <div><div class="stat-card-label">Sharpe Ratio</div><div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--teal)">${m.sharpe_ratio || '—'}</div></div>
    </div>
  `;
}

// ── QUESTIONNAIRE VIEW (just a prompt to open modal) ──
function renderQuestionnaireView(area) {
  const done = Object.keys(state.answers).length > 5;
  area.innerHTML = `
    <div class="panel" style="max-width:640px;margin:0 auto">
      <div class="panel-header"><div class="panel-title">Investment Risk Profiling Questionnaire</div></div>
      <div class="panel-body">
        <p style="font-size:14px;color:var(--text-muted);line-height:1.7;margin-bottom:20px">
          Understanding your risk profile will help us make investment recommendations that are suitable for you.
          This covers 12 sections: experience, goals, time horizon, risk tolerance, financial situation, liquidity,
          income needs, currency exposure, economic sensitivities, cost sensitivity, asset restrictions, and investment style.
        </p>
        ${done ? `
          <div style="background:var(--green-bg);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius);padding:14px 18px;margin-bottom:20px;font-size:14px;color:var(--green);font-weight:500">
            ✓ Questionnaire completed. Your portfolio has been generated.
          </div>` : ''}
        <button class="btn-action" onclick="openQuestionnaire()">
          ${done ? '✏️ Retake Questionnaire' : '📋 Begin Questionnaire →'}
        </button>
      </div>
    </div>
  `;
}

// ── PORTFOLIO VIEW ──
function renderPortfolioView(area) {
  if (!state.report || !state.report.allocations) {
    area.innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-h">No Portfolio Yet</div>
          <p class="empty-p">Complete the questionnaire to generate your personalised portfolio.</p>
          <button class="btn-action" onclick="openQuestionnaire()">Start Questionnaire →</button>
        </div>
      </div>`;
    return;
  }

  const { profile, profile_label, allocations, metrics, risk_breakdown } = state.report;
  area.innerHTML = `
    <div class="port-header">
      <div class="port-header-left">
        <h3>Your Portfolio <span class="profile-badge ${profile.toLowerCase()}" style="margin-left:10px">${profile}</span></h3>
        <p>${profile_label || ''}</p>
      </div>
      <button class="btn-dl" id="btn-dl-main">⬇ Download PDF Report</button>
    </div>

    <!-- Metrics row -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-card-label">Expected Return</div><div class="stat-card-val" style="color:var(--green)">${metrics.expected_return}</div></div>
      <div class="stat-card"><div class="stat-card-label">Volatility</div><div class="stat-card-val" style="color:var(--red)">${metrics.volatility}</div></div>
      <div class="stat-card"><div class="stat-card-label">Sharpe Ratio</div><div class="stat-card-val" style="color:var(--teal)">${metrics.sharpe_ratio}</div></div>
      <div class="stat-card"><div class="stat-card-label">Asset Classes</div><div class="stat-card-val">${allocations.length}</div></div>
    </div>

    <div class="two-col">
      <!-- Allocation table -->
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Asset Allocation</div><div class="panel-sub">SOC universe instruments</div></div>
        <div class="panel-body"><div id="alloc-table-full"></div></div>
      </div>

      <!-- Risk breakdown -->
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Risk Class Breakdown</div></div>
        <div class="panel-body" id="risk-breakdown-panel"></div>
      </div>
    </div>

    <!-- Financial info table — matches Figma -->
    <div class="panel" style="margin-top:0">
      <div class="panel-header">
        <div><div class="panel-title">Financial Information</div><div class="panel-sub">Based on your questionnaire inputs</div></div>
      </div>
      <div class="panel-body" style="padding:0">
        <table class="fi-table">
          <thead><tr><th>Category</th><th>Detail</th><th>Your Answer</th></tr></thead>
          <tbody>
            <tr><td>Investment Goal(s)</td><td></td><td>${esc((state.answers.objectives || []).join(', ') || '—')}</td></tr>
            <tr><td>Investment Horizon</td><td></td><td>${esc(state.answers.withdrawal_time || '—')}</td></tr>
            <tr><td>Investable Amount</td><td></td><td>${state.answers.investable_amount ? 'JMD ' + esc(state.answers.investable_amount) : '—'}</td></tr>
            <tr><td>Income Stability</td><td></td><td>${esc(state.answers.income_stability || '—')}</td></tr>
            <tr><td>Emergency Fund</td><td></td><td>${esc(state.answers.emergency_fund || '—')}</td></tr>
            <tr><td>Liquidity Need</td><td></td><td>${esc(state.answers.liquid_pct || '—')}</td></tr>
            <tr><td>Primary Currency</td><td></td><td>${esc(state.answers.primary_currency || '—')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Allocation table
  const allocEl = $('alloc-table-full');
  allocations.forEach(a => {
    const row = el('div', 'alloc-row-item');
    row.innerHTML = `
      <div class="alloc-dot" style="background:${a.color || '#0BB8A9'}"></div>
      <div style="flex:1"><div class="alloc-name">${esc(a.label)}</div><div class="alloc-ticker">${esc(a.ticker)}</div></div>
      <div class="alloc-bar-outer"><div class="alloc-bar-inner" style="background:${a.color || '#0BB8A9'}" data-pct="${a.pct}"></div></div>
      <div class="alloc-pct">${a.pct}%</div>
    `;
    allocEl.appendChild(row);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.alloc-bar-inner').forEach(b => { b.style.width = b.dataset.pct + '%'; });
  }));

  // Risk breakdown
  const rbEl = $('risk-breakdown-panel');
  if (risk_breakdown) {
    Object.entries(risk_breakdown).forEach(([label, d]) => {
      const box = el('div', 'alloc-row-item');
      box.innerHTML = `
        <div class="alloc-dot" style="background:${d.color}"></div>
        <div style="flex:1;font-size:13px;font-weight:500">${esc(label)}</div>
        <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:${d.color}">${d.pct}%</div>
      `;
      rbEl.appendChild(box);
    });
  }

  $('btn-dl-main').addEventListener('click', () => downloadPDF('latest'));
}

// ── AI ADVISOR VIEW ──
function renderAdvisorView(area) {
  area.innerHTML = `
    <div class="panel" style="max-width:760px">
      <div class="panel-header">
        <div><div class="panel-title">AI Portfolio Advisor</div><div class="panel-sub">Powered by ChatGPT — ask anything about your portfolio</div></div>
        ${state.report ? `<span class="profile-badge ${state.report.profile.toLowerCase()}">${state.report.profile}</span>` : ''}
      </div>
      <div class="panel-body">
        <div class="advisor-wrap" id="advisor-wrap"></div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-input" type="text" placeholder="Ask about your portfolio, investment strategy, risks…" />
          <button class="chat-send" id="chat-send">Send →</button>
        </div>
      </div>
    </div>
  `;

  // Render existing messages
  const wrap = $('advisor-wrap');
  if (state.chatHistory.length === 0) {
    const greeting = state.report
      ? `Hello! I've reviewed your portfolio. You've been classified as a **${state.report.profile}** investor. What would you like to know about your recommended allocation?`
      : "Hello! I'm your Barita AI Advisor. Complete the questionnaire first and I can explain your portfolio recommendation in detail.";
    state.chatHistory.push({ role: 'advisor', text: greeting });
  }
  state.chatHistory.forEach(m => appendMessage(m));

  $('chat-send').addEventListener('click', sendMessage);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
}

function appendMessage(msg) {
  const wrap = $('advisor-wrap');
  if (!wrap) return;
  const row = el('div', `msg-row${msg.role === 'user' ? ' is-user' : ''}`);
  row.innerHTML = `
    <div class="msg-avatar ${msg.role === 'advisor' ? 'ai' : 'user-av'}">${msg.role === 'advisor' ? 'B' : '👤'}</div>
    <div class="msg-bubble">
      ${msg.thinking
        ? '<div class="thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>'
        : `<div style="white-space:pre-wrap">${esc(msg.text)}</div>`}
    </div>
  `;
  wrap.appendChild(row);
  wrap.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function sendMessage() {
  const input = $('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  const userMsg = { role: 'user', text };
  state.chatHistory.push(userMsg);
  appendMessage(userMsg);

  const thinking = { role: 'advisor', thinking: true };
  appendMessage(thinking);

  try {
    const data = await callBackend('/chat', {
      message:  text,
      answers:  state.answers,
      report:   state.report,
      history:  state.chatHistory.filter(m => !m.thinking).slice(-8),
    });
    const wrap = $('advisor-wrap');
    if (wrap?.lastElementChild) wrap.lastElementChild.remove();
    const reply = { role: 'advisor', text: data.reply };
    state.chatHistory.push(reply);
    appendMessage(reply);
  } catch(e) {
    const wrap = $('advisor-wrap');
    if (wrap?.lastElementChild) wrap.lastElementChild.remove();
    const err = { role: 'advisor', text: 'Sorry, I could not connect to the advisor service. Please check that the backend is running.' };
    appendMessage(err);
  }
}

// ── REPORTS VIEW ──
async function renderReportsView(area) {
  area.innerHTML = `
    <div class="panel-header" style="padding:0 0 16px"><div class="panel-title">Your Reports</div></div>
    <div class="report-list" id="report-list">
      <div style="color:var(--text-faint);font-size:14px;padding:20px 0">Loading…</div>
    </div>
  `;

  const reports = await loadReportHistory();
  const list    = $('report-list');

  if (!reports.length && !state.report) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <div class="empty-h">No Reports Yet</div>
        <p class="empty-p">Complete the questionnaire to generate your first portfolio report.</p>
        <button class="btn-action" onclick="openQuestionnaire()">Start Questionnaire →</button>
      </div>`;
    return;
  }

  list.innerHTML = '';

  // Show current report first if exists
  if (state.report) {
    const item = el('div', 'report-item');
    item.innerHTML = `
      <div class="report-item-left">
        <h4>Portfolio Report — <span class="profile-badge ${state.report.profile.toLowerCase()}">${state.report.profile}</span></h4>
        <p>Current session · Click to download PDF</p>
      </div>
      <button class="btn-dl" id="dl-current">⬇ Download PDF</button>
    `;
    list.appendChild(item);
    item.querySelector('#dl-current').addEventListener('click', (e) => { e.stopPropagation(); downloadPDF('latest'); });
  }

  reports.forEach(r => {
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-JM', { dateStyle: 'medium' }) : '—';
    const item = el('div', 'report-item');
    item.innerHTML = `
      <div class="report-item-left">
        <h4><span class="profile-badge ${r.profile?.toLowerCase()}">${r.profile}</span></h4>
        <p>${date}</p>
      </div>
      <button class="btn-dl">⬇ Download PDF</button>
    `;
    item.querySelector('.btn-dl').addEventListener('click', (e) => { e.stopPropagation(); downloadPDF(r.id); });
    list.appendChild(item);
  });
}

// ─── QUESTIONNAIRE ────────────────────────────────────────────────────────────
// Flatten sections into individual questions, respecting showIf
function getActiveQuestions() {
  const qs = [];
  SECTIONS.forEach(sec => {
    sec.questions.forEach(q => {
      if (!q.showIf || q.showIf(state.answers)) {
        qs.push({ ...q, sectionTitle: sec.title });
      }
    });
  });
  return qs;
}

window.openQuestionnaire = function() {
  state.qStep = 0;
  $('modal-questionnaire').classList.remove('hidden');
  renderQuestion();
};

function closeQuestionnaire() { $('modal-questionnaire').classList.add('hidden'); }

function renderQuestion() {
  const questions = getActiveQuestions();
  const total     = questions.length;
  const q         = questions[state.qStep];
  if (!q) return;

  const pct = Math.round(((state.qStep) / total) * 100);
  $('q-progress-fill').style.width = pct + '%';
  $('q-progress-pct').textContent  = pct + '%';

  // Back button
  $('q-btn-back').style.visibility = state.qStep === 0 ? 'hidden' : 'visible';

  // Next button label
  $('q-btn-next').textContent = state.qStep === total - 1 ? 'Submit ✓' : 'Next →';
  $('q-btn-next').disabled    = !isAnswered(q);

  const body = $('q-body');
  body.innerHTML = `
    <div class="q-section-label">${q.sectionTitle} · Question ${state.qStep + 1} of ${total}</div>
    <div class="q-text">${esc(q.text)}</div>
    ${q.hint ? `<div class="q-hint">${esc(q.hint)}</div>` : ''}
    <div id="q-options-wrap"></div>
  `;

  const wrap = $('q-options-wrap');

  if (q.type === 'single') {
    const opts = el('div', 'q-options');
    q.options.forEach(opt => {
      const btn = el('button', `q-opt${state.answers[q.id] === opt ? ' selected' : ''}`);
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        state.answers[q.id] = opt;
        opts.querySelectorAll('.q-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        $('q-btn-next').disabled = false;
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);

  } else if (q.type === 'multi') {
    const selected = state.answers[q.id] || [];
    const opts = el('div', 'q-options');
    q.options.forEach(opt => {
      const btn = el('button', `q-opt${selected.includes(opt) ? ' selected' : ''}`);
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        const cur = state.answers[q.id] || [];
        if (cur.includes(opt)) { state.answers[q.id] = cur.filter(x => x !== opt); btn.classList.remove('selected'); }
        else                   { state.answers[q.id] = [...cur, opt];              btn.classList.add('selected'); }
        $('q-btn-next').disabled = false; // multi is optional
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);
    $('q-btn-next').disabled = false;

  } else if (q.type === 'text') {
    const input = el('input', 'q-input');
    input.type        = 'text';
    input.placeholder = q.placeholder || '';
    input.value       = state.answers[q.id] || '';
    input.addEventListener('input', e => {
      state.answers[q.id] = e.target.value;
      $('q-btn-next').disabled = !e.target.value.trim();
    });
    wrap.appendChild(input);

  } else if (q.type === 'textarea') {
    const ta = el('textarea', 'q-input q-textarea');
    ta.placeholder = q.placeholder || '';
    ta.value       = state.answers[q.id] || '';
    ta.addEventListener('input', e => { state.answers[q.id] = e.target.value; $('q-btn-next').disabled = false; });
    wrap.appendChild(ta);
    $('q-btn-next').disabled = false;
  }
}

function isAnswered(q) {
  if (q.type === 'multi' || q.type === 'textarea') return true;
  return !!state.answers[q.id];
}

async function advanceQuestion() {
  const questions = getActiveQuestions();
  if (state.qStep < questions.length - 1) {
    state.qStep++;
    renderQuestion();
  } else {
    // Submit
    closeQuestionnaire();
    await submitQuestionnaire();
  }
}

async function submitQuestionnaire() {
  // Show loading on portfolio view
  switchView('portfolio');
  $('view-area').innerHTML = `
    <div class="panel">
      <div class="empty-state">
        <div class="empty-icon">⚙️</div>
        <div class="empty-h">Building Your Portfolio…</div>
        <p class="empty-p">Our AI is analysing your profile and generating your personalised allocation.</p>
        <div class="thinking" style="justify-content:center;margin-top:12px"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      </div>
    </div>`;

  try {
    const data = await callBackend('/analyse', { answers: state.answers });
    state.report = data;

    // Save to Firestore
    await saveSession();
    await addDoc(collection(db, 'users', state.user.uid, 'reports'), {
      profile:      data.profile,
      profile_label:data.profile_label,
      metrics:      data.metrics,
      allocations:  data.allocations,
      answers:      state.answers,
      createdAt:    serverTimestamp(),
    });

    renderView('portfolio');
  } catch(e) {
    $('view-area').innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-h">Analysis Failed</div>
          <p class="empty-p">Could not connect to the backend: ${esc(e.message)}<br/><br/>Make sure your Flask server is running and BACKEND_URL is correct in app.js.</p>
          <button class="btn-action" onclick="switchView('questionnaire')">← Back</button>
        </div>
      </div>`;
  }
}

// ─── POST-LOAD MINI ALLOC ─────────────────────────────────────────────────────
function maybeRenderMiniAlloc() {
  const el2 = $('mini-alloc');
  if (!el2 || !state.report?.allocations) return;
  state.report.allocations.slice(0,6).forEach(a => {
    const row = el('div', 'alloc-row-item');
    row.innerHTML = `
      <div class="alloc-dot" style="background:${a.color||'#0BB8A9'}"></div>
      <div style="flex:1"><div class="alloc-name" style="font-size:12px">${esc(a.label)}</div></div>
      <div class="alloc-bar-outer"><div class="alloc-bar-inner" style="background:${a.color||'#0BB8A9'}" data-pct="${a.pct}"></div></div>
      <div class="alloc-pct">${a.pct}%</div>
    `;
    el2.appendChild(row);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.alloc-bar-inner').forEach(b => { b.style.width = b.dataset.pct + '%'; });
  }));
}

// ─── BIND EVENTS ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('btn-google').addEventListener('click', handleGoogleSignIn);
  $('btn-email-auth').addEventListener('click', handleEmailAuth);
  $('btn-forgot').addEventListener('click', async () => {
    const email = $('input-email').value.trim();
    if (!email) { setLoginError('Enter your email above first.'); return; }
    try { await sendPasswordResetEmail(auth, email); alert('Password reset email sent.'); }
    catch(e) { setLoginError('Could not send reset email: ' + e.message); }
  });
  $('btn-toggle-mode').addEventListener('click', toggleRegisterMode);
  $('btn-close-q').addEventListener('click', closeQuestionnaire);
  $('q-btn-next').addEventListener('click', advanceQuestion);
  $('q-btn-back').addEventListener('click', () => { if (state.qStep > 0) { state.qStep--; renderQuestion(); } });

  ['input-email','input-password'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') handleEmailAuth(); });
  });
});

// expose globals for inline onclick
window.switchView      = switchView;
window.openQuestionnaire = window.openQuestionnaire;