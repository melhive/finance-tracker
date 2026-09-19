// ---------------------------------------------------------------------------
// VAULT — Upcoming transactions
// Nothing new in the data model: an "upcoming" transaction is just a
// regular transaction dated after today. dashboard.js's refreshAll()
// already splits past vs. future and hands this module the future half —
// this file only renders it. Once today's date reaches a transaction's
// date, it automatically moves itself into the balance and Recent
// Activity on the next refresh; there's no separate step that "confirms"
// it happened.
// ---------------------------------------------------------------------------

const upcomingScreen = document.getElementById("upcoming-screen");
let lastUpcoming = []; // cached from the most recent refreshAll(), sorted soonest-first

function sortedByDateAsc(list) {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Called from dashboard.js's refreshAll() with this profile's future-dated
// transactions. Shows a short preview on the dashboard; hidden entirely
// when there are none, same as Budgets/Goals/Debts.
window.renderDashboardUpcoming = function (upcoming) {
  lastUpcoming = sortedByDateAsc(upcoming);
  const row = document.getElementById("upcoming-heading-row");
  const list = document.getElementById("upcoming-dashboard-list");

  if (lastUpcoming.length === 0) {
    row.style.display = "none";
    list.innerHTML = "";
    return;
  }
  row.style.display = "flex";
  list.innerHTML = lastUpcoming.slice(0, 5).map(renderTxRow).join("");
};

// Keeps the full-screen list in sync if it's open when data changes
// elsewhere (add, edit, delete, restore, recurring generation) — reuses
// the array refreshAll() already computed rather than re-querying the DB.
window.refreshUpcomingIfOpen = function (upcoming) {
  lastUpcoming = sortedByDateAsc(upcoming);
  if (upcomingScreen.classList.contains("visible")) {
    renderUpcomingFullList();
  }
};

function renderUpcomingFullList() {
  const list = document.getElementById("upcoming-list");
  list.innerHTML = lastUpcoming.length
    ? lastUpcoming.map(renderTxRow).join("")
    : `<p class="empty-state">Nothing scheduled. Add a future-dated transaction and it'll show up here until its date arrives.</p>`;
}

function openUpcomingScreen() {
  renderUpcomingFullList();
  upcomingScreen.classList.add("visible");
}

document.getElementById("open-upcoming-btn").addEventListener("click", openUpcomingScreen);
document.getElementById("upcoming-back-btn").addEventListener("click", () => upcomingScreen.classList.remove("visible"));

// Defaults to tomorrow rather than today — the whole point of this screen
// is entries that haven't happened yet. Still fully editable afterward;
// if someone changes the date back to today, it just quietly becomes a
// normal transaction on save, which is fine.
document.getElementById("upcoming-add-btn").addEventListener("click", () => openAddSheet(tomorrowStr()));

// Tapping a row opens it for editing, same as every other transaction list.
document.getElementById("upcoming-dashboard-list").addEventListener("click", (e) => {
  const row = e.target.closest(".tx-row");
  if (row) openEditSheet(Number(row.dataset.id));
});
document.getElementById("upcoming-list").addEventListener("click", (e) => {
  const row = e.target.closest(".tx-row");
  if (row) openEditSheet(Number(row.dataset.id));
});
