// ---------------------------------------------------------------------------
// VAULT — Security module
// Lockscreen unlock, set/change/remove password, and the "forgot password"
// recovery-phrase flow. Relies on js/crypto.js for the actual cryptography
// and shares `currentProfile` / `profileDb` / `categoriesCache` from
// dashboard.js (classic scripts on one page share a global scope).
// ---------------------------------------------------------------------------

let pendingProfile = null;   // profile currently at the lockscreen
let recoveryPhase = "verify"; // "verify" | "setPassword" — state for the forgot-password sheet
let recoveryDek = null;      // DEK recovered via mnemonic, held only until a new password is set
let passwordFormMode = "set"; // "set" | "change"

const lockscreen = document.getElementById("lockscreen");
const lockPad = document.getElementById("lock-pad");
const lockPasswordInput = document.getElementById("lock-password-input");
const lockError = document.getElementById("lock-error");

// --- Lockscreen ---------------------------------------------------------------
window.showLockscreen = function (profile) {
  pendingProfile = profile;
  document.getElementById("lock-profile-name").textContent = profile.name;
  const avatar = document.getElementById("lock-avatar");
  avatar.style.background = window.colorForId(profile.id);
  avatar.textContent = window.initialOf(profile.name);
  lockPasswordInput.value = "";
  lockError.textContent = "";
  lockscreen.classList.add("visible");
  setTimeout(() => lockPasswordInput.focus(), 350);
};

function triggerLockShake(message) {
  lockPad.classList.remove("shake");
  void lockPad.offsetWidth; // restart CSS animation
  lockPad.classList.add("shake");
  lockError.textContent = message;
  lockPasswordInput.value = "";
  lockPasswordInput.focus();
}

function proceedToDashboard(profile, dek) {
  document.getElementById("profile-screen").style.display = "none";
  document.getElementById("app-shell").classList.add("visible");
  document.getElementById("entered-avatar").style.background = window.colorForId(profile.id);
  document.getElementById("entered-avatar").textContent = window.initialOf(profile.name);
  document.getElementById("entered-name").textContent = profile.name;
  document.getElementById("entered-meta").textContent =
    `${profile.mode === "business" ? "Business" : "Personal"} · ${profile.currency}`;
  window.enterDashboard(profile, dek);
}

async function attemptUnlock() {
  const password = lockPasswordInput.value;
  if (!password) return;
  try {
    const salt = new Uint8Array(base64ToBuf(pendingProfile.passwordSalt));
    const kek = await deriveKeyFromSecret(password, salt);
    const dek = await unwrapDEK(pendingProfile.passwordWrapped, kek);
    lockscreen.classList.remove("visible");
    await window.showUnlockTransition();
    proceedToDashboard(pendingProfile, dek);
  } catch (e) {
    triggerLockShake("Incorrect password.");
  }
}

document.getElementById("lock-unlock-btn").addEventListener("click", attemptUnlock);
lockPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptUnlock();
});

// --- Forgot password → recovery-phrase unlock -----------------------------------
const recoveryUnlockBackdrop = document.getElementById("recovery-unlock-backdrop");
const recoveryWordsInput = document.getElementById("recovery-words-input");
const recoveryError = document.getElementById("recovery-error");
const recoveryNewPasswordFields = document.getElementById("recovery-new-password-fields");
const recoveryContinueBtn = document.getElementById("recovery-continue-btn");

function resetRecoverySheet() {
  recoveryPhase = "verify";
  recoveryDek = null;
  recoveryWordsInput.value = "";
  recoveryError.textContent = "";
  recoveryNewPasswordFields.style.display = "none";
  document.getElementById("recovery-new-password").value = "";
  document.getElementById("recovery-confirm-password").value = "";
  recoveryContinueBtn.textContent = "Continue";
}

document.getElementById("lock-forgot-btn").addEventListener("click", () => {
  lockscreen.classList.remove("visible");
  resetRecoverySheet();
  recoveryUnlockBackdrop.classList.add("visible");
});

document.getElementById("recovery-cancel-btn").addEventListener("click", () => {
  recoveryUnlockBackdrop.classList.remove("visible");
  resetRecoverySheet();
  if (pendingProfile) window.showLockscreen(pendingProfile);
});

