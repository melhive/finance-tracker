// ---------------------------------------------------------------------------
// VAULT — Profile switcher
// Renders the profile grid, handles creating a new profile via the sheet,
// and switching into a profile's placeholder screen (real dashboard is
// built in the next step, on the same "entered-placeholder" container).
// ---------------------------------------------------------------------------

const profileScreen = document.getElementById("profile-screen");
const profileGrid = document.getElementById("profile-grid");
const addProfileBtn = document.getElementById("add-profile-btn");
const addProfileBackdrop = document.getElementById("add-profile-backdrop");
const nameInput = document.getElementById("profile-name-input");
const modeSegmented = document.getElementById("mode-segmented");
const currencySelect = document.getElementById("profile-currency-select");
const cancelBtn = document.getElementById("cancel-profile-btn");
const createBtn = document.getElementById("create-profile-btn");
const enteredPlaceholder = document.getElementById("app-shell");
const switchProfileBtn = document.getElementById("switch-profile-btn");
const manageProfilesBtn = document.getElementById("manage-profiles-btn");

let selectedMode = "personal";
let manageMode = false;
let pendingProfilePhoto = null;

function initialOf(name) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
window.initialOf = initialOf;

// Deterministic color per profile so the same profile always gets the same
// avatar color, without needing to store it separately.
const AVATAR_COLORS = ["#00D9A3", "#4EA1FB", "#FB4E6A", "#F5B942", "#B18CFF"];
function colorForId(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}
window.colorForId = colorForId;

// Applies a profile's photo (if set) or a colored initial (if not) onto any
// avatar element — used for the header, lockscreen, and profile tiles alike.
function applyAvatar(el, profile) {
  if (profile.photo) {
    el.style.background = `url(${profile.photo}) center/cover no-repeat`;
    el.textContent = "";
  } else {
    el.style.background = colorForId(profile.id);
    el.textContent = initialOf(profile.name);
  }
}
window.applyAvatar = applyAvatar;

// Splits a profile name on its first space so a full name can display as
// a prominent first name with a smaller last name below it. A one-word
// name (or a label like "Business") just renders as-is, unsplit.
function splitName(fullName) {
  const trimmed = (fullName || "").trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, spaceIdx), last: trimmed.slice(spaceIdx + 1).trim() };
}
window.splitName = splitName;

async function renderProfiles() {
  const profiles = await getProfiles();

  profileGrid.querySelectorAll(".profile-tile:not(.add-tile)").forEach((el) => el.remove());

  profiles.forEach((profile) => {
    const tile = document.createElement("button");
    tile.className = "profile-tile interactive";
    const avatarStyle = profile.photo
      ? `background:url(${profile.photo}) center/cover no-repeat;`
      : `background:${colorForId(profile.id)};`;
    const { first, last } = splitName(profile.name);
    tile.innerHTML = `
      <span class="avatar-wrap">
        <span class="avatar-circle" style="${avatarStyle}">${profile.photo ? "" : initialOf(profile.name)}</span>
        <span class="delete-badge interactive" style="display:${manageMode ? "flex" : "none"};" data-id="${profile.id}" data-name="${profile.name}" aria-label="Delete profile">✕</span>
      </span>
      <span class="tile-label">${first}${last ? `<span class="tile-label-last">${last}</span>` : ""}</span>
    `;
    tile.addEventListener("click", (e) => {
      if (manageMode) return; // manage mode only exposes the delete badge
      enterProfile(profile);
    });
    tile.querySelector(".delete-badge").addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteProfileConfirm(profile);
    });
    profileGrid.insertBefore(tile, addProfileBtn);
  });
}

manageProfilesBtn.addEventListener("click", () => {
  manageMode = !manageMode;
  manageProfilesBtn.textContent = manageMode ? "Done" : "Manage profiles";
  document.querySelectorAll(".delete-badge").forEach((b) => (b.style.display = manageMode ? "flex" : "none"));
  addProfileBtn.style.visibility = manageMode ? "hidden" : "visible";
});

// --- Delete profile, with a random confirmation code to avoid accidents ------
const deleteProfileBackdrop = document.getElementById("delete-profile-backdrop");
const deleteProfileCodeInput = document.getElementById("delete-profile-code-input");
const deleteProfileConfirmBtn = document.getElementById("delete-profile-confirm-btn");
let pendingDeleteProfile = null;
let deleteConfirmCode = "";

function randomConfirmCode() {
  return randomLetterCode(4);
}

function openDeleteProfileConfirm(profile) {
  pendingDeleteProfile = profile;
  deleteConfirmCode = randomConfirmCode();
  document.getElementById("delete-profile-warning").textContent =
    `This permanently deletes "${profile.name}" and everything in it. This can't be undone.`;
  document.getElementById("delete-profile-code").textContent = deleteConfirmCode;
  deleteProfileCodeInput.value = "";
  deleteProfileConfirmBtn.disabled = true;
  deleteProfileBackdrop.classList.add("visible");
  setTimeout(() => deleteProfileCodeInput.focus(), 300);
}

deleteProfileCodeInput.addEventListener("input", () => {
  deleteProfileConfirmBtn.disabled = deleteProfileCodeInput.value.trim().toUpperCase() !== deleteConfirmCode;
});

