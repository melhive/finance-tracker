// ---------------------------------------------------------------------------
// VAULT — Savings goals
// Deliberately separate from accounts/transactions: you manually log what
// you've put toward a goal rather than the app inferring it from spending.
// That money is still sitting in your actual account balance above — this
// is a motivational tracker layered on top, not a second ledger of real
// money movement. (That's also why goals are excluded from net worth.)
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
  goalFundsBackdrop.classList.add("visible");
}
document.getElementById("goal-funds-cancel-btn").addEventListener("click", () => goalFundsBackdrop.classList.remove("visible"));
document.getElementById("goal-funds-save-btn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("goal-funds-input").value);
  if (!pendingFundsGoal || !amount || amount <= 0) return;
  await profileDb.goals.update(pendingFundsGoal.id, { savedAmount: pendingFundsGoal.savedAmount + amount });
  goalsCache = await profileDb.goals.toArray();
  pendingFundsGoal = null;
  goalFundsBackdrop.classList.remove("visible");
  window.refreshGoalsSettingsUI();
  window.renderDashboardGoals();
});

// --- Delete (double-tap confirm — lower stakes than accounts/transactions) -----
const goalDeleteBackdrop = document.getElementById("goal-delete-backdrop");
const goalDeleteConfirmBtn = document.getElementById("goal-delete-confirm-btn");
let pendingDeleteGoal = null;

function openGoalDeleteConfirm(goal) {
  pendingDeleteGoal = goal;
  goalDeleteConfirmBtn.textContent = "Delete";
  document.getElementById("goal-delete-warning").textContent = `Delete "${goal.name}"? Its progress will be lost.`;
  goalDeleteBackdrop.classList.add("visible");
}
document.getElementById("goal-delete-cancel-btn").addEventListener("click", () => {
  goalDeleteBackdrop.classList.remove("visible");
  pendingDeleteGoal = null;
});
goalDeleteConfirmBtn.addEventListener("click", async () => {
  if (goalDeleteConfirmBtn.textContent !== "Tap again to confirm") {
    goalDeleteConfirmBtn.textContent = "Tap again to confirm";
    setTimeout(() => (goalDeleteConfirmBtn.textContent = "Delete"), 3000);
    return;
  }
  await profileDb.goals.delete(pendingDeleteGoal.id);
  goalsCache = await profileDb.goals.toArray();
  pendingDeleteGoal = null;
  goalDeleteBackdrop.classList.remove("visible");
  window.refreshGoalsSettingsUI();
  window.renderDashboardGoals();
});

// --- Rendering ----------------------------------------------------------------
window.refreshGoalsSettingsUI = function () {
  const container = document.getElementById("goals-settings-container");
  if (goalsCache.length === 0) {
    container.innerHTML = `<p class="empty-state">No savings goals yet.</p>`;
    return;
  }
  container.innerHTML = goalsCache.map((g) => {
    const pct = Math.min(Math.round((g.savedAmount / g.targetAmount) * 100), 100);
    return `
      <div class="top-cat-row">
        <div class="top-cat-header">
          <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(g.color, 0.16)}; color:${g.color}">${g.icon}</span>${g.name}</span>
          <span>${formatAmount(g.savedAmount, currentProfile.currency)} / ${formatAmount(g.targetAmount, currentProfile.currency)}</span>
        </div>
        <div class="top-cat-bar-track">
          <div class="top-cat-bar-fill" style="width:${pct}%; background:${g.color}"></div>
        </div>
        <div class="goal-row-actions">
          <button class="btn-secondary interactive goal-funds-btn" data-goal-id="${g.id}">Add funds</button>
          <button class="btn-secondary interactive danger-action goal-delete-btn" data-goal-id="${g.id}">Delete</button>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll(".goal-funds-btn").forEach((btn) =>
    btn.addEventListener("click", () => openGoalFunds(goalsCache.find((g) => g.id === Number(btn.dataset.goalId))))
  );
  container.querySelectorAll(".goal-delete-btn").forEach((btn) =>
    btn.addEventListener("click", () => openGoalDeleteConfirm(goalsCache.find((g) => g.id === Number(btn.dataset.goalId))))
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
  list.innerHTML = goalsCache.map((g) => {
    const pct = Math.min(Math.round((g.savedAmount / g.targetAmount) * 100), 100);
    return `
      <div class="top-cat-row">
        <div class="top-cat-header">
          <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(g.color, 0.16)}; color:${g.color}">${g.icon}</span>${g.name}</span>
          <span>${formatAmount(g.savedAmount, currentProfile.currency)} / ${formatAmount(g.targetAmount, currentProfile.currency)}</span>
        </div>
        <div class="top-cat-bar-track">
          <div class="top-cat-bar-fill" style="width:${pct}%; background:${g.color}"></div>
        </div>
      </div>`;
  }).join("");
};
