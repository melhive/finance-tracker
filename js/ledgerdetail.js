// ---------------------------------------------------------------------------
// VAULT — Goal / debt detail
// One screen shared between savings goals and debts rather than two nearly
// identical ones — they differ only in a few labels and which table backs
// the history list. Deleting a history entry reverses its effect on the
// running total (savedAmount down, remainingBalance back up, capped at the
// original amount) rather than just removing the row and leaving the
// aggregate wrong.
// ---------------------------------------------------------------------------

const ledgerDetailScreen = document.getElementById("ledger-detail-screen");
let currentLedgerDetail = null; // { kind: "goal" | "debt", id }

window.openGoalDetail = function (goal) {
  currentLedgerDetail = { kind: "goal", id: goal.id };
  renderLedgerDetail();
  ledgerDetailScreen.classList.add("visible");
};

window.openDebtDetail = function (debt) {
  currentLedgerDetail = { kind: "debt", id: debt.id };
  renderLedgerDetail();
  ledgerDetailScreen.classList.add("visible");
};

// Re-renders the detail screen if it's currently showing the item that
// just changed — called after Add funds / Log payment elsewhere.
window.refreshLedgerDetailIfOpen = function () {
  if (ledgerDetailScreen.classList.contains("visible")) renderLedgerDetail();
};

document.getElementById("ledger-detail-back-btn").addEventListener("click", () => {
  ledgerDetailScreen.classList.remove("visible");
  currentLedgerDetail = null;
});

async function renderLedgerDetail() {
  if (!currentLedgerDetail) return;
  const { kind, id } = currentLedgerDetail;
  const icon = document.getElementById("ledger-detail-icon");
  const bar = document.getElementById("ledger-detail-bar");
  const actionBtn = document.getElementById("ledger-detail-action-btn");

  if (kind === "goal") {
    const goal = goalsCache.find((g) => g.id === id);
    if (!goal) { ledgerDetailScreen.classList.remove("visible"); return; }
    const pct = Math.min(Math.round((goal.savedAmount / goal.targetAmount) * 100), 100);

    document.getElementById("ledger-detail-title").textContent = goal.name;
    icon.textContent = goal.icon;
    icon.style.background = hexToRgba(goal.color, 0.16);
    icon.style.color = goal.color;
    document.getElementById("ledger-detail-amount").textContent = formatAmount(goal.savedAmount, currentProfile.currency);
    document.getElementById("ledger-detail-sub").textContent = `of ${formatAmount(goal.targetAmount, currentProfile.currency)} goal — ${pct}%`;
    bar.style.width = pct + "%";
    bar.style.background = goal.color;
    actionBtn.textContent = "Add funds";
    actionBtn.onclick = () => window.openGoalFunds(goal);

    const history = await profileDb.goalContributions.where("goalId").equals(id).toArray();
    renderLedgerHistory(history, "goal");
  } else {
    const debt = debtsCache.find((d) => d.id === id);
    if (!debt) { ledgerDetailScreen.classList.remove("visible"); return; }
    const pct = window.debtProgressPct(debt);
    const original = debt.originalAmount || debt.remainingBalance;

    document.getElementById("ledger-detail-title").textContent = debt.name;
    icon.textContent = debt.icon;
    icon.style.background = hexToRgba(debt.color, 0.16);
    icon.style.color = debt.color;
    document.getElementById("ledger-detail-amount").textContent = formatAmount(debt.remainingBalance, currentProfile.currency);
    document.getElementById("ledger-detail-sub").textContent = `owed of ${formatAmount(original, currentProfile.currency)} total — ${pct}% paid off`;
    bar.style.width = pct + "%";
    bar.style.background = debt.color;
    actionBtn.textContent = "Log payment";
    actionBtn.onclick = () => window.openDebtPayment(debt);

    const history = await profileDb.debtPayments.where("debtId").equals(id).toArray();
    renderLedgerHistory(history, "debt");
  }
}

function renderLedgerHistory(entries, kind) {
  const container = document.getElementById("ledger-detail-history");
  if (entries.length === 0) {
    container.innerHTML = `<p class="empty-state">No ${kind === "goal" ? "contributions" : "payments"} logged yet.</p>`;
    return;
  }
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  container.innerHTML = sorted.map((e) => `
    <div class="ledger-history-row">
      <div class="ledger-history-row-left">
        <span>${formatAmount(e.amount, currentProfile.currency)}</span>
        <span class="ledger-history-date">${e.date}${e.note ? " · " + e.note : ""}</span>
      </div>
      <button class="btn-secondary interactive danger-action ledger-history-delete-btn" data-entry-id="${e.id}">Delete</button>
    </div>`).join("");

  container.querySelectorAll(".ledger-history-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      armTapTwice(btn, "Delete", () => deleteLedgerEntry(kind, Number(btn.dataset.entryId)));
    });
  });
}

async function deleteLedgerEntry(kind, entryId) {
  if (kind === "goal") {
    const entry = await profileDb.goalContributions.get(entryId);
    if (!entry) return;
    const goal = goalsCache.find((g) => g.id === entry.goalId);
    if (goal) {
      await profileDb.goals.update(goal.id, { savedAmount: Math.max(0, goal.savedAmount - entry.amount) });
      goalsCache = await profileDb.goals.toArray();
    }
    await profileDb.goalContributions.delete(entryId);
    window.refreshGoalsSettingsUI();
    window.renderDashboardGoals();
  } else {
    const entry = await profileDb.debtPayments.get(entryId);
    if (!entry) return;
    const debt = debtsCache.find((d) => d.id === entry.debtId);
    if (debt) {
      const cap = debt.originalAmount || debt.remainingBalance;
      await profileDb.debts.update(debt.id, { remainingBalance: Math.min(cap, debt.remainingBalance + entry.amount) });
      debtsCache = await profileDb.debts.toArray();
    }
    await profileDb.debtPayments.delete(entryId);
    window.refreshDebtsSettingsUI();
    window.renderDashboardDebts();
    await refreshAll();
  }
  renderLedgerDetail();
}
