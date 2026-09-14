// ---------------------------------------------------------------------------
// VAULT — App entry point
// Theme init, service worker registration/update flow, the boot loading
// screen, the shared unlock-transition loader, and the What's New sheet.
// ---------------------------------------------------------------------------

const themeToggleBtns = document.querySelectorAll(".theme-toggle-btn");
const updateToast = document.getElementById("update-toast");
const updateRefresh = document.getElementById("update-refresh");

// --- Theme ------------------------------------------------------------------
// Respects a saved choice, otherwise falls back to system preference.
const savedTheme = localStorage.getItem("vault-theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
const initialTheme = savedTheme || (systemPrefersLight ? "light" : "dark");
document.documentElement.setAttribute("data-theme", initialTheme);

themeToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("vault-theme", next);
  });
});

// --- Service worker registration + update flow --------------------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .then((registration) => {
      // Listen for a new service worker taking over after being installed —
      // this is the trigger for the "new version available" toast.
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            updateToast.classList.add("visible");
          }
        });
      });
    })
    .catch((err) => console.error("Service worker registration failed:", err));

  // Once the new service worker takes control, reload to get fresh assets.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  updateRefresh.addEventListener("click", () => {
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration && registration.waiting) {
        registration.waiting.postMessage("SKIP_WAITING");
      }
    });
  });
}

// --- Boot loader --------------------------------------------------------------
// Shown for a minimum delay so the brand moment reads as intentional rather
// than a flash — even though local IndexedDB/service-worker setup is fast.
const BOOT_MIN_MS = 900;
const bootLoader = document.getElementById("boot-loader");

function hideBootLoader() {
  bootLoader.classList.add("fade-out");
  setTimeout(() => {
    bootLoader.style.display = "none";
    maybeShowWhatsNew();
  }, 500);
}

window.addEventListener("load", () => setTimeout(hideBootLoader, BOOT_MIN_MS));

// Reused after a successful unlock: replay the same branded loader briefly
// before the dashboard appears, then resolve.
window.showUnlockTransition = function () {
  return new Promise((resolve) => {
    bootLoader.style.display = "flex";
    bootLoader.classList.remove("fade-out");
    // Restart the SVG stroke-draw animation by forcing reflow.
    bootLoader.querySelectorAll(".draw-path").forEach((path) => {
      path.style.animation = "none";
      void path.offsetWidth;
      path.style.animation = "";
    });
    setTimeout(() => {
      bootLoader.classList.add("fade-out");
      setTimeout(() => {
        bootLoader.style.display = "none";
        resolve();
      }, 500);
    }, 700);
  });
};

// --- What's New -----------------------------------------------------------------
const whatsnewBackdrop = document.getElementById("whatsnew-backdrop");
let latestChangelogEntry = null;

function renderWhatsNew(entry) {
  document.getElementById("whatsnew-title").textContent = entry.title;
  document.getElementById("whatsnew-date").textContent = entry.date;
  document.getElementById("whatsnew-list").innerHTML = entry.changes.map((c) => `<li>${c}</li>`).join("");
  whatsnewBackdrop.classList.add("visible");
}

function maybeShowWhatsNew() {
  fetch("changelog.json")
    .then((res) => res.json())
    .then((entries) => {
      latestChangelogEntry = entries[0];
      const lastSeen = localStorage.getItem("vault-last-seen-version");
      if (latestChangelogEntry && lastSeen !== latestChangelogEntry.version) {
        renderWhatsNew(latestChangelogEntry);
      }
    })
    .catch(() => {});
}

document.getElementById("whatsnew-close-btn").addEventListener("click", () => {
  whatsnewBackdrop.classList.remove("visible");
  if (latestChangelogEntry) localStorage.setItem("vault-last-seen-version", latestChangelogEntry.version);
});

document.getElementById("open-whatsnew-btn").addEventListener("click", () => {
  fetch("changelog.json")
    .then((res) => res.json())
    .then((entries) => {
      latestChangelogEntry = entries[0];
      renderWhatsNew(entries[0]);
    })
    .catch(() => {});
});
