// ---------------------------------------------------------------------------
// VAULT — Duplicate detection
// Both CSV import and backup restore are additive by design, which means
// running either one twice would silently double your data. This builds a
// fingerprint set of what's already stored so those flows can skip rows
// that are already here — and, importantly, tell you how many they skipped
// rather than doing it invisibly.
//
// Fingerprint = date + amount (2dp) + type + normalized note. Deliberately
// NOT including category or account: a re-import of the same statement can
// land in a different category, but it's still the same real-world
// transaction. Two genuinely distinct purchases of the same amount, same
// day, same merchant are indistinguishable here — that's the accepted
// tradeoff, and why the UI reports skips instead of hiding them.
// ---------------------------------------------------------------------------

function txFingerprint(date, amount, type, note) {
  const normalizedNote = String(note || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${date}|${Number(amount).toFixed(2)}|${type}|${normalizedNote}`;
}
window.txFingerprint = txFingerprint;

// Builds the set of fingerprints for everything currently in this profile.
// Call once before a bulk operation, then add to it as you insert so
// duplicates *within* the incoming file are caught too.
async function buildExistingFingerprints() {
  const rawRows = await profileDb.transactions.toArray();
  const decoded = await loadTransactions(rawRows);
  const set = new Set();
  decoded.forEach((t) => set.add(txFingerprint(t.date, t.amount, t.type, t.note)));
  return set;
}
window.buildExistingFingerprints = buildExistingFingerprints;
