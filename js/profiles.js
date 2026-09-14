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

let selectedMode = "personal";

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

async function renderProfiles() {
  const profiles = await getProfiles();

  profileGrid.querySelectorAll(".profile-tile:not(.add-tile)").forEach((el) => el.remove());

  profiles.forEach((profile) => {
    const tile = document.createElement("button");
    tile.className = "profile-tile interactive";
    tile.innerHTML = `
      <span class="avatar-circle" style="background:${colorForId(profile.id)}">${initialOf(profile.name)}</span>
      <span class="tile-label">${profile.name}</span>
    `;
    tile.addEventListener("click", () => enterProfile(profile));
    profileGrid.insertBefore(tile, addProfileBtn);
  });
}

function enterProfile(profile) {
  localStorage.setItem("vault-active-profile", profile.id);

  if (profile.hasPassword) {
    window.showLockscreen(profile);
    return;
  }

  profileScreen.style.display = "none";
  enteredPlaceholder.classList.add("visible");

  document.getElementById("entered-avatar").style.background = colorForId(profile.id);
  document.getElementById("entered-avatar").textContent = initialOf(profile.name);
  document.getElementById("entered-name").textContent = profile.name;
  document.getElementById("entered-meta").textContent =
    `${profile.mode === "business" ? "Business" : "Personal"} · ${profile.currency}`;

  window.enterDashboard(profile, null);
}

switchProfileBtn.addEventListener("click", () => {
  enteredPlaceholder.classList.remove("visible");
  profileScreen.style.display = "flex";
  localStorage.removeItem("vault-active-profile");
});

// --- Add-profile sheet --------------------------------------------------------
addProfileBtn.addEventListener("click", () => {
  nameInput.value = "";
  selectedMode = "personal";
  modeSegmented.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s.dataset.mode === "personal"));
  addProfileBackdrop.classList.add("visible");
  setTimeout(() => nameInput.focus(), 300);
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
  await createProfile({ name, mode: selectedMode, currency: currencySelect.value });
  addProfileBackdrop.classList.remove("visible");
  await renderProfiles();
});

// --- Init ---------------------------------------------------------------------
renderProfiles();
