// ---------------------------------------------------------------------------
// VAULT — Budgets
// Monthly spending limits per expense category. Set in Settings, shown as
// a progress list on the dashboard (only when at least one is set).
// ---------------------------------------------------------------------------

async function getBudgetsMap() {
  const rows = await profileDb.budgets.toArray();
  const map = {};
  rows.forEach((b) => { map[b.category] = b; });
  return map;
}

window.refreshBudgetsSettingsUI = async function () {
  const container = document.getElementById("budgets-settings-container");
  const budgetsMap = await getBudgetsMap();
  const expenseCategories = categoriesCache.filter((c) => c.type === "expense");

  container.innerHTML = expenseCategories.map((c) => {
    const existing = budgetsMap[c.name];
    return `
      <div class="budget-row">
        <span>${c.name}</span>
        <input type="number" class="field-input budget-input" data-category="${c.name}"
               placeholder="No limit" min="0" step="0.01" value="${existing ? existing.limit : ""}" />
      </div>`;
  }).join("");
};

document.getElementById("save-budgets-btn").addEventListener("click", async () => {
  const inputs = document.querySelectorAll(".budget-input");
  for (const input of inputs) {
    const category = input.dataset.category;
    const value = parseFloat(input.value);
    const existing = await profileDb.budgets.where("category").equals(category).first();

    if (!value || value <= 0) {
      if (existing) await profileDb.budgets.delete(existing.id);
      continue;
    }
    if (existing) {
      await profileDb.budgets.update(existing.id, { limit: value });
    } else {
      await profileDb.budgets.add({ category, limit: value, period: "monthly" });
    }
  }

  document.getElementById("budgets-save-status").textContent = "Budgets saved.";
  setTimeout(() => (document.getElementById("budgets-save-status").textContent = ""), 2500);
  await refreshAll();
});

// Called from dashboard.js's refreshAll() with the already-loaded,
// already-decrypted transaction list, so this never re-queries the DB.
window.renderDashboardBudgets = async function (allTransactions) {
  const heading = document.getElementById("budgets-heading");
  const list = document.getElementById("budgets-list");
  const budgets = await profileDb.budgets.toArray();

  if (budgets.length === 0) {
    heading.style.display = "none";
    list.innerHTML = "";
    return;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toLocaleDateString("en-CA");

  const spendByCategory = {};
  allTransactions
    .filter((t) => t.type === "expense" && t.date >= monthStartStr)
    .forEach((t) => { spendByCategory[t.category] = (spendByCategory[t.category] || 0) + t.amount; });

  heading.style.display = "block";
  list.innerHTML = budgets.map((b) => {
    const spent = spendByCategory[b.category] || 0;
    const pct = Math.min(Math.round((spent / b.limit) * 100), 100);
    const color = pct >= 100 ? "var(--accent-expense)" : pct >= 70 ? "#F5B942" : "var(--accent-income)";
    const catColor = categoryColor(b.category);
    return `
      <div class="top-cat-row">
        <div class="top-cat-header">
          <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(catColor, 0.16)}; color:${catColor}">${categoryIcon(b.category)}</span>${b.category}</span>
          <span>${formatAmount(spent, currentProfile.currency)} / ${formatAmount(b.limit, currentProfile.currency)}</span>
        </div>
        <div class="top-cat-bar-track">
          <div class="top-cat-bar-fill" style="width:${pct}%; background:${color}"></div>
        </div>
      </div>`;
  }).join("");
};