recoveryContinueBtn.addEventListener("click", async () => {
  if (recoveryPhase === "verify") {
    const words = recoveryWordsInput.value.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      recoveryError.textContent = "Please enter exactly 12 words.";
      return;
    }
    try {
      const salt = new Uint8Array(base64ToBuf(pendingProfile.recoverySalt));
      const kek = await deriveKeyFromSecret(normalizeMnemonic(words), salt);
      recoveryDek = await unwrapDEK(pendingProfile.recoveryWrapped, kek);
      recoveryPhase = "setPassword";
      recoveryError.textContent = "";
      recoveryNewPasswordFields.style.display = "block";
      recoveryContinueBtn.textContent = "Save new password";
    } catch (e) {
      recoveryError.textContent = "Those words don't match. Please check and try again.";
    }
    return;
  }

  // recoveryPhase === "setPassword"
  const newPw = document.getElementById("recovery-new-password").value;
  const confirmPw = document.getElementById("recovery-confirm-password").value;
  if (newPw.length < 6) {
    recoveryError.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (newPw !== confirmPw) {
    recoveryError.textContent = "Passwords do not match.";
    return;
  }

  const newSalt = generateSalt();
  const newKek = await deriveKeyFromSecret(newPw, newSalt);
  const wrapped = await wrapDEK(recoveryDek, newKek);
  const passwordSalt = bufToBase64(newSalt);

  await updatePasswordWrap(pendingProfile.id, { passwordSalt, passwordWrapped: wrapped });
  pendingProfile.passwordSalt = passwordSalt;
  pendingProfile.passwordWrapped = wrapped;

  const dek = recoveryDek;
  recoveryUnlockBackdrop.classList.remove("visible");
  resetRecoverySheet();
  await window.showUnlockTransition();
  proceedToDashboard(pendingProfile, dek);
});

// --- Settings tab: render Set/Change/Remove password controls -----------------
window.refreshSecuritySettingsUI = function (profile) {
  const container = document.getElementById("security-settings-container");
  if (profile.hasPassword) {
    container.innerHTML = `
      <button class="btn-secondary interactive settings-action" id="change-password-btn">Change password</button>
      <button class="btn-secondary interactive settings-action danger-action" id="remove-password-btn">Remove password</button>
    `;
    document.getElementById("change-password-btn").addEventListener("click", () => openPasswordForm("change"));
    document.getElementById("remove-password-btn").addEventListener("click", openRemovePasswordSheet);
  } else {
    container.innerHTML = `<button class="btn-primary interactive settings-action" id="set-password-btn">Set password</button>`;
    document.getElementById("set-password-btn").addEventListener("click", () => openPasswordForm("set"));
  }
};

// --- Set / change password sheet ------------------------------------------------
const passwordFormBackdrop = document.getElementById("password-form-backdrop");
const currentPasswordField = document.getElementById("current-password-field");
const passwordFormError = document.getElementById("password-form-error");

function openPasswordForm(mode) {
  passwordFormMode = mode;
  document.getElementById("password-form-title").textContent = mode === "change" ? "Change password" : "Set password";
  currentPasswordField.style.display = mode === "change" ? "block" : "none";
  document.getElementById("current-password-input").value = "";
  document.getElementById("new-password-input").value = "";
  document.getElementById("confirm-password-input").value = "";
  passwordFormError.textContent = "";
  passwordFormBackdrop.classList.add("visible");
}

document.getElementById("password-form-cancel-btn").addEventListener("click", () =>
  passwordFormBackdrop.classList.remove("visible")
);

