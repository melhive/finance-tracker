// ---------------------------------------------------------------------------
// VAULT — Recurring transactions
// A rule stores a snapshot of a transaction's payload (already encrypted if
// the profile has a password — same ciphertext, just re-dated and copied,
// never decrypted/re-encrypted on generation) plus a due date. Every time
// the profile is entered, any rule whose due date has arrived gets a real
// transaction generated for it, looping forward for any months missed
// while the app was closed.
// ---------------------------------------------------------------------------

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Adds one month to a "YYYY-MM-DD" string, clamping the day to whatever
 * that next month actually has (e.g. Jan 31 → Feb 28/29). */
function addOneMonthClamped(dateStr, dayOfMonth) {
  const [y, m] = dateStr.split("-").map(Number);
  let nextYear = y;
  let nextMonthIndex = m; // m is 1-based month, so this is already "next month" as a 0-based index
  if (nextMonthIndex > 11) {
    nextMonthIndex = 0;
    nextYear += 1;
  }
  const clampedDay = Math.min(dayOfMonth, daysInMonth(nextYear, nextMonthIndex));
  const mm = String(nextMonthIndex + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return `${nextYear}-${mm}-${dd}`;
}

// --- Generate any transactions that have come due ------------------------------
window.processRecurring = async function () {
  const rules = await profileDb.recurring.toArray();
  const today = todayStr();
  let generatedAny = false;

  for (const rule of rules) {
    if (!rule.active) continue;
    let due = rule.nextDueDate;
    let guard = 0;
    while (due <= today && guard < 24) {
      await profileDb.transactions.add({ date: due, payload: rule.payload });
      generatedAny = true;
      due = addOneMonthClamped(due, rule.dayOfMonth);
      guard++;
    }
    if (due !== rule.nextDueDate) {
      await profileDb.recurring.update(rule.id, { nextDueDate: due });
    }
  }
  return generatedAny;
};

// --- Settings list --------------------------------------------------------------
window.refreshRecurringSettingsUI = async function () {
  const container = document.getElementById("recurring-settings-container");
  const rules = (await profileDb.recurring.toArray()).filter((r) => r.active);

  if (rules.length === 0) {
    container.innerHTML = `<p class="empty-state">No recurring transactions yet. Check "Repeat monthly" when adding one.</p>`;
    return;
  }

  const rows = await Promise.all(
    rules.map(async (r) => ({ ...r, fields: await decodeTx(r.payload) }))
  );

  container.innerHTML = rows.map((r) => `
    <div class="budget-row">
      <span>${r.fields.category} · ${formatAmount(r.fields.amount, currentProfile.currency)} monthly</span>
      <button class="btn-secondary interactive danger-action recurring-stop-btn" data-recurring-id="${r.id}">Stop</button>
    </div>`).join("");

  container.querySelectorAll(".recurring-stop-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await profileDb.recurring.delete(Number(btn.dataset.recurringId));
      window.refreshRecurringSettingsUI();
    });
  });
};