document.getElementById("delete-profile-cancel-btn").addEventListener("click", () => {
  deleteProfileBackdrop.classList.remove("visible");
  pendingDeleteProfile = null;
});
deleteProfileBackdrop.addEventListener("click", (e) => {
  if (e.target === deleteProfileBackdrop) {
    deleteProfileBackdrop.classList.remove("visible");
    pendingDeleteProfile = null;
  }
});

deleteProfileConfirmBtn.addEventListener("click", async () => {
  if (!pendingDeleteProfile) return;
  await deleteProfileEntirely(pendingDeleteProfile.id);
  if (localStorage.getItem("vault-active-profile") === String(pendingDeleteProfile.id)) {
    localStorage.removeItem("vault-active-profile");
  }
  pendingDeleteProfile = null;
  deleteProfileBackdrop.classList.remove("visible");
  await renderProfiles();
  document.querySelectorAll(".delete-badge").forEach((b) => (b.style.display = manageMode ? "flex" : "none"));
});

function enterProfile(profile) {
  localStorage.setItem("vault-active-profile", profile.id);

  if (profile.hasPassword) {
    window.showLockscreen(profile);
    return;
  }

  profileScreen.style.display = "none";
  enteredPlaceholder.classList.add("visible");

  applyAvatar(document.getElementById("entered-avatar"), profile);
  document.getElementById("entered-name").textContent = profile.name;
  document.getElementById("entered-meta").textContent =
    profile.mode === "business" ? "Business Account" : "Personal Account";

  window.enterDashboard(profile, null);
}

switchProfileBtn.addEventListener("click", () => {
  enteredPlaceholder.classList.remove("visible");
  profileScreen.style.display = "flex";
  localStorage.removeItem("vault-active-profile");
});

// --- Add-profile sheet --------------------------------------------------------
const addProfileAvatarBtn = document.getElementById("add-profile-avatar-btn");
const addProfileAvatarPreview = document.getElementById("add-profile-avatar-preview");

addProfileBtn.addEventListener("click", () => {
  nameInput.value = "";
  selectedMode = "personal";
  pendingProfilePhoto = null;
  addProfileAvatarPreview.style.background = "";
  addProfileAvatarPreview.textContent = "+";
  document.getElementById("profile-starting-balance-input").value = "";
  modeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s.dataset.mode === "personal"));
  addProfileBackdrop.classList.add("visible");
  setTimeout(() => nameInput.focus(), 300);
});

addProfileAvatarBtn.addEventListener("click", () => {
  window.openPhotoPicker((dataUrl) => {
    pendingProfilePhoto = dataUrl;
    addProfileAvatarPreview.style.background = `url(${dataUrl}) center/cover no-repeat`;
    addProfileAvatarPreview.textContent = "";
  });
});

cancelBtn.addEventListener("click", () => addProfileBackdrop.classList.remove("visible"));
addProfileBackdrop.addEventListener("click", (e) => {
  if (e.target === addProfileBackdrop) addProfileBackdrop.classList.remove("visible");
});

modeSegmented.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedMode = btn.dataset.mode;
    modeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  });
});

createBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const startingBalance = parseFloat(document.getElementById("profile-starting-balance-input").value) || 0;
  await createProfile({ name, mode: selectedMode, currency: currencySelect.value, photo: pendingProfilePhoto, startingBalance });
  addProfileBackdrop.classList.remove("visible");
  await renderProfiles();
});

// --- Change photo for an already-entered profile, from Settings ---------------
const changeProfilePhotoBtn = document.getElementById("change-profile-photo-btn");
if (changeProfilePhotoBtn) {
  changeProfilePhotoBtn.addEventListener("click", () => {
    window.openPhotoPicker(async (dataUrl) => {
      await shellDB.profiles.update(currentProfile.id, { photo: dataUrl });
      currentProfile.photo = dataUrl;
      applyAvatar(document.getElementById("entered-avatar"), currentProfile);
    });
  });
}

// --- Rename the already-entered profile, from Settings -------------------------
const renameProfileBtn = document.getElementById("rename-profile-btn");
const profileRenameBackdrop = document.getElementById("profile-rename-backdrop");
if (renameProfileBtn) {
  renameProfileBtn.addEventListener("click", () => {
    document.getElementById("profile-rename-input").value = currentProfile.name;
    profileRenameBackdrop.classList.add("visible");
    setTimeout(() => document.getElementById("profile-rename-input").focus(), 250);
  });

  document.getElementById("profile-rename-cancel-btn").addEventListener("click", () =>
    profileRenameBackdrop.classList.remove("visible")
  );

  document.getElementById("profile-rename-save-btn").addEventListener("click", async () => {
    const name = document.getElementById("profile-rename-input").value.trim();
    if (!name) return;
    await shellDB.profiles.update(currentProfile.id, { name });
    currentProfile.name = name;
    document.getElementById("entered-name").textContent = name;
    profileRenameBackdrop.classList.remove("visible");
  });
}

// --- Init ---------------------------------------------------------------------
renderProfiles().then(() => {
  // If launched via a home-screen shortcut (e.g. "Add expense"), skip
  // straight to the last-used profile instead of making the user tap
  // through the switcher — the shortcut only saves time if it actually does.
  if (typeof pendingShortcutAction !== "undefined" && pendingShortcutAction) {
    const lastId = localStorage.getItem("vault-active-profile");
    if (lastId) {
      getProfiles().then((profiles) => {
        const profile = profiles.find((p) => p.id === Number(lastId));
        if (profile) enterProfile(profile);
      });
    }
  }
});
