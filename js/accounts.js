// ---------------------------------------------------------------------------
// VAULT — Accounts
// Lets a profile track money across more than one place (Cash, Bank,
// GCash...). Every transaction belongs to an account; deleting an account
// doesn't delete its transactions — they just fall back to display under
// whichever account is now first, handled by resolveAccountId/Name in
// dashboard.js rather than by rewriting old records.
// ---------------------------------------------------------------------------

const accountFormBackdrop = document.getElementById("account-form-backdrop");

// Sorts accounts by sortOrder, transparently assigning sortOrder to any
// accounts created before drag-reordering existed (one-time, per profile).
async function loadAccountsSorted() {
  let rows = await profileDb.accounts.toArray();
  const missingOrder = rows.some((a) => typeof a.sortOrder !== "number");
  if (missingOrder) {
    rows.sort((a, b) => a.id - b.id);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].sortOrder !== i) {
        await profileDb.accounts.update(rows[i].id, { sortOrder: i });
        rows[i].sortOrder = i;
      }
    }
  }
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  return rows;
}
window.loadAccountsSorted = loadAccountsSorted;

let editingAccountId = null;

document.getElementById("add-account-btn").addEventListener("click", () => {
  editingAccountId = null;
  document.getElementById("account-form-title").textContent = "Add account";
  document.getElementById("account-name-input").value = "";
  document.getElementById("account-balance-input").value = "";
  accountFormBackdrop.classList.add("visible");
  setTimeout(() => document.getElementById("account-name-input").focus(), 250);
});

function openAccountEditForm(account) {
  editingAccountId = account.id;
  document.getElementById("account-form-title").textContent = "Edit account";
  document.getElementById("account-name-input").value = account.name;
  document.getElementById("account-balance-input").value = account.openingBalance || "";
  accountFormBackdrop.classList.add("visible");
}

document.getElementById("account-form-cancel-btn").addEventListener("click", () =>
  accountFormBackdrop.classList.remove("visible")
);

document.getElementById("account-form-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("account-name-input").value.trim();
  if (!name) return;
  const openingBalance = parseFloat(document.getElementById("account-balance-input").value) || 0;

  if (editingAccountId) {
    await profileDb.accounts.update(editingAccountId, { name, openingBalance });
  } else {
    const maxOrder = accountsCache.reduce((m, a) => Math.max(m, a.sortOrder || 0), -1);
    await profileDb.accounts.add({ name, openingBalance, sortOrder: maxOrder + 1 });
  }

  accountsCache = await loadAccountsSorted();
  editingAccountId = null;
  accountFormBackdrop.classList.remove("visible");
  window.refreshAccountsSettingsUI();
  await refreshAll();
});

// --- Delete account, with a random confirmation code (same pattern as
// deleting a whole profile) since this can't be undone. -----------------------
const accountDeleteBackdrop = document.getElementById("account-delete-confirm-backdrop");
const accountDeleteCodeInput = document.getElementById("account-delete-code-input");
const accountDeleteConfirmBtn = document.getElementById("account-delete-confirm-btn");
let pendingDeleteAccount = null;
let accountDeleteCode = "";

function openAccountDeleteConfirm(account) {
  pendingDeleteAccount = account;
  accountDeleteCode = randomConfirmCode(); // shared with profile deletion, from profiles.js
  document.getElementById("account-delete-warning").textContent =
    `This removes "${account.name}". Its past transactions stay put — they'll just show grouped under whichever account comes first.`;
  document.getElementById("account-delete-code").textContent = accountDeleteCode;
  accountDeleteCodeInput.value = "";
  accountDeleteConfirmBtn.disabled = true;
  accountDeleteBackdrop.classList.add("visible");
  setTimeout(() => accountDeleteCodeInput.focus(), 250);
}

accountDeleteCodeInput.addEventListener("input", () => {
  accountDeleteConfirmBtn.disabled = accountDeleteCodeInput.value.trim().toUpperCase() !== accountDeleteCode;
});

document.getElementById("account-delete-cancel-btn").addEventListener("click", () => {
  accountDeleteBackdrop.classList.remove("visible");
  pendingDeleteAccount = null;
});
accountDeleteBackdrop.addEventListener("click", (e) => {
  if (e.target === accountDeleteBackdrop) {
    accountDeleteBackdrop.classList.remove("visible");
    pendingDeleteAccount = null;
  }
});

