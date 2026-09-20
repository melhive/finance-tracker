// ---------------------------------------------------------------------------
// VAULT — Onboarding tour
// The app has grown a lot (accounts, budgets, recurring, goals, debts,
// tags, receipts, backups...). This is a short, skippable walkthrough shown
// once on first-ever entry into a dashboard, so a new profile doesn't start
// from a blank screen with no idea what's available. Replayable anytime
// from Settings.
// ---------------------------------------------------------------------------

const ONBOARDING_SLIDES = [
  {
    icon: "🔒",
    title: "Welcome to Vault",
    body: "Your finances, tracked entirely on this device. No account, no cloud sync — nobody but you ever sees your data."
  },
  {
    icon: "💰",
    title: "Log what moves",
    body: "Add income and expenses in seconds, split across multiple accounts like Cash or Bank, tag them however's useful, and attach a receipt photo if you want a record."
  },
  {
    icon: "📅",
    title: "Plan ahead",
    body: "Log a transaction dated in the future and it won't touch your balance until that day actually arrives — it just waits in Upcoming Transactions until then."
  },
  {
    icon: "📊",
    title: "Stay on budget",
    body: "Set a monthly limit per category, watch spending trends in Stats, and let recurring bills add themselves automatically."
  },
  {
    icon: "🎯",
    title: "See the bigger picture",
    body: "Track savings goals, log debts, and keep an eye on net worth — all computed right here, never uploaded anywhere."
  },
  {
    icon: "🔐",
    title: "Lock it down, back it up",
    body: "Add a password anytime from Settings, export a backup whenever you like, or import transactions straight from your bank's CSV export."
  }
];

const onboardingScreen = document.getElementById("onboarding-screen");
let onboardingIndex = 0;

function renderOnboardingSlide() {
  const slide = ONBOARDING_SLIDES[onboardingIndex];
  document.getElementById("onboarding-icon").textContent = slide.icon;
  document.getElementById("onboarding-title").textContent = slide.title;
  document.getElementById("onboarding-body").textContent = slide.body;
  document.getElementById("onboarding-dots").innerHTML = ONBOARDING_SLIDES.map((_, i) =>
    `<span class="onboarding-dot ${i === onboardingIndex ? "active" : ""}"></span>`
  ).join("");
  document.getElementById("onboarding-next-btn").textContent =
    onboardingIndex === ONBOARDING_SLIDES.length - 1 ? "Get started" : "Next";
}

function closeOnboarding() {
  onboardingScreen.classList.remove("visible");
  localStorage.setItem("vault-onboarding-seen", "true");
}

function openOnboarding() {
  onboardingIndex = 0;
  renderOnboardingSlide();
  onboardingScreen.classList.add("visible");
}

// Called once per app, from dashboard.js's enterDashboard, on first-ever
// entry into any profile's dashboard.
window.maybeShowOnboarding = function () {
  if (localStorage.getItem("vault-onboarding-seen")) return;
  openOnboarding();
};

// Reopenable anytime via Settings — see open-onboarding-btn.
window.replayOnboarding = openOnboarding;

document.getElementById("onboarding-next-btn").addEventListener("click", () => {
  if (onboardingIndex === ONBOARDING_SLIDES.length - 1) {
    closeOnboarding();
    return;
  }
  onboardingIndex++;
  renderOnboardingSlide();
});

document.getElementById("onboarding-skip-btn").addEventListener("click", closeOnboarding);
document.getElementById("open-onboarding-btn").addEventListener("click", openOnboarding);
