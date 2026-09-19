// ---------------------------------------------------------------------------
// VAULT — Backup / restore
// Since this app has no server, this is the only safety net against losing
// data if a device is lost, storage is cleared, or someone switches phones.
// Export decrypts (if needed) so the backup file is portable on its own;
// the UI is upfront that the file itself is then in readable form.
// ---------------------------------------------------------------------------

const restoreStatus = document.getElementById("restore-status");

document.getElementById("export-data-btn").addEventListener("click", async () => {
  if (!profileDb || !currentProfile) return;

  const rawRows = await profileDb.transactions.toArray();
  const transactions = await loadTransactions(rawRows);
  const budgetRows = await profileDb.budgets.toArray();
  const recurringRows = await profileDb.recurring.toArray();
  const recurringExport = await Promise.all(recurringRows.map(async (rule) => {
    const fields = await decodeTx(rule.payload);
    return {
      type: fields.type,
      amount: fields.amount,
      category: fields.category,
      account: resolveAccountName(fields.accountId),
      note: fields.note || "",
      isTaxDeductible: !!fields.isTaxDeductible,
      tagNames: (fields.tags || []).map((id) => (tagsCache.find((tg) => tg.id === id) || {}).name).filter(Boolean),
      dayOfMonth: rule.dayOfMonth,
      nextDueDate: rule.nextDueDate,
      active: rule.active !== false
    };
  }));

  const backup = {
    app: "vault",
    exportVersion: 3,
    exportedAt: new Date().toISOString(),
    profile: {
      name: currentProfile.name,
      mode: currentProfile.mode,
      currency: currentProfile.currency
    },
    categories: categoriesCache.map((c) => ({ name: c.name, type: c.type, color: c.color, icon: c.icon })),
    accounts: accountsCache.map((a) => ({ name: a.name, openingBalance: a.openingBalance || 0 })),
    tags: tagsCache.map((t) => ({ name: t.name, color: t.color })),
    goals: goalsCache.map((g) => ({ name: g.name, targetAmount: g.targetAmount, savedAmount: g.savedAmount, icon: g.icon, color: g.color })),
    debts: debtsCache.map((d) => ({ name: d.name, originalAmount: d.originalAmount || d.remainingBalance, remainingBalance: d.remainingBalance, icon: d.icon, color: d.color })),
    budgets: budgetRows.map((b) => ({ category: b.category, limit: b.limit, period: b.period })),
    recurring: recurringExport,
    transactions: transactions.map((t) => ({
      date: t.date,
      type: t.type,
      amount: t.amount,
      category: t.category,
      account: resolveAccountName(t.accountId),
      note: t.note || "",
      isTaxDeductible: !!t.isTaxDeductible,
      receiptImage: t.receiptImage || null,
      tagNames: (t.tags || []).map((id) => (tagsCache.find((tg) => tg.id === id) || {}).name).filter(Boolean)
    }))
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vault-backup-${currentProfile.name.replace(/\s+/g, "-").toLowerCase()}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById("restore-data-btn").addEventListener("click", () => {
  restoreStatus.textContent = "";
  document.getElementById("restore-file-input").click();
});

document.getElementById("restore-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup || !Array.isArray(backup.transactions)) {
      restoreStatus.textContent = "That file doesn't look like a Vault backup.";
      return;
    }

    // Add any categories from the backup that don't already exist here.
    const existingNames = new Set(categoriesCache.map((c) => `${c.type}:${c.name}`));
    const newCategories = (backup.categories || []).filter((c) => !existingNames.has(`${c.type}:${c.name}`));
    if (newCategories.length) {
      await profileDb.categories.bulkAdd(newCategories);
      categoriesCache = await profileDb.categories.toArray();
    }

    // Add any accounts from the backup that don't already exist here.
    const existingAccountNames = new Set(accountsCache.map((a) => a.name));
    const newAccounts = (backup.accounts || []).filter((a) => !existingAccountNames.has(a.name));
    const maxOrder = accountsCache.reduce((m, a) => Math.max(m, a.sortOrder || 0), -1);
    for (let i = 0; i < newAccounts.length; i++) {
      await profileDb.accounts.add({
        name: newAccounts[i].name,
        openingBalance: newAccounts[i].openingBalance || 0,
        sortOrder: maxOrder + 1 + i
      });
    }
    if (newAccounts.length) accountsCache = await window.loadAccountsSorted();

    // Add any tags from the backup that don't already exist here.
    const existingTagNames = new Set(tagsCache.map((t) => t.name));
    const newTags = (backup.tags || []).filter((t) => !existingTagNames.has(t.name));
    if (newTags.length) {
      await profileDb.tags.bulkAdd(newTags);
      tagsCache = await profileDb.tags.toArray();
    }

    // Goals and debts are additive too — restoring never overwrites an
    // existing goal/debt with the same name, just adds ones that aren't here.
    const existingGoalNames = new Set(goalsCache.map((g) => g.name));
    const newGoals = (backup.goals || []).filter((g) => !existingGoalNames.has(g.name));
    if (newGoals.length) {
      await profileDb.goals.bulkAdd(newGoals);
      goalsCache = await profileDb.goals.toArray();
    }
    const existingDebtNames = new Set(debtsCache.map((d) => d.name));
    const newDebts = (backup.debts || []).filter((d) => !existingDebtNames.has(d.name));
    if (newDebts.length) {
      await profileDb.debts.bulkAdd(newDebts);
      debtsCache = await profileDb.debts.toArray();
    }

    // Budgets are additive by category name — a category that already has
    // a budget here keeps it; only categories with no existing budget get
    // one added from the backup.
    const existingBudgetCategories = new Set((await profileDb.budgets.toArray()).map((b) => b.category));
    const newBudgets = (backup.budgets || []).filter((b) => !existingBudgetCategories.has(b.category));
    if (newBudgets.length) {
      await profileDb.budgets.bulkAdd(newBudgets);
    }

    // Recurring rules: each one's snapshot gets re-encoded fresh for this
    // profile, resolving account/tag names the same way transactions do
    // below (accounts/tags themselves were already created above if new).
    let recurringAdded = 0;
    for (const rule of backup.recurring || []) {
      const account = accountsCache.find((a) => a.name === rule.account) || accountsCache[0];
      const tagIds = (rule.tagNames || [])
        .map((name) => (tagsCache.find((tg) => tg.name === name) || {}).id)
        .filter((id) => id !== undefined);
      const fields = {
        type: rule.type,
        amount: rule.amount,
        category: rule.category,
        accountId: account ? account.id : null,
        note: rule.note || "",
        isTaxDeductible: !!rule.isTaxDeductible,
        tags: tagIds
      };
      const payload = await encodeTx(fields);
      await profileDb.recurring.add({
        payload,
        dayOfMonth: rule.dayOfMonth,
        nextDueDate: rule.nextDueDate,
        active: rule.active !== false
      });
      recurringAdded++;
    }
    if (recurringAdded && window.refreshRecurringSettingsUI) window.refreshRecurringSettingsUI();

    // Add every transaction from the backup as a new record (merge, not
    // replace) — nothing currently in this profile is touched or removed.
    // Anything already here by fingerprint is skipped, so restoring the
    // same backup twice doesn't double your data.
    const seen = await buildExistingFingerprints();
    let added = 0;
    let duplicates = 0;

    for (const t of backup.transactions) {
      const fp = txFingerprint(t.date, t.amount, t.type, t.note);
      if (seen.has(fp)) { duplicates++; continue; }
      seen.add(fp);

      const account = accountsCache.find((a) => a.name === t.account) || accountsCache[0];
      const tagIds = (t.tagNames || [])
        .map((name) => (tagsCache.find((tg) => tg.name === name) || {}).id)
        .filter((id) => id !== undefined);
      const fields = {
        type: t.type,
        amount: t.amount,
        category: t.category,
        accountId: account ? account.id : null,
        note: t.note || "",
        isTaxDeductible: !!t.isTaxDeductible,
        receiptImage: t.receiptImage || null,
        tags: tagIds
      };
      const payload = await encodeTx(fields);
      await profileDb.transactions.add({ date: t.date, payload });
      added++;
    }

    let msg = `Imported ${added} transaction${added === 1 ? "" : "s"}`;
    if (duplicates) msg += `, skipped ${duplicates} already in your records`;
    if (newBudgets.length) msg += `, ${newBudgets.length} budget${newBudgets.length === 1 ? "" : "s"}`;
    if (recurringAdded) msg += `, ${recurringAdded} recurring rule${recurringAdded === 1 ? "" : "s"}`;
    restoreStatus.textContent = msg + ".";
    await refreshAll();
  } catch (err) {
    restoreStatus.textContent = "Couldn't read that file. Make sure it's an exported Vault backup.";
  }
});