accountDeleteConfirmBtn.addEventListener("click", async () => {
  if (!pendingDeleteAccount) return;
  await profileDb.accounts.delete(pendingDeleteAccount.id);
  accountsCache = await loadAccountsSorted();
  pendingDeleteAccount = null;
  accountDeleteBackdrop.classList.remove("visible");
  window.refreshAccountsSettingsUI();
  await refreshAll();
});

// --- Settings list, with a drag handle to reorder ------------------------------
let dragState = null;

window.refreshAccountsSettingsUI = function () {
  const container = document.getElementById("accounts-settings-container");
  container.innerHTML = accountsCache.map((a) => `
    <div class="budget-row account-row" data-account-id="${a.id}">
      <span class="account-row-left">
        <span class="drag-handle interactive" data-account-id="${a.id}" aria-label="Reorder">⠿</span>
        <span class="account-row-name interactive" data-account-id="${a.id}">
          ${a.name}
          ${a.openingBalance ? `<span class="account-row-opening">starts at ${formatAmount(a.openingBalance, currentProfile.currency)}</span>` : ""}
        </span>
      </span>
      <button class="btn-secondary interactive danger-action account-delete-btn" data-account-id="${a.id}"
              ${accountsCache.length <= 1 ? "disabled" : ""}>Remove</button>
    </div>`).join("");

  container.querySelectorAll(".account-row-name").forEach((el) => {
    el.addEventListener("click", () => {
      const account = accountsCache.find((a) => a.id === Number(el.dataset.accountId));
      if (account) openAccountEditForm(account);
    });
  });

  container.querySelectorAll(".account-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (accountsCache.length <= 1) return;
      const account = accountsCache.find((a) => a.id === Number(btn.dataset.accountId));
      if (account) openAccountDeleteConfirm(account);
    });
  });

  container.querySelectorAll(".drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", onDragHandleDown);
  });
};

function onDragHandleDown(e) {
  const container = document.getElementById("accounts-settings-container");
  const row = e.target.closest(".account-row");
  if (!row) return;
  e.preventDefault();

  const rows = [...container.querySelectorAll(".account-row")];
  dragState = {
    fromIndex: rows.indexOf(row),
    draggedEl: row,
    startY: e.clientY
  };
  row.classList.add("dragging");

  document.addEventListener("pointermove", onDragHandleMove);
  document.addEventListener("pointerup", onDragHandleUp);
}

function onDragHandleMove(e) {
  if (!dragState) return;
  const container = document.getElementById("accounts-settings-container");
  const { draggedEl } = dragState;
  const deltaY = e.clientY - dragState.startY;
  draggedEl.style.transform = `translateY(${deltaY}px)`;
  draggedEl.style.zIndex = "5";

  // Find which sibling the dragged row should swap with, based on the
  // pointer's current vertical position relative to each row's midpoint.
  const rows = [...container.querySelectorAll(".account-row")];
  const draggedIndex = rows.indexOf(draggedEl);
  const pointerY = e.clientY;

  for (const row of rows) {
    if (row === draggedEl) continue;
    const rect = row.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const rowIndex = rows.indexOf(row);
    if (rowIndex < draggedIndex && pointerY < mid) {
      container.insertBefore(draggedEl, row);
      dragState.startY = e.clientY;
      draggedEl.style.transform = "translateY(0px)";
      break;
    }
    if (rowIndex > draggedIndex && pointerY > mid) {
      container.insertBefore(draggedEl, row.nextSibling);
      dragState.startY = e.clientY;
      draggedEl.style.transform = "translateY(0px)";
      break;
    }
  }
}

async function onDragHandleUp() {
  document.removeEventListener("pointermove", onDragHandleMove);
  document.removeEventListener("pointerup", onDragHandleUp);
  if (!dragState) return;

  const container = document.getElementById("accounts-settings-container");
  const { draggedEl } = dragState;
  draggedEl.style.transform = "";
  draggedEl.style.zIndex = "";
  draggedEl.classList.remove("dragging");

  const newOrderIds = [...container.querySelectorAll(".account-row")].map((r) => Number(r.dataset.accountId));
  dragState = null;

  for (let i = 0; i < newOrderIds.length; i++) {
    const account = accountsCache.find((a) => a.id === newOrderIds[i]);
    if (account && account.sortOrder !== i) {
      await profileDb.accounts.update(newOrderIds[i], { sortOrder: i });
    }
  }
  accountsCache = await loadAccountsSorted();
  window.refreshAccountsSettingsUI();
  await refreshAll();
}

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
  accountsCache.forEach((a) => { balances[a.id] = a.openingBalance || 0; });
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
