// ---------------------------------------------------------------------------
// VAULT — Swipe to delete
// Attached once per list container (delegated, since rows are re-rendered
// via innerHTML on every refresh). Swiping a row left reveals a delete
// button underneath; tapping it deletes immediately — swipe + tap is
// already two deliberate actions, so no extra confirmation step is added.
// ---------------------------------------------------------------------------

function enableSwipeToDelete(container) {
  if (!container) return;
  let activeWrapper = null;
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  function closeOtherRows(except) {
    container.querySelectorAll(".tx-row-wrapper.swiped").forEach((w) => {
      if (w !== except) {
        w.classList.remove("swiped");
        const r = w.querySelector(".tx-row");
        if (r) r.style.transform = "";
      }
    });
  }

  container.addEventListener("pointerdown", (e) => {
    const wrapper = e.target.closest(".tx-row-wrapper");
    if (!wrapper) return;
    closeOtherRows(wrapper);
    activeWrapper = wrapper;
    startX = e.clientX;
    currentX = 0;
    dragging = true;
    const row = wrapper.querySelector(".tx-row");
    if (row) row.style.transition = "none";
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragging || !activeWrapper) return;
    currentX = Math.max(-80, Math.min(0, e.clientX - startX));
    const row = activeWrapper.querySelector(".tx-row");
    if (row) row.style.transform = `translateX(${currentX}px)`;
  });

  function endDrag() {
    if (!dragging || !activeWrapper) return;
    dragging = false;
    const row = activeWrapper.querySelector(".tx-row");
    if (row) {
      row.style.transition = "";
      if (currentX < -40) {
        row.style.transform = "translateX(-72px)";
        activeWrapper.classList.add("swiped");
      } else {
        row.style.transform = "";
        activeWrapper.classList.remove("swiped");
      }
    }
    activeWrapper = null;
    currentX = 0;
  }
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
  container.addEventListener("pointerleave", endDrag);

  // Capture phase so this runs before the bubble-phase "open for edit"
  // listeners already attached on these same containers.
  container.addEventListener("click", async (e) => {
    const delBtn = e.target.closest(".tx-row-delete-btn");
    if (delBtn) {
      e.stopPropagation();
      const wrapper = delBtn.closest(".tx-row-wrapper");
      const id = Number(wrapper.dataset.id);
      await profileDb.transactions.delete(id);
      await refreshAll();
      return;
    }
    const swipedWrapper = e.target.closest(".tx-row-wrapper.swiped");
    if (swipedWrapper) {
      // First tap on an already-open row just closes it, instead of
      // accidentally opening the edit sheet.
      swipedWrapper.classList.remove("swiped");
      const row = swipedWrapper.querySelector(".tx-row");
      if (row) row.style.transform = "";
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

["recent-list", "yesterday-list", "browse-list"].forEach((id) => {
  enableSwipeToDelete(document.getElementById(id));
});
