// ---------------------------------------------------------------------------
// VAULT — Debts
// Loans, credit cards, anything owed. `originalAmount` is fixed at creation
// (what you started at, or what's currently owed if that's all you know)
// and never changes — it's the denominator for the progress bar.
// `remainingBalance` is what logging a payment reduces. Every payment is
// also logged to debtPayments with a date and optional note, so tapping a
// debt shows a real history, not just a number.
//
// Logging a payment does not touch accounts/transactions — if you want the
// payment itself reflected in your cash flow, add it as a regular expense
// too; this tracker only feeds the progress bar and the net worth line.
// ---------------------------------------------------------------------------

const DEBT_ICON_CHOICES = ["💳","🚗","🏠","🎓","🏥","📄","💼","🏦","👤","📱","🧾","⚠️"];

const debtFormBackdrop = document.getElementById("debt-form-backdrop");
let selectedDebtIcon = DEBT_ICON_CHOICES[0];
let selectedDebtColor = CATEGORY_COLORS[2]; // default to the rose tone — debts read as "owed"

document.getElementById("add-debt-btn").addEventListener("click", () => {
  document.getElementById("debt-name-input").value = "";
  document.getElementById("debt-total-input").value = "";
  document.getElementById("debt-balance-input").value = "";
  selectedDebtIcon = DEBT_ICON_CHOICES[0];
  selectedDebtColor = CATEGORY_COLORS[2];
  renderPickerGrid(document.getElementById("debt-icon-picker-grid"), DEBT_ICON_CHOICES, selectedDebtIcon, (v) => (selectedDebtIcon = v));
  renderColorRow(document.getElementById("debt-color-picker-row"), selectedDebtColor, (v) => (selectedDebtColor = v));
  debtFormBackdrop.classList.add("visible");
});

document.getElementById("debt-form-cancel-btn").addEventListener("click", () => debtFormBackdrop.classList.remove("visible"));

document.getElementById("debt-form-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("debt-name-input").value.trim();
  const total = parseFloat(document.getElementById("debt-total-input").value);
  if (!name || isNaN(total) || total < 0) return;
  // "Currently owed" defaults to the total if left blank — the common case
  // of starting to track a debt on day one, not partway through paying it.
  const currentInput = document.getElementById("debt-balance-input").value;
  const current = currentInput === "" ? total : parseFloat(currentInput);

  await profileDb.debts.add({
    name,
    originalAmount: total,
    remainingBalance: isNaN(current) ? total : current,
    icon: selectedDebtIcon,
    color: selectedDebtColor
  });
  debtsCache = await profileDb.debts.toArray();
  debtFormBackdrop.classList.remove("visible");
  window.refreshDebtsSettingsUI();
  window.renderDashboardDebts();
  await refreshAll(); // net worth depends on debts total
});

// --- Log a payment ------------------------------------------------------------
const debtPaymentBackdrop = document.getElementById("debt-payment-backdrop");
let pendingPaymentDebt = null;

function openDebtPayment(debt) {
  pendingPaymentDebt = debt;
  document.getElementById("debt-payment-title").textContent = `Log a payment — ${debt.name}`;
  document.getElementById("debt-payment-input").value = "";
  document.getElementById("debt-payment-note-input").value = "";
  debtPaymentBackdrop.classList.add("visible");
}
window.openDebtPayment = openDebtPayment;

document.getElementById("debt-payment-cancel-btn").addEventListener("click", () => debtPaymentBackdrop.classList.remove("visible"));
document.getElementById("debt-payment-save-btn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("debt-payment-input").value);
  if (!pendingPaymentDebt || !amount || amount <= 0) return;
  const note = document.getElementById("debt-payment-note-input").value.trim();
  const newBalance = Math.max(0, pendingPaymentDebt.remainingBalance - amount);

  await profileDb.debts.update(pendingPaymentDebt.id, { remainingBalance: newBalance });
  await profileDb.debtPayments.add({ debtId: pendingPaymentDebt.id, amount, date: todayStr(), note });
  debtsCache = await profileDb.debts.toArray();

  pendingPaymentDebt = null;
  debtPaymentBackdrop.classList.remove("visible");
  window.refreshDebtsSettingsUI();
  window.renderDashboardDebts();
  await refreshAll();
  if (window.refreshLedgerDetailIfOpen) window.refreshLedgerDetailIfOpen();
});

