// ---------------------------------------------------------------------------
// VAULT — Accounts
// Lets a profile track money across more than one place (Cash, Bank,
// GCash...). Every transaction belongs to an account; deleting an account
// doesn't delete its transactions — they just fall back to display under
// whichever account is now first, handled by resolveAccountId/Name in
// dashboard.js rather than by rewriting old records.
// ---------------------------------------------------------------------------

const accountFormBackdrop = document.getElementById("account-form-backdrop");

document.getElementById("add-account-btn").addEventListener("click", () => {
  document.getElementById("account-name-input").value = "";
  accountFormBackdrop.classList.add("visible");
  setTimeout(() => document.getElementById("account-name-input").focus(), 250);
});

document.getElementById("account-form-cancel-btn").addEventListener("click", () =>
  accountFormBackdrop.classList.remove("visible")
);

document.getElementById("account-form-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("account-name-input").value.trim();
  if (!name) return;
  await profileDb.accounts.add({ name });
  accountsCache = await profileDb.accounts.toArray();
  accountFormBackdrop.classList.remove("visible");
  window.refreshAccountsSettingsUI();
  await refreshAll();
});

window.refreshAccountsSettingsUI = function () {
  const container = document.getElementById("accounts-settings-container");
  container.innerHTML = accountsCache.map((a) => `
    <div class="budget-row">
      <span>${a.name}</span>
      <button class="btn-secondary interactive danger-action account-delete-btn" data-account-id="${a.id}"
              ${accountsCache.length <= 1 ? "disabled" : ""}>Remove</button>
    </div>`).join("");

  container.querySelectorAll(".account-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (accountsCache.length <= 1) return;
      await profileDb.accounts.delete(Number(btn.dataset.accountId));
      accountsCache = await profileDb.accounts.toArray();
      window.refreshAccountsSettingsUI();
      await refreshAll();
    });
  });
};

// Called from dashboard.js's refreshAll() with the already-decrypted
// transaction list, so no extra DB reads are needed here.
window.renderDashboardAccounts = function (allTransactions) {
  const heading = document.getElementById("accounts-heading");
  const list = document.getElementById("accounts-dashboard-list");

  if (accountsCache.length <= 1) {
    heading.style.display = "none";
    list.innerHTML = "";
    return;
  }

  const balances = {};
  accountsCache.forEach((a) => { balances[a.id] = 0; });
  allTransactions.forEach((t) => {
    const id = resolveAccountId(t.accountId);
    balances[id] = (balances[id] || 0) + (t.type === "income" ? t.amount : -t.amount);
  });

  heading.style.display = "block";
  list.innerHTML = accountsCache.map((a) => `
    <div class="top-cat-row">
      <div class="top-cat-header">
        <span>${a.name}</span>
        <span>${formatAmount(balances[a.id] || 0, currentProfile.currency)}</span>
      </div>
    </div>`).join("");
};
