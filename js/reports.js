// ---------------------------------------------------------------------------
// VAULT — Reports
// Weekly/monthly summary cards on the Reports tab, and PDF generation
// entirely client-side via jsPDF + jspdf-autotable — no server involved,
// consistent with the rest of the app being fully offline.
// ---------------------------------------------------------------------------

let cachedWeekReport = null;
let cachedMonthReport = null;

function getWeekRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const startStr = start.toLocaleDateString("en-CA");
  const endStr = end.toLocaleDateString("en-CA");
  const label = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return { startStr, endStr, label };
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const startStr = start.toLocaleDateString("en-CA");
  const endStr = now.toLocaleDateString("en-CA");
  const label = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { startStr, endStr, label };
}

async function computeReportSummary(startStr, endStr) {
  const rawRows = await profileDb.transactions.where("date").between(startStr, endStr, true, true).toArray();
  const tx = await loadTransactions(rawRows);
  const income = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  return { tx, income, expense };
}

window.refreshReportsTab = async function () {
  if (!profileDb) return;

  const week = getWeekRange();
  const weekSummary = await computeReportSummary(week.startStr, week.endStr);
  document.getElementById("weekly-range").textContent = week.label;
  document.getElementById("weekly-income").textContent = "+" + formatAmount(weekSummary.income, currentProfile.currency);
  document.getElementById("weekly-expense").textContent = "−" + formatAmount(weekSummary.expense, currentProfile.currency);
  cachedWeekReport = { ...week, ...weekSummary };

  const month = getMonthRange();
  const monthSummary = await computeReportSummary(month.startStr, month.endStr);
  document.getElementById("monthly-range").textContent = month.label;
  document.getElementById("monthly-income").textContent = "+" + formatAmount(monthSummary.income, currentProfile.currency);
  document.getElementById("monthly-expense").textContent = "−" + formatAmount(monthSummary.expense, currentProfile.currency);
  cachedMonthReport = { ...month, ...monthSummary };
};

function generateReportPDF(data, periodLabel) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const currency = currentProfile.currency;

  doc.setFontSize(18);
  doc.setTextColor(11, 14, 20);
  doc.text("Vault", 14, 20);

  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(`${periodLabel} Report — ${currentProfile.name}`, 14, 28);
  doc.text(data.label, 14, 34);

  doc.autoTable({
    startY: 42,
    head: [["Summary", "Amount"]],
    body: [
      ["Total income", formatAmount(data.income, currency)],
      ["Total expense", formatAmount(data.expense, currency)],
      ["Net", formatAmount(data.income - data.expense, currency)]
    ],
    theme: "striped",
    headStyles: { fillColor: [11, 14, 20] }
  });

  const byCategory = {};
  data.tx.filter((t) => t.type === "expense").forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const catRows = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => [cat, formatAmount(amt, currency)]);

  if (catRows.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Category", "Amount"]],
      body: catRows,
      theme: "striped",
      headStyles: { fillColor: [11, 14, 20] }
    });
  }

  if (currentProfile.mode === "business") {
    const deductible = data.tx
      .filter((t) => t.type === "expense" && t.isTaxDeductible)
      .reduce((s, t) => s + t.amount, 0);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Tax-deductible total", "Amount"]],
      body: [["", formatAmount(deductible, currency)]],
      theme: "striped",
      headStyles: { fillColor: [11, 14, 20] }
    });
  }

  const txRows = data.tx
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [t.date, t.type, t.category, t.note || "", (t.type === "income" ? "+" : "−") + formatAmount(t.amount, currency)]);

  if (txRows.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Date", "Type", "Category", "Note", "Amount"]],
      body: txRows,
      theme: "striped",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [11, 14, 20] }
    });
  } else {
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text("No transactions recorded for this period.", 14, doc.lastAutoTable.finalY + 14);
  }

  doc.save(`vault-${periodLabel.toLowerCase()}-report-${data.endStr}.pdf`);
}

document.getElementById("download-weekly-btn").addEventListener("click", () => {
  if (cachedWeekReport) generateReportPDF(cachedWeekReport, "Weekly");
});
document.getElementById("download-monthly-btn").addEventListener("click", () => {
  if (cachedMonthReport) generateReportPDF(cachedMonthReport, "Monthly");
});