// --- Delete (double-tap confirm) ------------------------------------------------
const debtDeleteBackdrop = document.getElementById("debt-delete-backdrop");
const debtDeleteConfirmBtn = document.getElementById("debt-delete-confirm-btn");
let pendingDeleteDebt = null;

function openDebtDeleteConfirm(debt) {
  pendingDeleteDebt = debt;
  disarmTapTwice(debtDeleteConfirmBtn, "Delete");
  document.getElementById("debt-delete-warning").textContent = `Delete "${debt.name}"? This just removes it from tracking, along with its payment history.`;
  debtDeleteBackdrop.classList.add("visible");
}
document.getElementById("debt-delete-cancel-btn").addEventListener("click", () => {
  debtDeleteBackdrop.classList.remove("visible");
  pendingDeleteDebt = null;
});
debtDeleteConfirmBtn.addEventListener("click", () => {
  armTapTwice(debtDeleteConfirmBtn, "Delete", async () => {
    await profileDb.debts.delete(pendingDeleteDebt.id);
    await profileDb.debtPayments.where("debtId").equals(pendingDeleteDebt.id).delete();
    debtsCache = await profileDb.debts.toArray();
    pendingDeleteDebt = null;
    debtDeleteBackdrop.classList.remove("visible");
    window.refreshDebtsSettingsUI();
    window.renderDashboardDebts();
    await refreshAll();
  });
});

// --- Rendering ------------------------------------------------------------------
// A debt created before progress tracking existed has no originalAmount —
// falls back to its current balance, so it starts the progress bar at 0%
// rather than crashing on a divide-by-undefined.
function debtProgressPct(d) {
  const original = d.originalAmount || d.remainingBalance || 1;
  return Math.min(Math.round(((original - d.remainingBalance) / original) * 100), 100);
}
window.debtProgressPct = debtProgressPct;

function debtRowHTML(d) {
  const pct = debtProgressPct(d);
  return `
    <div class="top-cat-header">
      <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(d.color, 0.16)}; color:${d.color}">${d.icon}</span>${d.name}</span>
      <span>${formatAmount(d.remainingBalance, currentProfile.currency)}</span>
    </div>
    <div class="top-cat-bar-track">
      <div class="top-cat-bar-fill" style="width:${pct}%; background:${d.color}"></div>
    </div>`;
}

window.refreshDebtsSettingsUI = function () {
  const container = document.getElementById("debts-settings-container");
  if (debtsCache.length === 0) {
    container.innerHTML = `<p class="empty-state">No debts tracked. Nice.</p>`;
    return;
  }
  container.innerHTML = debtsCache.map((d) => `
    <div class="top-cat-row ledger-row interactive" data-debt-id="${d.id}">
      ${debtRowHTML(d)}
      <div class="goal-row-actions">
        <button class="btn-secondary interactive debt-payment-btn" data-debt-id="${d.id}">Log payment</button>
        <button class="btn-secondary interactive danger-action debt-delete-btn" data-debt-id="${d.id}">Delete</button>
      </div>
    </div>`).join("");

  container.querySelectorAll(".ledger-row").forEach((row) =>
    row.addEventListener("click", () => window.openDebtDetail(debtsCache.find((d) => d.id === Number(row.dataset.debtId))))
  );
  container.querySelectorAll(".debt-payment-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDebtPayment(debtsCache.find((d) => d.id === Number(btn.dataset.debtId)));
    })
  );
  container.querySelectorAll(".debt-delete-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDebtDeleteConfirm(debtsCache.find((d) => d.id === Number(btn.dataset.debtId)));
    })
  );
};

window.renderDashboardDebts = function () {
  const heading = document.getElementById("debts-heading");
  const list = document.getElementById("debts-dashboard-list");
  if (debtsCache.length === 0) {
    heading.style.display = "none";
    list.innerHTML = "";
    return;
  }
  heading.style.display = "block";
  list.innerHTML = debtsCache.map((d) => `
    <div class="top-cat-row ledger-row interactive" data-debt-id="${d.id}">${debtRowHTML(d)}</div>`).join("");

  list.querySelectorAll(".ledger-row").forEach((row) =>
    row.addEventListener("click", () => window.openDebtDetail(debtsCache.find((d) => d.id === Number(row.dataset.debtId))))
  );
};
