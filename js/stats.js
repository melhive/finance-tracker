// ---------------------------------------------------------------------------
// VAULT — Statistics
// Category breakdown + income/expense trend, computed client-side from the
// same decrypted transaction set the dashboard uses. Chart.js instances are
// destroyed and recreated on every render to avoid stacking canvases.
// ---------------------------------------------------------------------------

let statsPeriod = "week";
let categoryChartInstance = null;
let trendChartInstance = null;

document.querySelectorAll("#stats-period-segmented .segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    statsPeriod = btn.dataset.period;
    document.querySelectorAll("#stats-period-segmented .segment").forEach((s) => s.classList.toggle("active", s === btn));
    window.renderStats();
  });
});

function computeBuckets(all, period) {
  const today = new Date();
  const todayLocal = today.toLocaleDateString("en-CA");
  let startStr, buckets, bucketLabels, bucketOf;

  if (period === "week") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    startStr = start.toLocaleDateString("en-CA");
    bucketLabels = [];
    const dayStrs = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dayStrs.push(d.toLocaleDateString("en-CA"));
      bucketLabels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
    }
    bucketOf = (dateStr) => dayStrs.indexOf(dateStr);
    buckets = dayStrs.map(() => ({ income: 0, expense: 0 }));
  } else if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    startStr = start.toLocaleDateString("en-CA");
    const weeksInMonth = Math.ceil((today.getDate() + start.getDay()) / 7) || 1;
    bucketLabels = Array.from({ length: weeksInMonth }, (_, i) => `Week ${i + 1}`);
    bucketOf = (dateStr) => {
      const d = new Date(dateStr);
      return Math.floor((d.getDate() + start.getDay() - 1) / 7);
    };
    buckets = bucketLabels.map(() => ({ income: 0, expense: 0 }));
  } else {
    const start = new Date(today.getFullYear(), 0, 1);
    startStr = start.toLocaleDateString("en-CA");
    bucketLabels = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" }));
    bucketOf = (dateStr) => new Date(dateStr).getMonth();
    buckets = bucketLabels.map(() => ({ income: 0, expense: 0 }));
  }

  const filtered = all.filter((t) => t.date >= startStr && t.date <= todayLocal);
  filtered.forEach((t) => {
    const idx = bucketOf(t.date);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx][t.type] += t.amount;
    }
  });

  return { filtered, buckets, bucketLabels };
}

function renderCategoryChart(filtered) {
  const canvas = document.getElementById("category-chart");
  const emptyMsg = document.getElementById("category-chart-empty");
  const expenseByCategory = {};
  filtered.filter((t) => t.type === "expense").forEach((t) => {
    expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
  });

  const entries = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);

  if (categoryChartInstance) categoryChartInstance.destroy();

  if (entries.length === 0) {
    canvas.style.display = "none";
    emptyMsg.style.display = "block";
    return;
  }
  canvas.style.display = "block";
  emptyMsg.style.display = "none";

  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  categoryChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{
        data: entries.map(([, amount]) => amount),
        backgroundColor: entries.map(([name]) => categoryColor(name)),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: isLight ? "#171B24" : "#E8EAF0", boxWidth: 10, font: { size: 11 } }
        }
      }
    }
  });
}

function renderTrendChart(buckets, bucketLabels) {
  const canvas = document.getElementById("trend-chart");
  if (trendChartInstance) trendChartInstance.destroy();

  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const textColor = isLight ? "#171B24" : "#E8EAF0";
  const gridColor = isLight ? "#E4E7ED" : "#232A3D";

  trendChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels: bucketLabels,
      datasets: [
        { label: "Income", data: buckets.map((b) => b.income), backgroundColor: "#00D9A3", borderRadius: 4 },
        { label: "Expense", data: buckets.map((b) => b.expense), backgroundColor: "#FB4E6A", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: textColor, boxWidth: 10, font: { size: 11 } } }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });
}

function renderTopCategories(filtered) {
  const list = document.getElementById("top-categories-list");
  const expenseByCategory = {};
  filtered.filter((t) => t.type === "expense").forEach((t) => {
    expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
  });

  const total = Object.values(expenseByCategory).reduce((s, v) => s + v, 0);
  const top = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);

  if (top.length === 0) {
    list.innerHTML = `<p class="empty-state">No spending recorded for this period yet.</p>`;
    return;
  }

  list.innerHTML = top.map(([name, amount]) => {
    const pct = total ? Math.round((amount / total) * 100) : 0;
    const color = categoryColor(name);
    return `
      <div class="top-cat-row">
        <div class="top-cat-header">
          <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(color, 0.16)}; color:${color}">${categoryIcon(name)}</span>${name}</span>
          <span>${formatAmount(amount, currentProfile.currency)}</span>
        </div>
        <div class="top-cat-bar-track">
          <div class="top-cat-bar-fill" style="width:${pct}%; background:${color}"></div>
        </div>
      </div>`;
  }).join("");
}

window.renderStats = async function () {
  if (!profileDb) return;
  const rawRows = await profileDb.transactions.toArray();
  const all = await loadTransactions(rawRows);
  const { filtered, buckets, bucketLabels } = computeBuckets(all, statsPeriod);
  renderCategoryChart(filtered);
  renderTrendChart(buckets, bucketLabels);
  renderTopCategories(filtered);
};

// Re-render with correct chart text color if the theme changes while the
// stats tab happens to be open.
new MutationObserver(() => {
  if (document.getElementById("tab-stats").classList.contains("visible")) window.renderStats();
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
