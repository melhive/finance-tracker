// ---------------------------------------------------------------------------
// VAULT — Browse / search all transactions
// A full-screen filterable list, layered above the dashboard but below
// sheets (z-index 40), so tapping a result to edit it opens the normal
// edit sheet right on top without needing to close this screen first.
// ---------------------------------------------------------------------------

const browseScreen = document.getElementById("browse-screen");
let browseAllTransactions = [];
let selectedBrowseTagIds = new Set();

function populateBrowseTagChips() {
  const row = document.getElementById("browse-tag-chip-row");
  if (tagsCache.length === 0) {
    row.innerHTML = "";
    return;
  }
  row.innerHTML = tagsCache.map((t) => {
    const isSelected = selectedBrowseTagIds.has(t.id);
    const style = isSelected ? `background:${t.color}; color:#05231A;` : "";
    return `<button type="button" class="tag-chip interactive ${isSelected ? "selected" : ""}" style="${style}" data-tag-id="${t.id}">${t.name}</button>`;
  }).join("");
  row.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = Number(chip.dataset.tagId);
      if (selectedBrowseTagIds.has(id)) selectedBrowseTagIds.delete(id);
      else selectedBrowseTagIds.add(id);
      populateBrowseTagChips();
      applyBrowseFilters();
    });
  });
}

function populateBrowseCategoryOptions() {
  const select = document.getElementById("browse-category-select");
  const current = select.value;
  const names = [...new Set(categoriesCache.map((c) => c.name))];
  select.innerHTML = `<option value="all">All categories</option>` +
    names.map((n) => `<option value="${n}">${categoryIcon(n)} ${n}</option>`).join("");
  select.value = names.includes(current) ? current : "all";
}

function populateBrowseAccountOptions() {
  const select = document.getElementById("browse-account-select");
  const current = select.value;
  select.innerHTML = `<option value="all">All accounts</option>` +
    accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  select.value = current;
  if (select.value !== current) select.value = "all";
}

function applyBrowseFilters() {
  const search = document.getElementById("browse-search-input").value.trim().toLowerCase();
  const type = document.querySelector("#browse-type-segmented .segment.active").dataset.browseType;
  const category = document.getElementById("browse-category-select").value;
  const account = document.getElementById("browse-account-select").value;
  const from = document.getElementById("browse-date-from").value;
  const to = document.getElementById("browse-date-to").value;

  const filtered = browseAllTransactions.filter((t) => {
    if (type !== "all" && t.type !== type) return false;
    if (category !== "all" && t.category !== category) return false;
    if (account !== "all" && resolveAccountId(t.accountId) !== Number(account)) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (selectedBrowseTagIds.size > 0) {
      const hasMatch = (t.tags || []).some((id) => selectedBrowseTagIds.has(id));
      if (!hasMatch) return false;
    }
    if (search) {
      const haystack = `${t.category} ${t.note || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const list = document.getElementById("browse-list");
  list.innerHTML = filtered.length
    ? filtered.map(renderTxRow).join("")
    : `<p class="empty-state">No transactions match those filters.</p>`;
}

async function openBrowseScreen() {
  const rawRows = await profileDb.transactions.orderBy("date").reverse().toArray();
  browseAllTransactions = await loadTransactions(rawRows);
  populateBrowseCategoryOptions();
  populateBrowseAccountOptions();
  selectedBrowseTagIds = new Set();
  populateBrowseTagChips();

  document.getElementById("browse-search-input").value = "";
  document.querySelectorAll("#browse-type-segmented .segment").forEach((s) => s.classList.toggle("active", s.dataset.browseType === "all"));
  document.getElementById("browse-category-select").value = "all";
  document.getElementById("browse-account-select").value = "all";
  document.getElementById("browse-date-from").value = "";
  document.getElementById("browse-date-to").value = "";

  applyBrowseFilters();
  browseScreen.classList.add("visible");
}

// If the browse screen happens to be open when data changes elsewhere
// (edit, delete, restore, recurring generation), keep its list in sync.
window.refreshBrowseIfOpen = async function () {
  if (!browseScreen.classList.contains("visible")) return;
  const rawRows = await profileDb.transactions.orderBy("date").reverse().toArray();
  browseAllTransactions = await loadTransactions(rawRows);
  applyBrowseFilters();
};

document.getElementById("open-browse-btn").addEventListener("click", openBrowseScreen);
document.getElementById("browse-back-btn").addEventListener("click", () => browseScreen.classList.remove("visible"));

document.getElementById("browse-search-input").addEventListener("input", applyBrowseFilters);
document.getElementById("browse-category-select").addEventListener("change", applyBrowseFilters);
document.getElementById("browse-account-select").addEventListener("change", applyBrowseFilters);
document.getElementById("browse-date-from").addEventListener("change", applyBrowseFilters);
document.getElementById("browse-date-to").addEventListener("change", applyBrowseFilters);
document.querySelectorAll("#browse-type-segmented .segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#browse-type-segmented .segment").forEach((s) => s.classList.toggle("active", s === btn));
    applyBrowseFilters();
  });
});

// Tapping a result opens it for editing, same as the dashboard's recent list.
document.getElementById("browse-list").addEventListener("click", (e) => {
  const row = e.target.closest(".tx-row");
  if (row) openEditSheet(Number(row.dataset.id));
});
