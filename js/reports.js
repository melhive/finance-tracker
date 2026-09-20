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

async function generateReportPDF(data, periodLabel) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const currency = currentProfile.currency;

  // --- Brand palette, matching the app's own design tokens -----------------------
  const MINT = [0, 217, 163];
  const MINT_DARK_TEXT = [5, 35, 26];
  const ROSE = [251, 78, 106];
  const DARK = [11, 14, 20];
  const MUTED = [124, 135, 156];
  const MINT_TINT = [224, 250, 242];
  const ROSE_TINT = [253, 225, 230];
  const NEUTRAL_TINT = [240, 241, 244];
  const TRACK = [232, 234, 238];

  // jsPDF's built-in fonts (Helvetica etc.) only support a narrow character
  // set — neither the ₱ symbol nor the proper Unicode minus sign used
  // on-screen render correctly in them, which is what produced the garbled
  // "±" seen in earlier exports. Using the plain ISO currency code here
  // sidesteps that entirely, for every currency, rather than guessing which
  // symbols happen to be safe. The app itself is unaffected — this only
  // changes how amounts are printed inside the PDF.
  function fmt(amount) {
    return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function hexToRgb(hex) {
    const c = (hex || "#7C879C").replace("#", "");
    return [parseInt(c.substring(0, 2), 16), parseInt(c.substring(2, 4), 16), parseInt(c.substring(4, 6), 16)];
  }

  const PAGE_W = 210;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  let y;

  function ensureSpace(needed) {
    if (y + needed > 280) {
      doc.addPage();
      y = 20;
    }
  }

  function sectionHeading(text, atY) {
    doc.setFillColor(...MINT);
    doc.rect(MARGIN, atY - 4, 3, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text(text, MARGIN + 6, atY);
  }

  // --- Header band -----------------------------------------------------------------
  doc.setFillColor(...MINT);
  doc.rect(0, 0, PAGE_W, 30, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...MINT_DARK_TEXT);
  doc.text("VAULT", MARGIN, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("FINANCIAL REPORT", MARGIN, 25.5);

  // --- Prepared-for block, with an account-type badge ------------------------------
  y = 42;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Prepared for", MARGIN, y);

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...DARK);
  doc.text(currentProfile.name, MARGIN, y);

  y += 7;
  const badgeLabel = currentProfile.mode === "business" ? "Business Account" : "Personal Account";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const badgeTextW = doc.getTextWidth(badgeLabel);
  const badgeW = badgeTextW + 8;
  doc.setFillColor(...MINT_TINT);
  doc.roundedRect(MARGIN, y - 5, badgeW, 7, 3, 3, "F");
  doc.setTextColor(0, 130, 98);
  doc.text(badgeLabel, MARGIN + 4, y - 0.3);

  // --- Period heading ----------------------------------------------------------------
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...DARK);
  doc.text(`${periodLabel} Report`, MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(data.label, MARGIN, y);

  y += 5;
  doc.setDrawColor(...TRACK);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  // --- Summary stat cards --------------------------------------------------------------
  y += 12;
  const cardW = (CONTENT_W - 14) / 3;
  const cardH = 24;
  const net = data.income - data.expense;
  const cards = [
    { label: "Income", value: fmt(data.income), fill: MINT_TINT, text: [0, 130, 98] },
    { label: "Expense", value: fmt(data.expense), fill: ROSE_TINT, text: [200, 40, 65] },
    { label: "Net", value: `${currency} ${net < 0 ? "-" : ""}${Math.abs(net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, fill: NEUTRAL_TINT, text: net < 0 ? [200, 40, 65] : [0, 130, 98] }
  ];
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + 7);
    doc.setFillColor(...card.fill);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(card.label, x + 4, y + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...card.text);
    doc.text(card.value, x + 4, y + 18, { maxWidth: cardW - 8 });
  });
  y += cardH + 14;

  // --- Financial position: net worth (all-time, not scoped to this report's
  // period) plus goals/debts progress, matching what the dashboard shows. ---
  const allRawRows = await profileDb.transactions.toArray();
  const today = todayStr();
  const allPastTx = (await loadTransactions(allRawRows)).filter((t) => t.date <= today);
  const allIncome = allPastTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const allExpense = allPastTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalOpening = accountsCache.reduce((s, a) => s + (a.openingBalance || 0), 0);
  const currentBalance = totalOpening + allIncome - allExpense;
  const totalDebtOwed = debtsCache.reduce((s, d) => s + d.remainingBalance, 0);
  const netWorth = currentBalance - totalDebtOwed;

  ensureSpace(24);
  sectionHeading("Financial Position", y);
  y += 9;

  doc.setFillColor(...NEUTRAL_TINT);
  doc.roundedRect(MARGIN, y, CONTENT_W, 16, 2, 2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Net Worth (as of today)", MARGIN + 5, y + 6.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...(netWorth < 0 ? [200, 40, 65] : [0, 130, 98]));
  doc.text(
    `${currency} ${netWorth < 0 ? "-" : ""}${Math.abs(netWorth).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    MARGIN + 5,
    y + 13
  );
  y += 22;

  if (goalsCache.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text("Savings Goals", MARGIN, y);
    y += 6;
    goalsCache.forEach((g) => {
      ensureSpace(11);
      const pct = Math.min(Math.round((g.savedAmount / g.targetAmount) * 100), 100);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(g.name, MARGIN, y);
      doc.text(`${pct}%`, PAGE_W - MARGIN, y, { align: "right" });
      y += 3;
      doc.setFillColor(...TRACK);
      doc.roundedRect(MARGIN, y, CONTENT_W, 2.5, 1, 1, "F");
      doc.setFillColor(...hexToRgb(g.color));
      doc.roundedRect(MARGIN, y, Math.max((pct / 100) * CONTENT_W, 3), 2.5, 1, 1, "F");
      y += 8;
    });
    y += 3;
  }

  if (debtsCache.length) {
    ensureSpace(11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text("Debts", MARGIN, y);
    y += 6;
    debtsCache.forEach((d) => {
      ensureSpace(11);
      const pct = window.debtProgressPct(d);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(d.name, MARGIN, y);
      doc.text(`${fmt(d.remainingBalance)} left`, PAGE_W - MARGIN, y, { align: "right" });
      y += 3;
      doc.setFillColor(...TRACK);
      doc.roundedRect(MARGIN, y, CONTENT_W, 2.5, 1, 1, "F");
      doc.setFillColor(...hexToRgb(d.color));
      doc.roundedRect(MARGIN, y, Math.max((pct / 100) * CONTENT_W, 3), 2.5, 1, 1, "F");
      y += 8;
    });
    y += 4;
  }

  // --- Category breakdown, as colored bars matching each category's app color ------
  const byCategory = {};
  data.tx.filter((t) => t.type === "expense").forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  if (catEntries.length) {
    ensureSpace(20);
    sectionHeading("Category Breakdown", y);
    y += 9;

    const maxAmt = catEntries[0][1];
    catEntries.forEach(([catName, amt]) => {
      ensureSpace(11);
      const color = hexToRgb(categoryColor(catName));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK);
      doc.text(catName, MARGIN, y);
      doc.text(fmt(amt), PAGE_W - MARGIN, y, { align: "right" });
      y += 3;
      doc.setFillColor(...TRACK);
      doc.roundedRect(MARGIN, y, CONTENT_W, 2.5, 1, 1, "F");
      const barW = Math.max((amt / maxAmt) * CONTENT_W, 3);
      doc.setFillColor(...color);
      doc.roundedRect(MARGIN, y, barW, 2.5, 1, 1, "F");
      y += 8;
    });
    y += 4;
  }

  // --- Tax-deductible callout (Business profiles only) ------------------------------
  if (currentProfile.mode === "business") {
    const deductible = data.tx
      .filter((t) => t.type === "expense" && t.isTaxDeductible)
      .reduce((s, t) => s + t.amount, 0);
    ensureSpace(24);
    sectionHeading("Tax-Deductible Total", y);
    y += 8;
    doc.setFillColor(...MINT_TINT);
    doc.roundedRect(MARGIN, y, CONTENT_W, 14, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0, 130, 98);
    doc.text(fmt(deductible), MARGIN + 5, y + 9.5);
    y += 22;
  }

  // --- Full transaction list ---------------------------------------------------------
  const txRows = data.tx
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [t.date, t.category, t.note || "", (t.type === "income" ? "+" : "-") + fmt(t.amount)]);

  if (txRows.length) {
    ensureSpace(16);
    sectionHeading("Transactions", y);

    doc.autoTable({
      startY: y + 5,
      margin: { left: MARGIN, right: MARGIN },
      head: [["Date", "Category", "Note", "Amount"]],
      body: txRows,
      theme: "striped",
      styles: { fontSize: 8.5, textColor: DARK },
      headStyles: { fillColor: MINT, textColor: MINT_DARK_TEXT, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 253, 251] },
      columnStyles: { 3: { halign: "right" } },
      didParseCell: (hookData) => {
        if (hookData.section === "body" && hookData.column.index === 3) {
          const raw = String(hookData.cell.raw);
          hookData.cell.styles.textColor = raw.startsWith("+") ? [0, 130, 98] : [200, 40, 65];
        }
      }
    });
  } else {
    ensureSpace(16);
    sectionHeading("Transactions", y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("No transactions recorded for this period.", MARGIN, y + 10);
  }

  // --- Footer, every page --------------------------------------------------------------
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated by Vault · ${new Date().toLocaleDateString()}`, MARGIN, 291);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, 291, { align: "right" });
  }

  doc.save(`vault-${periodLabel.toLowerCase()}-report-${data.endStr}.pdf`);
}

document.getElementById("download-weekly-btn").addEventListener("click", async () => {
  if (cachedWeekReport) await generateReportPDF(cachedWeekReport, "Weekly");
});
document.getElementById("download-monthly-btn").addEventListener("click", async () => {
  if (cachedMonthReport) await generateReportPDF(cachedMonthReport, "Monthly");
});
