// ---------------------------------------------------------------------------
// VAULT — Debts
// Loans, credit cards, anything owed. Logging a payment reduces the
// remaining balance directly (it does not touch accounts/transactions —
// if you want the payment itself reflected in your cash flow, add it as a
// regular expense too; this is just the balance-owed tracker that feeds
// the net worth line on the dashboard).
// ---------------------------------------------------------------------------

const DEBT_ICON_CHOICES = ["💳","🚗","🏠","🎓","🏥","📄","💼","🏦","👤","📱","🧾","⚠️"];

const debtFormBackdrop = document.getElementById("debt-form-backdrop");
let selectedDebtIcon = DEBT_ICON_CHOICES[0];
let selectedDebtColor = CATEGORY_COLORS[2]; // default to the rose tone — debts read as "owed"

document.getElementById("add-debt-btn").addEventListener("click", () => {
  document.getElementById("debt-name-input").value = "";
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
  const balance = parseFloat(document.getElementById("debt-balance-input").value);
  if (!name || isNaN(balance) || balance < 0) return;
  await profileDb.debts.add({ name, remainingBalance: balance, icon: selectedDebtIcon, color: selectedDebtColor });
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
  debtPaymentBackdrop.classList.add("visible");
}
document.getElementById("debt-payment-cancel-btn").addEventListener("click", () => debtPaymentBackdrop.classList.remove("visible"));
document.getElementById("debt-payment-save-btn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("debt-payment-input").value);
  if (!pendingPaymentDebt || !amount || amount <= 0) return;
  const newBalance = Math.max(0, pendingPaymentDebt.remainingBalance - amount);
  await profileDb.debts.update(pendingPaymentDebt.id, { remainingBalance: newBalance });
  debtsCache = await profileDb.debts.toArray();
  pendingPaymentDebt = null;
  debtPaymentBackdrop.classList.remove("visible");
  window.refreshDebtsSettingsUI();
  window.renderDashboardDebts();
  await refreshAll();
});

// --- Delete (double-tap confirm) ------------------------------------------------
const debtDeleteBackdrop = document.getElementById("debt-delete-backdrop");
const debtDeleteConfirmBtn = document.getElementById("debt-delete-confirm-btn");
let pendingDeleteDebt = null;

function openDebtDeleteConfirm(debt) {
  pendingDeleteDebt = debt;
  disarmTapTwice(debtDeleteConfirmBtn, "Delete");
  document.getElementById("debt-delete-warning").textContent = `Delete "${debt.name}"? This just removes it from tracking.`;
  debtDeleteBackdrop.classList.add("visible");
}
document.getElementById("debt-delete-cancel-btn").addEventListener("click", () => {
  debtDeleteBackdrop.classList.remove("visible");
  pendingDeleteDebt = null;
});
debtDeleteConfirmBtn.addEventListener("click", () => {
  armTapTwice(debtDeleteConfirmBtn, "Delete", async () => {
    await profileDb.debts.delete(pendingDeleteDebt.id);
    debtsCache = await profileDb.debts.toArray();
    pendingDeleteDebt = null;
    debtDeleteBackdrop.classList.remove("visible");
    window.refreshDebtsSettingsUI();
    window.renderDashboardDebts();
    await refreshAll();
  });
});

// --- Rendering ------------------------------------------------------------------
window.refreshDebtsSettingsUI = function () {
  const container = document.getElementById("debts-settings-container");
  if (debtsCache.length === 0) {
    container.innerHTML = `<p class="empty-state">No debts tracked. Nice.</p>`;
    return;
  }
  container.innerHTML = debtsCache.map((d) => `
    <div class="top-cat-row">
      <div class="top-cat-header">
        <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(d.color, 0.16)}; color:${d.color}">${d.icon}</span>${d.name}</span>
        <span>${formatAmount(d.remainingBalance, currentProfile.currency)}</span>
      </div>
      <div class="goal-row-actions">
        <button class="btn-secondary interactive debt-payment-btn" data-debt-id="${d.id}">Log payment</button>
        <button class="btn-secondary interactive danger-action debt-delete-btn" data-debt-id="${d.id}">Delete</button>
      </div>
    </div>`).join("");

  container.querySelectorAll(".debt-payment-btn").forEach((btn) =>
    btn.addEventListener("click", () => openDebtPayment(debtsCache.find((d) => d.id === Number(btn.dataset.debtId))))
  );
  container.querySelectorAll(".debt-delete-btn").forEach((btn) =>
    btn.addEventListener("click", () => openDebtDeleteConfirm(debtsCache.find((d) => d.id === Number(btn.dataset.debtId))))
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
    <div class="top-cat-row">
      <div class="top-cat-header">
        <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(d.color, 0.16)}; color:${d.color}">${d.icon}</span>${d.name}</span>
        <span>${formatAmount(d.remainingBalance, currentProfile.currency)}</span>
      </div>
    </div>`).join("");
};