document.getElementById("password-form-submit-btn").addEventListener("click", async () => {
  passwordFormError.textContent = "";
  const newPw = document.getElementById("new-password-input").value;
  const confirmPw = document.getElementById("confirm-password-input").value;

  if (newPw.length < 6) {
    passwordFormError.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (newPw !== confirmPw) {
    passwordFormError.textContent = "Passwords do not match.";
    return;
  }

  let dek;
  if (passwordFormMode === "change") {
    const currentPw = document.getElementById("current-password-input").value;
    try {
      const salt = new Uint8Array(base64ToBuf(currentProfile.passwordSalt));
      const kek = await deriveKeyFromSecret(currentPw, salt);
      dek = await unwrapDEK(currentProfile.passwordWrapped, kek);
    } catch (e) {
      passwordFormError.textContent = "Incorrect current password.";
      return;
    }
  } else {
    dek = await generateDEK();
    // Migrate any existing plaintext transactions to encrypted, now that
    // this profile is getting its first password.
    const rawRows = await profileDb.transactions.toArray();
    for (const row of rawRows) {
      const fields = JSON.parse(row.payload);
      const encPayload = await encryptJSON(fields, dek);
      await profileDb.transactions.update(row.id, { payload: encPayload });
    }
  }

  const newSalt = generateSalt();
  const newKek = await deriveKeyFromSecret(newPw, newSalt);
  const wrapped = await wrapDEK(dek, newKek);
  const passwordSalt = bufToBase64(newSalt);

  if (passwordFormMode === "set") {
    const mnemonicWords = generateMnemonic();
    const recoverySaltBytes = generateSalt();
    const recoveryKek = await deriveKeyFromSecret(normalizeMnemonic(mnemonicWords), recoverySaltBytes);
    const recoveryWrapped = await wrapDEK(dek, recoveryKek);
    const recoverySalt = bufToBase64(recoverySaltBytes);

    await setProfileSecurity(currentProfile.id, {
      passwordSalt,
      passwordWrapped: wrapped,
      recoverySalt,
      recoveryWrapped
    });

    currentProfile.hasPassword = true;
    currentProfile.passwordSalt = passwordSalt;
    currentProfile.passwordWrapped = wrapped;
    currentProfile.recoverySalt = recoverySalt;
    currentProfile.recoveryWrapped = recoveryWrapped;
    window.currentDEK = dek;

    passwordFormBackdrop.classList.remove("visible");
    showRecoveryWordsDisplay(mnemonicWords);
  } else {
    await updatePasswordWrap(currentProfile.id, { passwordSalt, passwordWrapped: wrapped });
    currentProfile.passwordSalt = passwordSalt;
    currentProfile.passwordWrapped = wrapped;
    passwordFormBackdrop.classList.remove("visible");
  }

  window.refreshSecuritySettingsUI(currentProfile);
});

// --- Recovery words display (shown once, right after setting a password) ------
const recoveryDisplayBackdrop = document.getElementById("recovery-display-backdrop");
const recoverySavedCheckbox = document.getElementById("recovery-saved-checkbox");
const recoveryDisplayContinueBtn = document.getElementById("recovery-display-continue-btn");

function showRecoveryWordsDisplay(words) {
  const grid = document.getElementById("recovery-grid");
  grid.innerHTML = words.map((w, i) => `<div class="recovery-word"><span>${i + 1}</span>${w}</div>`).join("");
  recoverySavedCheckbox.checked = false;
  recoveryDisplayContinueBtn.disabled = true;
  recoveryDisplayBackdrop.classList.add("visible");
}

recoverySavedCheckbox.addEventListener("change", () => {
  recoveryDisplayContinueBtn.disabled = !recoverySavedCheckbox.checked;
});

recoveryDisplayContinueBtn.addEventListener("click", async () => {
  recoveryDisplayBackdrop.classList.remove("visible");
  await refreshAll();
});

// --- Remove password ---------------------------------------------------------
const removePasswordBackdrop = document.getElementById("remove-password-backdrop");
const removePasswordError = document.getElementById("remove-password-error");

function openRemovePasswordSheet() {
  document.getElementById("remove-password-input").value = "";
  removePasswordError.textContent = "";
  removePasswordBackdrop.classList.add("visible");
}

document.getElementById("remove-password-cancel-btn").addEventListener("click", () =>
  removePasswordBackdrop.classList.remove("visible")
);

document.getElementById("remove-password-confirm-btn").addEventListener("click", async () => {
  const password = document.getElementById("remove-password-input").value;
  try {
    const salt = new Uint8Array(base64ToBuf(currentProfile.passwordSalt));
    const kek = await deriveKeyFromSecret(password, salt);
    const dek = await unwrapDEK(currentProfile.passwordWrapped, kek);

    const rawRows = await profileDb.transactions.toArray();
    for (const row of rawRows) {
      const fields = await decryptJSON(row.payload, dek);
      await profileDb.transactions.update(row.id, { payload: JSON.stringify(fields) });
    }

    await clearProfileSecurity(currentProfile.id);
    currentProfile.hasPassword = false;
    currentProfile.passwordSalt = null;
    currentProfile.passwordWrapped = null;
    currentProfile.recoverySalt = null;
    currentProfile.recoveryWrapped = null;
    window.currentDEK = null;

    removePasswordBackdrop.classList.remove("visible");
    window.refreshSecuritySettingsUI(currentProfile);
    await refreshAll();
  } catch (e) {
    removePasswordError.textContent = "Incorrect password.";
  }
});
