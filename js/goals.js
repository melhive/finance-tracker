// ---------------------------------------------------------------------------
// VAULT — Savings goals
// Deliberately separate from accounts/transactions: you manually log what
// you've put toward a goal rather than the app inferring it from spending.
// That money is still sitting in your actual account balance above — this
// is a motivational tracker layered on top, not a second ledger of real
// money movement. (That's also why goals are excluded from net worth.)
//
// Every contribution is also logged to goalContributions with a date and
// optional note, so tapping a goal shows a real history, not just a total.
// ---------------------------------------------------------------------------

const GOAL_ICON_CHOICES = ["🎯","💻","🏖️","🚗","🏠","🎓","💍","✈️","📱","🎸","🚲","👶","🩺","🛡️","🎁","💰"];

const goalFormBackdrop = document.getElementById("goal-form-backdrop");
let selectedGoalIcon = GOAL_ICON_CHOICES[0];
let selectedGoalColor = CATEGORY_COLORS[0];

function renderPickerGrid(gridEl, choices, selected, onPick) {
  gridEl.innerHTML = choices.map((icon) =>
    `<button type="button" class="icon-picker-btn interactive ${icon === selected ? "selected" : ""}" data-val="${icon}">${icon}</button>`
  ).join("");
  gridEl.querySelectorAll(".icon-picker-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      onPick(btn.dataset.val);
      gridEl.querySelectorAll(".icon-picker-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
}

function renderColorRow(rowEl, selected, onPick) {
  rowEl.innerHTML = CATEGORY_COLORS.map((c) =>
    `<button type="button" class="color-swatch-btn interactive ${c === selected ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`
  ).join("");
  rowEl.querySelectorAll(".color-swatch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      onPick(btn.dataset.color);
      rowEl.querySelectorAll(".color-swatch-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
}

document.getElementById("add-goal-btn").addEventListener("click", () => {
  document.getElementById("goal-name-input").value = "";
  document.getElementById("goal-target-input").value = "";
  selectedGoalIcon = GOAL_ICON_CHOICES[0];
  selectedGoalColor = CATEGORY_COLORS[0];
  renderPickerGrid(document.getElementById("goal-icon-picker-grid"), GOAL_ICON_CHOICES, selectedGoalIcon, (v) => (selectedGoalIcon = v));
  renderColorRow(document.getElementById("goal-color-picker-row"), selectedGoalColor, (v) => (selectedGoalColor = v));
  goalFormBackdrop.classList.add("visible");
});

document.getElementById("goal-form-cancel-btn").addEventListener("click", () => goalFormBackdrop.classList.remove("visible"));

document.getElementById("goal-form-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("goal-name-input").value.trim();
  const target = parseFloat(document.getElementById("goal-target-input").value);
  if (!name || !target || target <= 0) return;
  await profileDb.goals.add({ name, targetAmount: target, savedAmount: 0, icon: selectedGoalIcon, color: selectedGoalColor });
  goalsCache = await profileDb.goals.toArray();
  goalFormBackdrop.classList.remove("visible");
  window.refreshGoalsSettingsUI();
  window.renderDashboardGoals();
});

// --- Add funds --------------------------------------------------------------------
const goalFundsBackdrop = document.getElementById("goal-funds-backdrop");
let pendingFundsGoal = null;

function openGoalFunds(goal) {
  pendingFundsGoal = goal;
  document.getElementById("goal-funds-title").textContent = `Add funds — ${goal.name}`;
  document.getElementById("goal-funds-input").value = "";
  document.getElementById("goal-funds-note-input").value = "";
  goalFundsBackdrop.classList.add("visible");
}
window.openGoalFunds = openGoalFunds;

document.getElementById("goal-funds-cancel-btn").addEventListener("click", () => goalFundsBackdrop.classList.remove("visible"));
document.getElementById("goal-funds-save-btn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("goal-funds-input").value);
  if (!pendingFundsGoal || !amount || amount <= 0) return;
  const note = document.getElementById("goal-funds-note-input").value.trim();

  await profileDb.goals.update(pendingFundsGoal.id, { savedAmount: pendingFundsGoal.savedAmount + amount });
  await profileDb.goalContributions.add({ goalId: pendingFundsGoal.id, amount, date: todayStr(), note });
  goalsCache = await profileDb.goals.toArray();

  pendingFundsGoal = null;
  goalFundsBackdrop.classList.remove("visible");
  window.refreshGoalsSettingsUI();
  window.renderDashboardGoals();
  if (window.refreshLedgerDetailIfOpen) window.refreshLedgerDetailIfOpen();
});

// --- Delete (double-tap confirm — lower stakes than accounts/transactions) -----
const goalDeleteBackdrop = document.getElementById("goal-delete-backdrop");
const goalDeleteConfirmBtn = document.getElementById("goal-delete-confirm-btn");
let pendingDeleteGoal = null;

function openGoalDeleteConfirm(goal) {
  pendingDeleteGoal = goal;
  disarmTapTwice(goalDeleteConfirmBtn, "Delete");
  document.getElementById("goal-delete-warning").textContent = `Delete "${goal.name}"? Its progress and history will be lost.`;
  goalDeleteBackdrop.classList.add("visible");
}
document.getElementById("goal-delete-cancel-btn").addEventListener("click", () => {
  goalDeleteBackdrop.classList.remove("visible");
  pendingDeleteGoal = null;
});
goalDeleteConfirmBtn.addEventListener("click", () => {
  armTapTwice(goalDeleteConfirmBtn, "Delete", async () => {
    await profileDb.goals.delete(pendingDeleteGoal.id);
    await profileDb.goalContributions.where("goalId").equals(pendingDeleteGoal.id).delete();
    goalsCache = await profileDb.goals.toArray();
    pendingDeleteGoal = null;
    goalDeleteBackdrop.classList.remove("visible");
    window.refreshGoalsSettingsUI();
    window.renderDashboardGoals();
  });
});

// --- Rendering ----------------------------------------------------------------
// masked=true is only ever passed from the dashboard preview — Settings
// always shows real numbers, since you're there specifically to manage
// the goal (e.g. logging funds needs the real amount to make sense of).
function goalRowHTML(g, masked = false) {
  const pct = Math.min(Math.round((g.savedAmount / g.targetAmount) * 100), 100);
  const amountText = masked
    ? `${BALANCE_MASK} / ${BALANCE_MASK}`
    : `${formatAmount(g.savedAmount, currentProfile.currency)} / ${formatAmount(g.targetAmount, currentProfile.currency)}`;
  return `
    <div class="top-cat-header">
      <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(g.color, 0.16)}; color:${g.color}">${g.icon}</span>${g.name}</span>
      <span>${amountText}</span>
    </div>
    <div class="top-cat-bar-track">
      <div class="top-cat-bar-fill" style="width:${pct}%; background:${g.color}"></div>
    </div>`;
}

window.refreshGoalsSettingsUI = function () {
  const container = document.getElementById("goals-settings-container");
  if (goalsCache.length === 0) {
    container.innerHTML = `<p class="empty-state">No savings goals yet.</p>`;
    return;
  }
  container.innerHTML = goalsCache.map((g) => `
    <div class="top-cat-row ledger-row interactive" data-goal-id="${g.id}">
      ${goalRowHTML(g)}
      <div class="goal-row-actions">
        <button class="btn-secondary interactive goal-funds-btn" data-goal-id="${g.id}">Add funds</button>
        <button class="btn-secondary interactive danger-action goal-delete-btn" data-goal-id="${g.id}">Delete</button>
      </div>
    </div>`).join("");

  container.querySelectorAll(".ledger-row").forEach((row) =>
    row.addEventListener("click", () => window.openGoalDetail(goalsCache.find((g) => g.id === Number(row.dataset.goalId))))
  );
  container.querySelectorAll(".goal-funds-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openGoalFunds(goalsCache.find((g) => g.id === Number(btn.dataset.goalId)));
    })
  );
  container.querySelectorAll(".goal-delete-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openGoalDeleteConfirm(goalsCache.find((g) => g.id === Number(btn.dataset.goalId)));
    })
  );
};

window.renderDashboardGoals = function () {
  const heading = document.getElementById("goals-heading");
  const list = document.getElementById("goals-dashboard-list");
  if (goalsCache.length === 0) {
    heading.style.display = "none";
    list.innerHTML = "";
    return;
  }
  heading.style.display = "block";
  list.innerHTML = goalsCache.map((g) => `
    <div class="top-cat-row ledger-row interactive" data-goal-id="${g.id}">${goalRowHTML(g, balanceHidden)}</div>`).join("");

  list.querySelectorAll(".ledger-row").forEach((row) =>
    row.addEventListener("click", () => window.openGoalDetail(goalsCache.find((g) => g.id === Number(row.dataset.goalId))))
  );
};
