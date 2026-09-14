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

  const backup = {
    app: "vault",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      name: currentProfile.name,
      mode: currentProfile.mode,
      currency: currentProfile.currency
    },
    categories: categoriesCache.map((c) => ({ name: c.name, type: c.type, color: c.color })),
    transactions: transactions.map((t) => ({
      date: t.date,
      type: t.type,
      amount: t.amount,
      category: t.category,
      note: t.note || "",
      isTaxDeductible: !!t.isTaxDeductible
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

    // Add every transaction from the backup as a new record (merge, not
    // replace) — nothing currently in this profile is touched or removed.
    for (const t of backup.transactions) {
      const fields = {
        type: t.type,
        amount: t.amount,
        category: t.category,
        note: t.note || "",
        isTaxDeductible: !!t.isTaxDeductible
      };
      const payload = await encodeTx(fields);
      await profileDb.transactions.add({ date: t.date, payload });
    }

    restoreStatus.textContent = `Imported ${backup.transactions.length} transaction${backup.transactions.length === 1 ? "" : "s"}.`;
    await refreshAll();
  } catch (err) {
    restoreStatus.textContent = "Couldn't read that file. Make sure it's an exported Vault backup.";
  }
});
