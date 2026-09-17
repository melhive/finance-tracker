// ---------------------------------------------------------------------------
// VAULT — Tags
// Separate from categories: a category answers "what kind of expense"
// (Food, Transport); a tag answers a second, independent question, like
// "which trip" or "which project" — a transaction can carry several.
// Creatable both from Settings and inline from the add-transaction sheet,
// since that's usually when you actually think to make one.
// ---------------------------------------------------------------------------

let selectedTagIds = new Set();
let pendingTagCreatedCallback = null;

window.getSelectedTagIds = () => [...selectedTagIds];

window.setSelectedTagIds = function (ids) {
  selectedTagIds = new Set(ids || []);
  renderTagChipPickerUI();
};

function renderTagChipPickerUI() {
  const row = document.getElementById("tx-tag-chip-row");
  if (tagsCache.length === 0) {
    row.innerHTML = `<span class="sheet-subtext" style="margin:0;">No tags yet — add one below.</span>`;
    return;
  }
  row.innerHTML = tagsCache.map((t) => {
    const isSelected = selectedTagIds.has(t.id);
    const style = isSelected ? `background:${t.color}; color:#05231A;` : "";
    return `<button type="button" class="tag-chip interactive ${isSelected ? "selected" : ""}" style="${style}" data-tag-id="${t.id}">${t.name}</button>`;
  }).join("");

  row.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = Number(chip.dataset.tagId);
      if (selectedTagIds.has(id)) selectedTagIds.delete(id);
      else selectedTagIds.add(id);
      renderTagChipPickerUI();
    });
  });
}
window.renderTagChipPicker = renderTagChipPickerUI;

// --- Add tag sheet, usable both from Settings and inline mid-transaction ------
const tagFormBackdrop = document.getElementById("tag-form-backdrop");
let selectedTagColor = CATEGORY_COLORS[0];

function openTagForm(onCreated) {
  pendingTagCreatedCallback = onCreated || null;
  document.getElementById("tag-name-input").value = "";
  selectedTagColor = CATEGORY_COLORS[0];
  renderColorRow(document.getElementById("tag-color-picker-row"), selectedTagColor, (v) => (selectedTagColor = v));
  tagFormBackdrop.classList.add("visible");
  setTimeout(() => document.getElementById("tag-name-input").focus(), 250);
}
window.openTagForm = openTagForm;

document.getElementById("add-tag-btn").addEventListener("click", () => openTagForm(null));
document.getElementById("tx-new-tag-btn").addEventListener("click", () => {
  openTagForm((newTag) => {
    selectedTagIds.add(newTag.id);
    renderTagChipPickerUI();
  });
});

document.getElementById("tag-form-cancel-btn").addEventListener("click", () => {
  tagFormBackdrop.classList.remove("visible");
  pendingTagCreatedCallback = null;
});

document.getElementById("tag-form-save-btn").addEventListener("click", async () => {
  const name = document.getElementById("tag-name-input").value.trim();
  if (!name) return;
  const id = await profileDb.tags.add({ name, color: selectedTagColor });
  tagsCache = await profileDb.tags.toArray();
  tagFormBackdrop.classList.remove("visible");

  window.refreshTagsSettingsUI();
  renderTagChipPickerUI();

  const cb = pendingTagCreatedCallback;
  pendingTagCreatedCallback = null;
  if (cb) cb({ id, name, color: selectedTagColor });
});

// --- Settings list ----------------------------------------------------------------
window.refreshTagsSettingsUI = function () {
  const container = document.getElementById("tags-settings-container");
  if (tagsCache.length === 0) {
    container.innerHTML = `<p class="empty-state">No tags yet.</p>`;
    return;
  }
  container.innerHTML = tagsCache.map((t) => `
    <div class="budget-row">
      <span class="tag-chip" style="background:${t.color}; color:#05231A; border-color:transparent;">${t.name}</span>
      <button class="btn-secondary interactive danger-action tag-delete-btn" data-tag-id="${t.id}">Delete</button>
    </div>`).join("");

  container.querySelectorAll(".tag-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      armTapTwice(btn, "Delete", async () => {
        await profileDb.tags.delete(Number(btn.dataset.tagId));
        tagsCache = await profileDb.tags.toArray();
        window.refreshTagsSettingsUI();
      });
    });
  });
};

// Renders the small colored pills shown under a transaction row's note.
function tagPillsHTML(tagIds) {
  if (!tagIds || tagIds.length === 0) return "";
  const pills = tagIds
    .map((id) => tagsCache.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `<span class="tx-tag-pill" style="background:${hexToRgba(t.color, 0.18)}; color:${t.color}">${t.name}</span>`)
    .join("");
  return pills ? `<div class="tx-tag-pills">${pills}</div>` : "";
}
window.tagPillsHTML = tagPillsHTML;
