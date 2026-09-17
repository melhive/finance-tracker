// ---------------------------------------------------------------------------
// VAULT — Delete confirmation
//
// Two tiers, deliberately. The rule:
//
//   TIER 1 — type a code. For anything that destroys many records at once
//   and can't be undone: a whole profile, an account, or a transaction
//   (which is real historical data you may not be able to reconstruct).
//
//   TIER 2 — tap twice. For single configuration items that are cheap to
//   recreate and destroy no history: a category, tag, savings goal, or
//   debt. A code here would be friction with nothing behind it.
//
// Both live here so there's one implementation of each rather than a copy
// per feature — the previous per-module copies had drifted apart in small
// ways (different timeouts, different reset behavior).
// ---------------------------------------------------------------------------

// Tier 1 code alphabets. Letters skip I and O so they can't be misread as
// 1 and 0 in the confirmation prompt.
function randomLetterCode(length = 4) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < length; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}
window.randomLetterCode = randomLetterCode;

function randomDigitCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
}
window.randomDigitCode = randomDigitCode;

/**
 * Tier 2: arms a button on first tap, runs onConfirm on the second tap
 * within the timeout window, then disarms itself.
 *
 * Usage: armTapTwice(btn, "Delete", async () => { ...do the delete... })
 * Returns true if this tap was the confirming one.
 */
function armTapTwice(btn, restingLabel, onConfirm, timeoutMs = 3000) {
  if (btn.dataset.armed === "true") {
    disarmTapTwice(btn, restingLabel);
    onConfirm();
    return true;
  }
  btn.dataset.armed = "true";
  btn.textContent = "Tap again to confirm";
  clearTimeout(Number(btn.dataset.armTimer));
  btn.dataset.armTimer = String(setTimeout(() => disarmTapTwice(btn, restingLabel), timeoutMs));
  return false;
}
window.armTapTwice = armTapTwice;

function disarmTapTwice(btn, restingLabel) {
  clearTimeout(Number(btn.dataset.armTimer));
  btn.dataset.armed = "";
  btn.dataset.armTimer = "";
  btn.textContent = restingLabel;
}
window.disarmTapTwice = disarmTapTwice;
