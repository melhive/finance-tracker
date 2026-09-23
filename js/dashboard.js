// ---------------------------------------------------------------------------
// VAULT — Dashboard
// Everything that happens once a profile is entered: rendering the
// balance/recent list, the add-transaction sheet, the yesterday view,
// bottom-nav tab switching, and the settings tab's live values.
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = { PHP: "₱", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

let currentProfile = null;
let profileDb = null;
let categoriesCache = [];
let accountsCache = [];
let goalsCache = [];
let debtsCache = [];
let tagsCache = [];

// Balance visibility — a simple privacy toggle, remembered across sessions
// but not tied to any one profile (useful in public regardless of which
// profile happens to be open). Only the balance/income/expense/net-worth
// figures are masked; category names, transaction list, etc. stay visible.
let balanceHidden = localStorage.getItem("vault-balance-hidden") === "true";
let lastBalanceAmount = 0;
let lastPastTransactions = []; // cached so toggling the eye button can re-render Accounts/Goals/Debts without a DB re-read
let lastIncomeText = "", lastExpenseText = "";
let lastNetWorthText = "", lastNetWorthVisible = false;

function todayStr() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

function formatAmount(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || "";
  return symbol + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function categoryColor(name) {
  const cat = categoriesCache.find((c) => c.name === name);
  return cat ? cat.color : "#7C879C";
}

function categoryIcon(name) {
  const cat = categoriesCache.find((c) => c.name === name);
  if (cat && cat.icon) return cat.icon;
  return CATEGORY_ICON_MAP[name] || "💰";
}

function resolveAccountName(accountId) {
  const acc = accountsCache.find((a) => a.id === accountId);
  if (acc) return acc.name;
  return accountsCache[0] ? accountsCache[0].name : "Cash";
}

function resolveAccountId(accountId) {
  if (accountsCache.some((a) => a.id === accountId)) return accountId;
  return accountsCache[0] ? accountsCache[0].id : null;
}

function populateAccountOptions(selectedId) {
  const select = document.getElementById("tx-account-select");
  select.innerHTML = accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  const resolved = resolveAccountId(selectedId);
  if (resolved !== null) select.value = resolved;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Entry point, called once a profile is unlocked (or has no password) ----
window.enterDashboard = async function (profile, dek) {
  currentProfile = profile;
  window.currentDEK = dek || null;
  profileDb = openProfileDB(profile.id);
  clearTxCache(); // never carry decoded rows across a profile switch
  categoriesCache = await profileDb.categories.toArray();
  accountsCache = window.loadAccountsSorted ? await window.loadAccountsSorted() : await profileDb.accounts.toArray();
  goalsCache = await profileDb.goals.toArray();
  debtsCache = await profileDb.debts.toArray();
  tagsCache = await profileDb.tags.toArray();

  document.getElementById("settings-currency").textContent = profile.currency;
  document.getElementById("settings-mode").textContent = profile.mode === "business" ? "Business" : "Personal";
  window.refreshSecuritySettingsUI(profile);

  document.getElementById("tx-date-input").value = todayStr();
  populateCategoryOptions("expense");
  document.getElementById("tx-deductible-row").style.display = profile.mode === "business" ? "flex" : "none";

  switchTab("dashboard");
  syncSettingsThemeUI();
  if (window.processRecurring) await window.processRecurring();
  await refreshAll();

  if (typeof pendingShortcutAction !== "undefined" && pendingShortcutAction === "add") {
    pendingShortcutAction = null;
    openAddSheet();
  } else if (window.maybeShowOnboarding) {
    window.maybeShowOnboarding();
  }
};

// --- Payload encode/decode — transparent whether the profile is encrypted ----
async function encodeTx(fields) {
  if (currentProfile.hasPassword && window.currentDEK) {
    return encryptJSON(fields, window.currentDEK);
  }
  return JSON.stringify(fields);
}

async function decodeTx(payload) {
  if (currentProfile.hasPassword && window.currentDEK) {
    return decryptJSON(payload, window.currentDEK);
  }
  return JSON.parse(payload);
}

// --- Decoded-transaction cache --------------------------------------------------
// The dashboard genuinely needs every transaction on each refresh (the
// balance and per-account totals are all-time figures, so a date-range
// query can't help here). What we can avoid is re-running the decrypt for
// rows that haven't changed: on an encrypted profile every row is a
// separate async crypto operation, and that's what gets slow at scale.
//
// Cache is keyed by row id and holds the decoded fields. Rows deleted from
// the DB are pruned automatically; edited rows are invalidated explicitly
// via invalidateTxCache(id) at the one place edits happen.
let decodedTxCache = new Map();

function invalidateTxCache(id) {
  decodedTxCache.delete(id);
}
window.invalidateTxCache = invalidateTxCache;

function clearTxCache() {
  decodedTxCache = new Map();
}
window.clearTxCache = clearTxCache;

async function loadTransactions(rawRows) {
  const result = await Promise.all(
    rawRows.map(async (row) => {
      const cached = decodedTxCache.get(row.id);
      if (cached) return cached;
      const fields = await decodeTx(row.payload);
      const decoded = { id: row.id, date: row.date, ...fields };
      decodedTxCache.set(row.id, decoded);
      return decoded;
    })
  );

  // Prune entries for rows that no longer exist, so the cache can't grow
  // unbounded across deletes over a long session.
  if (decodedTxCache.size > rawRows.length) {
    const liveIds = new Set(rawRows.map((r) => r.id));
    for (const id of decodedTxCache.keys()) {
      if (!liveIds.has(id)) decodedTxCache.delete(id);
    }
  }

  return result;
}

// --- 30-day balance sparkline ---------------------------------------------------
// Walks backward from the current balance to reconstruct what it was on each
// of the last 30 days, then draws it as a filled area behind the balance
// card. Ambient only — no axis, no labels, no tooltip.
function renderBalanceSparkline(transactions, currentBalance) {
  const svg = document.getElementById("balance-sparkline");
  const DAYS = 30;

  const today = new Date();
  const dayKeys = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toLocaleDateString("en-CA"));
  }

  // Net change per day across the window.
  const netByDay = {};
  transactions.forEach((t) => {
    if (t.date < dayKeys[0] || t.date > dayKeys[dayKeys.length - 1]) return;
    netByDay[t.date] = (netByDay[t.date] || 0) + (t.type === "income" ? t.amount : -t.amount);
  });

  // Walk backwards from today's balance to get each day's closing balance.
  const series = new Array(DAYS);
  let running = currentBalance;
  for (let i = DAYS - 1; i >= 0; i--) {
    series[i] = running;
    running -= netByDay[dayKeys[i]] || 0;
  }

  const hasMovement = Object.keys(netByDay).length > 0;
  if (!hasMovement) {
    svg.innerHTML = "";
    return;
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const W = 300;
  const H = 60;
  const PAD = 6;

  const points = series.map((v, i) => {
    const x = (i / (DAYS - 1)) * W;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y];
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  // Trend color follows the direction over the window, matching the
  // income/expense palette used everywhere else.
  const rising = series[DAYS - 1] >= series[0];
  const stroke = rising ? "var(--accent-income)" : "var(--accent-expense)";

  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#sparkline-fill)" />
    <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  `;
}

async function refreshAll() {
  const rawRows = await profileDb.transactions.orderBy("date").reverse().toArray();
  const allTransactions = await loadTransactions(rawRows);

  // A future-dated transaction is logged but hasn't happened yet — it
  // shouldn't move the balance, budgets, or account totals until its date
  // actually arrives. That's the entire rule: no separate "pending" flag,
  // just a date comparison against today, so it resolves itself
  // automatically the next time the app is opened on or after that day.
  const today = todayStr();
  const transactions = allTransactions.filter((t) => t.date <= today);
  const upcoming = allTransactions.filter((t) => t.date > today);
  lastPastTransactions = transactions;

  const totalIncome = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  // Starting balances aren't income — they're money you already had before
  // you started tracking. They're added once here, not recorded as a
  // transaction, so they never distort the income/expense totals above,
  // Stats, or budgets.
  const totalOpeningBalance = accountsCache.reduce((s, a) => s + (a.openingBalance || 0), 0);
  const balance = totalOpeningBalance + totalIncome - totalExpense;

  renderBalanceSparkline(transactions, balance);
  lastBalanceAmount = balance;
  lastIncomeText = "+" + formatAmount(totalIncome, currentProfile.currency);
  lastExpenseText = "−" + formatAmount(totalExpense, currentProfile.currency);

  // Net worth = actual account balance minus what's owed. Savings goals are
  // deliberately excluded — that money is still sitting in an account above,
  // so counting it again here would double it.
  const totalDebt = debtsCache.reduce((s, d) => s + d.remainingBalance, 0);
  lastNetWorthVisible = debtsCache.length > 0;
  lastNetWorthText = `Net worth: ${formatAmount(balance - totalDebt, currentProfile.currency)}`;
  renderBalanceDisplay();

  renderRecentList(transactions.slice(0, 15));
  renderYesterdaySummary(transactions);
  if (window.renderDashboardBudgets) window.renderDashboardBudgets(transactions);
  if (window.renderDashboardAccounts) window.renderDashboardAccounts(transactions);
  if (window.renderDashboardGoals) window.renderDashboardGoals();
  if (window.renderDashboardDebts) window.renderDashboardDebts();
  if (window.renderDashboardUpcoming) window.renderDashboardUpcoming(upcoming);
  if (window.refreshUpcomingIfOpen) window.refreshUpcomingIfOpen(upcoming);
  if (window.refreshBrowseIfOpen) window.refreshBrowseIfOpen();
}

// Balance is the hero number — count it up rather than snapping to the new
// value, so every add/edit feels alive instead of just re-rendering text.
const BALANCE_MASK = "••••••";

let balanceAnimFrame = null;
function animateBalanceTo(target) {
  const el = document.getElementById("balance-amount");
  const previous = parseFloat(el.dataset.rawValue || "0");
  if (balanceAnimFrame) cancelAnimationFrame(balanceAnimFrame);

  // Never animate digits into view while hidden — just hold the mask.
  // dataset.rawValue still tracks the real number underneath, so revealing
  // it later (or the next count-up) starts from the right place.
  if (balanceHidden) {
    el.textContent = BALANCE_MASK;
    el.dataset.rawValue = target;
    return;
  }

  const duration = 600;
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = previous + (target - previous) * eased;
    el.textContent = formatAmount(current, currentProfile.currency);
    if (progress < 1) {
      balanceAnimFrame = requestAnimationFrame(step);
    } else {
      el.dataset.rawValue = target;
    }
  }
  balanceAnimFrame = requestAnimationFrame(step);
}

// Applies the current show/hide state to the balance card's text — called
// after refreshAll() computes fresh numbers, and directly when the eye
// button is tapped (no need to recompute anything, just re-paint).
function renderBalanceDisplay() {
  document.getElementById("balance-income-total").textContent = balanceHidden ? "+••••" : lastIncomeText;
  document.getElementById("balance-expense-total").textContent = balanceHidden ? "−••••" : lastExpenseText;

  const netWorthRow = document.getElementById("net-worth-row");
  if (lastNetWorthVisible) {
    netWorthRow.style.display = "block";
    netWorthRow.textContent = balanceHidden ? "Net worth: ••••" : lastNetWorthText;
  } else {
    netWorthRow.style.display = "none";
  }

  const eyeBtn = document.getElementById("balance-visibility-btn");
  if (eyeBtn) eyeBtn.classList.toggle("hidden-state", balanceHidden);

  // Re-run the balance line itself through the same hide/animate logic
  // above, using the last known real value.
  animateBalanceTo(lastBalanceAmount);

  // Accounts, goals, and debts read balanceHidden directly when they
  // render — just re-running them repaints with the new state, using data
  // already on hand (no DB re-read needed for a pure visibility toggle).
  if (window.renderDashboardAccounts) window.renderDashboardAccounts(lastPastTransactions);
  if (window.renderDashboardGoals) window.renderDashboardGoals();
  if (window.renderDashboardDebts) window.renderDashboardDebts();
}

document.getElementById("balance-visibility-btn").addEventListener("click", () => {
  balanceHidden = !balanceHidden;
  localStorage.setItem("vault-balance-hidden", String(balanceHidden));
  renderBalanceDisplay();
});

function renderRecentList(transactions) {
  const list = document.getElementById("recent-list");
  if (transactions.length === 0) {
    list.innerHTML = `<p class="empty-state">No transactions yet. Tap + to add your first one.</p>`;
    return;
  }
  list.innerHTML = transactions.map(renderTxRow).join("");
}

function renderTxRow(t) {
  const sign = t.type === "income" ? "+" : "−";
  const colorClass = t.type === "income" ? "split-income" : "split-expense";
  const color = categoryColor(t.category);
  const accountName = resolveAccountName(t.accountId);
  return `
    <div class="tx-row-wrapper" data-id="${t.id}">
      <div class="tx-row-delete-bg"><button type="button" class="tx-row-delete-btn" aria-label="Delete">🗑</button></div>
      <div class="tx-row interactive" data-id="${t.id}">
        <span class="tx-icon-badge" style="background:${hexToRgba(color, 0.16)}; color:${color}">${categoryIcon(t.category)}</span>
        <div class="tx-info">
          <div class="tx-category">${t.category}${t.receiptImage ? " 📎" : ""}</div>
          ${t.note ? `<div class="tx-note">${t.note}</div>` : ""}
          ${window.tagPillsHTML ? window.tagPillsHTML(t.tags) : ""}
        </div>
        <div class="tx-right">
          <div class="tx-amount ${colorClass}">${sign}${formatAmount(t.amount, currentProfile.currency)}</div>
          <div class="tx-date">${t.date} · ${accountName}</div>
        </div>
      </div>
    </div>`;
}

async function renderYesterdaySummary(allTransactions) {
  const yTx = allTransactions.filter((t) => t.date === yesterdayStr());
  const income = yTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = yTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  document.getElementById("yesterday-income").textContent = "+" + formatAmount(income, currentProfile.currency);
  document.getElementById("yesterday-expense").textContent = "−" + formatAmount(expense, currentProfile.currency);
}

// --- Bottom nav tab switching --------------------------------------------------
function switchTab(tab) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("visible", p.id === `tab-${tab}`));
  document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "stats" && window.renderStats) window.renderStats();
  if (tab === "reports" && window.refreshReportsTab) window.refreshReportsTab();
  if (tab === "settings" && window.refreshBudgetsSettingsUI) window.refreshBudgetsSettingsUI();
  if (tab === "settings" && window.refreshRecurringSettingsUI) window.refreshRecurringSettingsUI();
  if (tab === "settings" && window.refreshCategoriesSettingsUI) window.refreshCategoriesSettingsUI();
  if (tab === "settings" && window.refreshAccountsSettingsUI) window.refreshAccountsSettingsUI();
  if (tab === "settings" && window.refreshGoalsSettingsUI) window.refreshGoalsSettingsUI();
  if (tab === "settings" && window.refreshDebtsSettingsUI) window.refreshDebtsSettingsUI();
  if (tab === "settings" && window.refreshTagsSettingsUI) window.refreshTagsSettingsUI();
  if (tab === "settings") showSettingsHome();
}

document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// --- Settings tab: grouped sub-menu navigation ----------------------------------
// Shows a panel that was display:none, with a consistent fade-in — a plain
// style.display flip has nothing to visually transition from, so this
// pairs it with the same tab-fade-in animation used for tab switching.
// Removing-then-re-adding the class (with a forced reflow between) makes
// it restart even if the panel was already showing this animation.
function showPanel(el, display = "block") {
  el.style.display = display;
  el.classList.remove("panel-fade-in");
  void el.offsetWidth;
  el.classList.add("panel-fade-in");
}
window.showPanel = showPanel;

function showSettingsHome() {
  const home = document.getElementById("settings-home");
  document.querySelectorAll(".settings-group").forEach((g) => (g.style.display = "none"));
  showPanel(home);
}

function showSettingsGroup(groupId) {
  document.getElementById("settings-home").style.display = "none";
  document.querySelectorAll(".settings-group").forEach((g) => {
    if (g.id !== groupId) {
      g.style.display = "none";
      return;
    }
    showPanel(g);
  });
  document.getElementById("tab-settings").scrollTop = 0;
}

document.querySelectorAll(".settings-menu-row").forEach((btn) => {
  btn.addEventListener("click", () => showSettingsGroup(btn.dataset.settingsGroup));
});

document.querySelectorAll(".settings-group .settings-back-btn").forEach((btn) => {
  btn.addEventListener("click", showSettingsHome);
});

// --- Settings tab: theme segmented control -------------------------------------
const settingsThemeSegmented = document.getElementById("settings-theme-segmented");
function syncSettingsThemeUI() {
  const current = document.documentElement.getAttribute("data-theme");
  settingsThemeSegmented.querySelectorAll(".segment").forEach((s) =>
    s.classList.toggle("active", s.dataset.themeChoice === current)
  );
}
settingsThemeSegmented.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.documentElement.setAttribute("data-theme", btn.dataset.themeChoice);
    localStorage.setItem("vault-theme", btn.dataset.themeChoice);
    syncSettingsThemeUI();
  });
});
new MutationObserver(syncSettingsThemeUI).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// --- Add / edit transaction sheet ------------------------------------------------
const addTxBackdrop = document.getElementById("add-tx-backdrop");
const txTypeSegmented = document.getElementById("tx-type-segmented");
const txCategorySelect = document.getElementById("tx-category-select");
const deleteTxBtn = document.getElementById("delete-tx-btn");
let selectedTxType = "expense";
let editingTxId = null; // null = adding new; an id = editing that transaction
let currentReceiptImage = null; // base64 data URL, or null

function populateCategoryOptions(type) {
  const options = categoriesCache.filter((c) => c.type === type);
  txCategorySelect.innerHTML = options.map((c) => `<option value="${c.name}">${categoryIcon(c.name)} ${c.name}</option>`).join("");
}

txTypeSegmented.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedTxType = btn.dataset.txType;
    txTypeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
    populateCategoryOptions(selectedTxType);
  });
});

function resetDeleteButton() {
  deleteTxBtn.textContent = "Delete";
}

// --- Delete transaction, with a random 4-digit code to prevent mis-taps --------
const txDeleteConfirmBackdrop = document.getElementById("tx-delete-confirm-backdrop");
const txDeleteCodeInput = document.getElementById("tx-delete-code-input");
const txDeleteConfirmBtn = document.getElementById("tx-delete-confirm-btn");
let pendingDeleteTxId = null;
let txDeleteCode = "";

window.confirmDeleteTransaction = function (id) {
  pendingDeleteTxId = id;
  txDeleteCode = randomDigitCode();
  document.getElementById("tx-delete-code").textContent = txDeleteCode;
  txDeleteCodeInput.value = "";
  txDeleteConfirmBtn.disabled = true;
  txDeleteConfirmBackdrop.classList.add("visible");
  setTimeout(() => txDeleteCodeInput.focus(), 250);
};

txDeleteCodeInput.addEventListener("input", () => {
  txDeleteConfirmBtn.disabled = txDeleteCodeInput.value.trim() !== txDeleteCode;
});

document.getElementById("tx-delete-cancel-btn").addEventListener("click", () => {
  txDeleteConfirmBackdrop.classList.remove("visible");
  pendingDeleteTxId = null;
});
txDeleteConfirmBackdrop.addEventListener("click", (e) => {
  if (e.target === txDeleteConfirmBackdrop) {
    txDeleteConfirmBackdrop.classList.remove("visible");
    pendingDeleteTxId = null;
  }
});

txDeleteConfirmBtn.addEventListener("click", async () => {
  if (!pendingDeleteTxId) return;
  await profileDb.transactions.delete(pendingDeleteTxId);
  pendingDeleteTxId = null;
  txDeleteConfirmBackdrop.classList.remove("visible");
  closeTxSheet();
  await refreshAll();
});

// --- Receipt photo attach/remove/compress ---------------------------------------
function updateReceiptPreviewUI() {
  const preview = document.getElementById("tx-receipt-preview");
  const removeBtn = document.getElementById("tx-receipt-remove-btn");
  const pickBtn = document.getElementById("tx-receipt-pick-btn");
  if (currentReceiptImage) {
    preview.src = currentReceiptImage;
    preview.style.display = "block";
    removeBtn.style.display = "flex";
    pickBtn.style.display = "none";
  } else {
    preview.style.display = "none";
    removeBtn.style.display = "none";
    pickBtn.style.display = "inline-flex";
  }
}

function compressImageFile(file, maxDim = 1000, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("tx-receipt-pick-btn").addEventListener("click", () => {
  document.getElementById("tx-receipt-input").click();
});
document.getElementById("tx-receipt-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  currentReceiptImage = await compressImageFile(file);
  updateReceiptPreviewUI();
});
document.getElementById("tx-receipt-remove-btn").addEventListener("click", () => {
  currentReceiptImage = null;
  updateReceiptPreviewUI();
});
document.getElementById("tx-receipt-preview").addEventListener("click", () => {
  if (!currentReceiptImage) return;
  document.getElementById("receipt-view-img").src = currentReceiptImage;
  document.getElementById("receipt-view-backdrop").classList.add("visible");
});
document.getElementById("receipt-view-close-btn").addEventListener("click", () => {
  document.getElementById("receipt-view-backdrop").classList.remove("visible");
});
document.getElementById("receipt-view-backdrop").addEventListener("click", (e) => {
  if (e.target === document.getElementById("receipt-view-backdrop")) {
    document.getElementById("receipt-view-backdrop").classList.remove("visible");
  }
});

function openAddSheet(dateOverride) {
  editingTxId = null;
  document.getElementById("tx-sheet-title").textContent = "Add transaction";
  deleteTxBtn.style.display = "none";
  resetDeleteButton();
  document.getElementById("tx-amount-input").value = "";
  document.getElementById("tx-note-input").value = "";
  document.getElementById("tx-date-input").value = dateOverride || todayStr();
  document.getElementById("tx-deductible-input").checked = false;
  document.getElementById("tx-repeat-row").style.display = "flex";
  document.getElementById("tx-repeat-input").checked = false;
  currentReceiptImage = null;
  updateReceiptPreviewUI();
  if (window.setSelectedTagIds) window.setSelectedTagIds([]);
  selectedTxType = "expense";
  txTypeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s.dataset.txType === "expense"));
  populateCategoryOptions("expense");
  populateAccountOptions();
  addTxBackdrop.classList.add("visible");
  document.getElementById("open-add-transaction").classList.add("fab-open");
}

async function openEditSheet(id) {
  const row = await profileDb.transactions.get(id);
  if (!row) return;
  const fields = await decodeTx(row.payload);

  editingTxId = id;
  document.getElementById("tx-sheet-title").textContent = "Edit transaction";
  deleteTxBtn.style.display = "block";
  resetDeleteButton();
  document.getElementById("tx-repeat-row").style.display = "none";

  selectedTxType = fields.type;
  txTypeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s.dataset.txType === fields.type));
  populateCategoryOptions(fields.type);
  populateAccountOptions(fields.accountId);

  document.getElementById("tx-amount-input").value = fields.amount;
  txCategorySelect.value = fields.category;
  document.getElementById("tx-date-input").value = row.date;
  document.getElementById("tx-note-input").value = fields.note || "";
  document.getElementById("tx-deductible-input").checked = !!fields.isTaxDeductible;
  currentReceiptImage = fields.receiptImage || null;
  updateReceiptPreviewUI();
  if (window.setSelectedTagIds) window.setSelectedTagIds(fields.tags || []);

  addTxBackdrop.classList.add("visible");
}

document.getElementById("open-add-transaction").addEventListener("click", openAddSheet);

function closeTxSheet() {
  addTxBackdrop.classList.remove("visible");
  document.getElementById("open-add-transaction").classList.remove("fab-open");
}

document.getElementById("cancel-tx-btn").addEventListener("click", closeTxSheet);
addTxBackdrop.addEventListener("click", (e) => {
  if (e.target === addTxBackdrop) closeTxSheet();
});

document.getElementById("save-tx-btn").addEventListener("click", async () => {
  const amountInput = document.getElementById("tx-amount-input");
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) {
    amountInput.focus();
    return;
  }

  const fields = {
    type: selectedTxType,
    amount,
    category: txCategorySelect.value,
    accountId: Number(document.getElementById("tx-account-select").value),
    note: document.getElementById("tx-note-input").value.trim(),
    isTaxDeductible: document.getElementById("tx-deductible-input").checked,
    receiptImage: currentReceiptImage,
    tags: window.getSelectedTagIds ? window.getSelectedTagIds() : []
  };
  const payload = await encodeTx(fields);
  const date = document.getElementById("tx-date-input").value || todayStr();

  if (editingTxId) {
    await profileDb.transactions.update(editingTxId, { date, payload });
    invalidateTxCache(editingTxId);
  } else {
    await profileDb.transactions.add({ date, payload });
    if (document.getElementById("tx-repeat-input").checked) {
      // Read the day-of-month straight from the "YYYY-MM-DD" string rather
      // than new Date(date).getDate() — for anyone west of UTC, that
      // constructor parses the string as UTC midnight, and .getDate()
      // (local-time) can read back the previous day. For a bill set on
      // the 1st, that silently became "day 31 of last month" instead.
      const dayOfMonth = Number(date.split("-")[2]);
      await profileDb.recurring.add({
        payload,
        dayOfMonth,
        nextDueDate: addOneMonthClamped(date, dayOfMonth),
        active: true
      });
    }
  }

  closeTxSheet();
  await refreshAll();
});

deleteTxBtn.addEventListener("click", () => {
  if (!editingTxId) return;
  window.confirmDeleteTransaction(editingTxId);
});

// Tapping a row in the recent list opens it for editing.
document.getElementById("recent-list").addEventListener("click", (e) => {
  const row = e.target.closest(".tx-row");
  if (row) openEditSheet(Number(row.dataset.id));
});

// --- Yesterday detail sheet ------------------------------------------------------
const yesterdayBackdrop = document.getElementById("yesterday-backdrop");
document.getElementById("yesterday-list").addEventListener("click", (e) => {
  const row = e.target.closest(".tx-row");
  if (row) {
    yesterdayBackdrop.classList.remove("visible");
    openEditSheet(Number(row.dataset.id));
  }
});
document.getElementById("yesterday-card").addEventListener("click", async () => {
  const rawRows = await profileDb.transactions.where("date").equals(yesterdayStr()).toArray();
  const yTx = await loadTransactions(rawRows);
  const list = document.getElementById("yesterday-list");
  list.innerHTML = yTx.length
    ? yTx.map(renderTxRow).join("")
    : `<p class="empty-state">Nothing recorded yesterday.</p>`;
  yesterdayBackdrop.classList.add("visible");
});
document.getElementById("close-yesterday-btn").addEventListener("click", () => yesterdayBackdrop.classList.remove("visible"));
yesterdayBackdrop.addEventListener("click", (e) => {
  if (e.target === yesterdayBackdrop) yesterdayBackdrop.classList.remove("visible");
});