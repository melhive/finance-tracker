// ---------------------------------------------------------------------------
// VAULT — Categories
// Lets you add new custom categories (with an icon + color) and change the
// icon/color of existing ones. Name and type are locked once a category
// exists, since transactions reference categories by name — renaming would
// orphan every past transaction's display.
// ---------------------------------------------------------------------------

let editingCategoryName = null; // null = adding a new category
let selectedIconChoice = CATEGORY_ICON_CHOICES[0];
let selectedColorChoice = CATEGORY_COLORS[0];
let categoryFormType = "expense";

const categoryFormBackdrop = document.getElementById("category-form-backdrop");

function renderIconPicker() {
  const grid = document.getElementById("icon-picker-grid");
  grid.innerHTML = CATEGORY_ICON_CHOICES.map((icon) =>
    `<button type="button" class="icon-picker-btn interactive ${icon === selectedIconChoice ? "selected" : ""}" data-icon="${icon}">${icon}</button>`
  ).join("");
  grid.querySelectorAll(".icon-picker-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedIconChoice = btn.dataset.icon;
      grid.querySelectorAll(".icon-picker-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
}

function renderColorPicker() {
  const row = document.getElementById("color-picker-row");
  row.innerHTML = CATEGORY_COLORS.map((c) =>
    `<button type="button" class="color-swatch-btn interactive ${c === selectedColorChoice ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`
  ).join("");
  row.querySelectorAll(".color-swatch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedColorChoice = btn.dataset.color;
      row.querySelectorAll(".color-swatch-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
}

function openCategoryForm(existing) {
  const nameInput = document.getElementById("category-name-input");
  if (existing) {
    editingCategoryName = existing.name;
    document.getElementById("category-form-title").textContent = "Edit category";
    nameInput.value = existing.name;
    nameInput.disabled = true;
    document.getElementById("category-type-field").style.display = "none";
    categoryFormType = existing.type;
    selectedIconChoice = existing.icon || categoryIcon(existing.name);
    selectedColorChoice = existing.color;
  } else {
    editingCategoryName = null;
    document.getElementById("category-form-title").textContent = "Add category";
    nameInput.value = "";
    nameInput.disabled = false;
    document.getElementById("category-type-field").style.display = "block";
    categoryFormType = "expense";
    document.querySelectorAll("#category-type-segmented .segment").forEach((s) => s.classList.toggle("active", s.dataset.catType === "expense"));
    selectedIconChoice = CATEGORY_ICON_CHOICES[0];
    selectedColorChoice = CATEGORY_COLORS[0];
  }
  renderIconPicker();
  renderColorPicker();
  categoryFormBackdrop.classList.add("visible");
}

document.querySelectorAll("#category-type-segmented .segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    categoryFormType = btn.dataset.catType;
    document.querySelectorAll("#category-type-segmented .segment").forEach((s) => s.classList.toggle("active", s === btn));
  });
});

document.getElementById("add-category-btn").addEventListener("click", () => openCategoryForm(null));
document.getElementById("category-form-cancel-btn").addEventListener("click", () => categoryFormBackdrop.classList.remove("visible"));

document.getElementById("category-form-save-btn").addEventListener("click", async () => {
  if (editingCategoryName) {
    const existing = categoriesCache.find((c) => c.name === editingCategoryName);
    if (existing) {
      await profileDb.categories.update(existing.id, { icon: selectedIconChoice, color: selectedColorChoice });
    }
  } else {
    const name = document.getElementById("category-name-input").value.trim();
    if (!name) return;
    const duplicate = categoriesCache.some((c) => c.name === name && c.type === categoryFormType);
    if (duplicate) return;
    await profileDb.categories.add({ name, type: categoryFormType, color: selectedColorChoice, icon: selectedIconChoice });
  }

  categoriesCache = await profileDb.categories.toArray();
  categoryFormBackdrop.classList.remove("visible");
  window.refreshCategoriesSettingsUI();
  await refreshAll();
});

window.refreshCategoriesSettingsUI = function () {
  const container = document.getElementById("categories-settings-container");
  const expense = categoriesCache.filter((c) => c.type === "expense");
  const income = categoriesCache.filter((c) => c.type === "income");

  function rowsFor(list) {
    return list.map((c) => `
      <div class="budget-row category-row interactive" data-name="${c.name}">
        <span class="top-cat-label"><span class="tx-icon-badge tx-icon-badge-sm" style="background:${hexToRgba(c.color, 0.16)}; color:${c.color}">${c.icon || categoryIcon(c.name)}</span>${c.name}</span>
        <span class="see-all-link">Edit</span>
      </div>`).join("");
  }

  container.innerHTML =
    `<p class="sheet-subtext">Expense</p>${rowsFor(expense)}` +
    `<p class="sheet-subtext" style="margin-top:12px;">Income</p>${rowsFor(income)}`;

  container.querySelectorAll(".category-row").forEach((row) => {
    row.addEventListener("click", () => {
      const cat = categoriesCache.find((c) => c.name === row.dataset.name);
      if (cat) openCategoryForm(cat);
    });
  });
};
