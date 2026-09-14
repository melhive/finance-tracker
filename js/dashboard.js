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

function todayStr() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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
  categoriesCache = await profileDb.categories.toArray();

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

async function loadTransactions(rawRows) {
  return Promise.all(
    rawRows.map(async (row) => {
      const fields = await decodeTx(row.payload);
      return { id: row.id, date: row.date, ...fields };
    })
  );
}

async function refreshAll() {
  const rawRows = await profileDb.transactions.orderBy("date").reverse().toArray();
  const transactions = await loadTransactions(rawRows);

  const totalIncome = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = totalIncome - totalExpense;

  animateBalanceTo(balance);
  document.getElementById("balance-income-total").textContent = "+" + formatAmount(totalIncome, currentProfile.currency);
  document.getElementById("balance-expense-total").textContent = "−" + formatAmount(totalExpense, currentProfile.currency);

  renderRecentList(transactions.slice(0, 15));
  renderYesterdaySummary(transactions);
  if (window.renderDashboardBudgets) window.renderDashboardBudgets(transactions);
  if (window.refreshBrowseIfOpen) window.refreshBrowseIfOpen();
}

// Balance is the hero number — count it up rather than snapping to the new
// value, so every add/edit feels alive instead of just re-rendering text.
let balanceAnimFrame = null;
function animateBalanceTo(target) {
  const el = document.getElementById("balance-amount");
  const start = parseFloat(el.dataset.rawValue || "0");
  const duration = 600;
  const startTime = performance.now();
  if (balanceAnimFrame) cancelAnimationFrame(balanceAnimFrame);

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (target - start) * eased;
    el.textContent = formatAmount(current, currentProfile.currency);
    if (progress < 1) {
      balanceAnimFrame = requestAnimationFrame(step);
    } else {
      el.dataset.rawValue = target;
    }
  }
  balanceAnimFrame = requestAnimationFrame(step);
}

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
  return `
    <div class="tx-row interactive" data-id="${t.id}">
      <span class="tx-icon-badge" style="background:${hexToRgba(color, 0.16)}; color:${color}">${categoryIcon(t.category)}</span>
      <div class="tx-info">
        <div class="tx-category">${t.category}</div>
        ${t.note ? `<div class="tx-note">${t.note}</div>` : ""}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${colorClass}">${sign}${formatAmount(t.amount, currentProfile.currency)}</div>
        <div class="tx-date">${t.date}</div>
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
}

document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
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
  deleteTxBtn.dataset.armed = "";
  deleteTxBtn.textContent = "Delete";
}

function openAddSheet() {
  editingTxId = null;
  document.getElementById("tx-sheet-title").textContent = "Add transaction";
  deleteTxBtn.style.display = "none";
  resetDeleteButton();
  document.getElementById("tx-amount-input").value = "";
  document.getElementById("tx-note-input").value = "";
  document.getElementById("tx-date-input").value = todayStr();
  document.getElementById("tx-deductible-input").checked = false;
  document.getElementById("tx-repeat-row").style.display = "flex";
  document.getElementById("tx-repeat-input").checked = false;
  selectedTxType = "expense";
  txTypeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s.dataset.txType === "expense"));
  populateCategoryOptions("expense");
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

  document.getElementById("tx-amount-input").value = fields.amount;
  txCategorySelect.value = fields.category;
  document.getElementById("tx-date-input").value = row.date;
  document.getElementById("tx-note-input").value = fields.note || "";
  document.getElementById("tx-deductible-input").checked = !!fields.isTaxDeductible;

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
    note: document.getElementById("tx-note-input").value.trim(),
    isTaxDeductible: document.getElementById("tx-deductible-input").checked
  };
  const payload = await encodeTx(fields);
  const date = document.getElementById("tx-date-input").value || todayStr();

  if (editingTxId) {
    await profileDb.transactions.update(editingTxId, { date, payload });
  } else {
    await profileDb.transactions.add({ date, payload });
    if (document.getElementById("tx-repeat-input").checked) {
      const dayOfMonth = new Date(date).getDate();
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

deleteTxBtn.addEventListener("click", async () => {
  if (!editingTxId) return;
  if (deleteTxBtn.dataset.armed !== "true") {
    deleteTxBtn.dataset.armed = "true";
    deleteTxBtn.textContent = "Tap again to confirm";
    setTimeout(resetDeleteButton, 3000);
    return;
  }
  await profileDb.transactions.delete(editingTxId);
  resetDeleteButton();
  closeTxSheet();
  await refreshAll();
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
