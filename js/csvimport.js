// ---------------------------------------------------------------------------
// VAULT — CSV import
// The closest thing to bank sync this app will ever have, on purpose: no
// server round-trip, just a file you already have (export from your bank
// or e-wallet's app/website) parsed entirely on-device. Handles one signed
// "Amount" column — separate debit/credit columns aren't supported, since
// that would need a second mapping step for a format that's less common.
// ---------------------------------------------------------------------------

const importScreen = document.getElementById("import-screen");
let importHeaders = [];
let importRows = [];

// --- Minimal CSV parser: handles quoted fields, embedded commas/newlines,
// and "" as an escaped quote. Good enough for real-world bank exports
// without pulling in a library. ------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function parseImportDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // assume MM/DD/YYYY, the common export format
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseImportAmount(raw) {
  if (!raw) return NaN;
  return parseFloat(String(raw).replace(/[^0-9.\-]/g, ""));
}

function guessColumnIndex(headers, keywords) {
  const idx = headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
  return idx >= 0 ? idx : 0;
}

// --- Step 1: pick file -----------------------------------------------------------
function openImportScreen() {
  document.getElementById("import-step-pick").style.display = "block";
  document.getElementById("import-step-map").style.display = "none";
  document.getElementById("import-status").textContent = "";
  importScreen.classList.add("visible");
}

document.getElementById("open-import-btn").addEventListener("click", openImportScreen);
document.getElementById("import-back-btn").addEventListener("click", () => importScreen.classList.remove("visible"));
document.getElementById("import-pick-file-btn").addEventListener("click", () => document.getElementById("import-file-input").click());

document.getElementById("import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const text = await file.text();
  const parsed = parseCSV(text);
  if (parsed.length < 2) {
    document.getElementById("import-status").textContent = "That file doesn't look like it has any data rows.";
    return;
  }
  importHeaders = parsed[0];
  importRows = parsed.slice(1);
  await openImportMapStep();
});

// --- Step 2: map columns ----------------------------------------------------------
let importSignMode = "neg-expense";
let importExistingFingerprints = new Set();

async function openImportMapStep() {
  document.getElementById("import-step-pick").style.display = "none";
  document.getElementById("import-step-map").style.display = "block";

  // Snapshot what's already stored so the preview can warn about rows that
  // are already here before anything gets written.
  importExistingFingerprints = await buildExistingFingerprints();

  const dateSelect = document.getElementById("import-date-col");
  const amountSelect = document.getElementById("import-amount-col");
  const noteSelect = document.getElementById("import-note-col");
  const optionsHTML = importHeaders.map((h, i) => `<option value="${i}">${h || `Column ${i + 1}`}</option>`).join("");

  dateSelect.innerHTML = optionsHTML;
  amountSelect.innerHTML = optionsHTML;
  noteSelect.innerHTML = `<option value="-1">None</option>` + optionsHTML;

  dateSelect.value = guessColumnIndex(importHeaders, ["date", "posted", "transaction date"]);
  amountSelect.value = guessColumnIndex(importHeaders, ["amount", "value"]);
  const noteGuess = importHeaders.findIndex((h) => ["description", "memo", "note", "detail", "merchant"].some((k) => h.toLowerCase().includes(k)));
  noteSelect.value = noteGuess >= 0 ? noteGuess : -1;

  importSignMode = "neg-expense";
  document.querySelectorAll("#import-sign-segmented .segment").forEach((s) => s.classList.toggle("active", s.dataset.sign === "neg-expense"));

  const accountSelect = document.getElementById("import-account-select");
  accountSelect.innerHTML = accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");

  const categorySelect = document.getElementById("import-category-select");
  categorySelect.innerHTML = categoriesCache.map((c) => `<option value="${c.id}">${c.icon || ""} ${c.name} (${c.type})</option>`).join("");

  document.getElementById("import-row-count").textContent = `${importRows.length} row${importRows.length === 1 ? "" : "s"} found.`;
  renderImportPreview();
}

document.querySelectorAll("#import-sign-segmented .segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    importSignMode = btn.dataset.sign;
    document.querySelectorAll("#import-sign-segmented .segment").forEach((s) => s.classList.toggle("active", s === btn));
    renderImportPreview();
  });
});
["import-date-col", "import-amount-col", "import-note-col"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderImportPreview)
);

function interpretRow(row) {
  const dateCol = Number(document.getElementById("import-date-col").value);
  const amountCol = Number(document.getElementById("import-amount-col").value);
  const noteCol = Number(document.getElementById("import-note-col").value);

  const date = parseImportDate(row[dateCol]);
  const rawAmount = parseImportAmount(row[amountCol]);
  const note = noteCol >= 0 ? (row[noteCol] || "").trim() : "";

  if (!date || isNaN(rawAmount) || rawAmount === 0) return null;

  const isNegative = rawAmount < 0;
  const type = importSignMode === "neg-expense"
    ? (isNegative ? "expense" : "income")
    : (isNegative ? "income" : "expense");

  return { date, amount: Math.abs(rawAmount), type, note };
}

function renderImportPreview() {
  const container = document.getElementById("import-preview-table");

  // Walk every row once, tracking fingerprints as we go so duplicates
  // *within this file* are counted too, not just clashes with stored data.
  const seen = new Set(importExistingFingerprints);
  let validCount = 0;
  let dupCount = 0;
  const rowFlags = importRows.map((row) => {
    const r = interpretRow(row);
    if (!r) return { row: null };
    const fp = txFingerprint(r.date, r.amount, r.type, r.note);
    const isDup = seen.has(fp);
    if (isDup) dupCount++;
    else { seen.add(fp); validCount++; }
    return { row: r, isDup };
  });

  const rowsHTML = rowFlags.slice(0, 5).map((f) => {
    if (!f.row) return `<div class="import-preview-row skipped">Couldn't read this row — will be skipped</div>`;
    const r = f.row;
    const sign = r.type === "income" ? "+" : "−";
    const dupTag = f.isDup ? `<span class="import-dup-tag">already imported</span>` : "";
    return `<div class="import-preview-row ${f.isDup ? "duplicate" : ""}"><span>${r.date}</span><span>${r.note || "—"}${dupTag}</span><span class="${r.type === "income" ? "split-income" : "split-expense"}">${sign}${r.amount.toFixed(2)}</span></div>`;
  }).join("");

  container.innerHTML = `<div class="import-preview-header">Preview (first 5 rows)</div>${rowsHTML}`;

  let summary = `${importRows.length} row${importRows.length === 1 ? "" : "s"} found — ${validCount} to import`;
  if (dupCount) summary += `, ${dupCount} already here (will be skipped)`;
  summary += ".";
  document.getElementById("import-row-count").textContent = summary;
}

document.getElementById("import-cancel-btn").addEventListener("click", () => {
  document.getElementById("import-step-map").style.display = "none";
  document.getElementById("import-step-pick").style.display = "block";
});

document.getElementById("import-confirm-btn").addEventListener("click", async () => {
  const accountId = Number(document.getElementById("import-account-select").value);
  const chosenCategory = categoriesCache.find((c) => c.id === Number(document.getElementById("import-category-select").value));

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const seen = await buildExistingFingerprints();

  for (const row of importRows) {
    const interpreted = interpretRow(row);
    if (!interpreted) { skipped++; continue; }

    const fp = txFingerprint(interpreted.date, interpreted.amount, interpreted.type, interpreted.note);
    if (seen.has(fp)) { duplicates++; continue; }
    seen.add(fp);

    // Only use the chosen category if its type actually matches this row —
    // a bank CSV usually mixes deposits and withdrawals, and forcing an
    // expense category onto an income row would be actively misleading.
    let categoryName;
    if (chosenCategory && chosenCategory.type === interpreted.type) {
      categoryName = chosenCategory.name;
    } else {
      const fallback = categoriesCache.find((c) => c.type === interpreted.type && c.name === "Other") ||
        categoriesCache.find((c) => c.type === interpreted.type);
      categoryName = fallback ? fallback.name : "Other";
    }

    const fields = {
      type: interpreted.type,
      amount: interpreted.amount,
      category: categoryName,
      accountId,
      note: interpreted.note,
      isTaxDeductible: false,
      receiptImage: null,
      tags: []
    };
    const payload = await encodeTx(fields);
    await profileDb.transactions.add({ date: interpreted.date, payload });
    imported++;
  }

  let statusMsg = `Imported ${imported} transaction${imported === 1 ? "" : "s"}`;
  if (duplicates) statusMsg += `, skipped ${duplicates} already in your records`;
  if (skipped) statusMsg += `, skipped ${skipped} row${skipped === 1 ? "" : "s"} that couldn't be read`;
  document.getElementById("import-status").textContent = statusMsg + ".";
  document.getElementById("import-step-map").style.display = "none";
  document.getElementById("import-step-pick").style.display = "block";
  await refreshAll();
});
