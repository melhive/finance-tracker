// ---------------------------------------------------------------------------
// VAULT — Data layer
//
// Two-tier database design:
//  1. ShellDB — one global database holding the list of profiles
//     (name, mode, currency, whether it's password-protected). This data
//     is not sensitive on its own, so it's never encrypted.
//  2. Per-profile database — a completely separate Dexie database per
//     profile (VaultData_<profileId>), holding that profile's transactions,
//     categories, and budgets. Nothing is shared between profiles — opening
//     "Business" can never leak a row from "Wife"'s data, because it's
//     physically a different IndexedDB database.
//
// Password protection + encrypting the per-profile data at rest is built
// in the security-layer step — the hasPassword flag and salts are already
// part of the schema here so that step doesn't require a migration.
// ---------------------------------------------------------------------------

const shellDB = new Dexie("VaultShell");
shellDB.version(1).stores({
  profiles: "++id, name, mode, createdAt"
});

const DEFAULT_CATEGORIES = {
  personal: {
    expense: ["Food", "Transport", "Rent", "Utilities", "Shopping", "Entertainment", "Health", "Other"],
    income: ["Salary", "Gift", "Other"]
  },
  business: {
    expense: ["Supplies", "Payroll", "Rent", "Utilities", "Marketing", "Other"],
    income: ["Client Payment", "Invoice", "Other"]
  }
};

const CATEGORY_COLORS = ["#00D9A3", "#4EA1FB", "#FB4E6A", "#F5B942", "#B18CFF", "#4ED9D9", "#FB8E4E", "#7C879C"];

// Fallback icon lookup by name — used both to seed default categories and,
// at render time, for any category created before icons existed (so no DB
// migration is needed for pre-existing profiles).
const CATEGORY_ICON_MAP = {
  Food: "🍔", Transport: "🚗", Rent: "🏠", Utilities: "💡", Shopping: "🛍️",
  Entertainment: "🎬", Health: "🏥", Other: "📦", Salary: "💵", Gift: "🎁",
  Supplies: "📦", Payroll: "👥", Marketing: "📣", "Client Payment": "💼", Invoice: "🧾"
};
const CATEGORY_ICON_CHOICES = [
  "🍔","🚗","🏠","💡","🛍️","🎬","🏥","📦","💵","🎁","📈","🧾","📋","📣","💼",
  "👥","🏦","☕","✈️","🎓","🐾","🧹","⚡","📱","🎮","🛠️","🚕","📚","💊","🎉"
];

/**
 * Creates a new profile: one row in ShellDB, plus its own dedicated
 * per-profile database seeded with default categories for the chosen mode.
 */
async function createProfile({ name, mode, currency, photo, startingBalance }) {
  const id = await shellDB.profiles.add({
    name,
    mode, // "personal" | "business"
    currency: currency || "PHP",
    photo: photo || null,
    hasPassword: false,
    createdAt: Date.now()
  });

  const db = openProfileDB(id);
  const seed = DEFAULT_CATEGORIES[mode];
  const rows = [];
  seed.expense.forEach((catName, i) =>
    rows.push({ name: catName, type: "expense", color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], icon: CATEGORY_ICON_MAP[catName] || "💰" })
  );
  seed.income.forEach((catName, i) =>
    rows.push({ name: catName, type: "income", color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], icon: CATEGORY_ICON_MAP[catName] || "💰" })
  );
  await db.categories.bulkAdd(rows);
  await db.accounts.add({ name: "Cash", sortOrder: 0, openingBalance: startingBalance || 0 });

  return id;
}

async function getProfiles() {
  return shellDB.profiles.toArray();
}

async function deleteProfileEntirely(profileId) {
  await shellDB.profiles.delete(profileId);
  await Dexie.delete(`VaultData_${profileId}`);
}

/**
 * Opens (or creates, on first access) the dedicated database for one
 * profile. Safe to call repeatedly — Dexie reuses the same connection.
 */
function openProfileDB(profileId) {
  const db = new Dexie(`VaultData_${profileId}`);

  // v1 schema (pre-encryption): flat fields on each transaction.
  db.version(1).stores({
    transactions: "++id, type, category, date, isTaxDeductible",
    categories: "++id, name, type",
    budgets: "++id, categoryId, period"
  });

  // v2 schema: transaction fields (type, amount, category, note,
  // isTaxDeductible) move into a single `payload` string — plain JSON when
  // the profile has no password, AES-GCM ciphertext once one is set. `date`
  // stays a plain indexed field since it's needed for the yesterday/report
  // date-range queries and isn't sensitive on its own.
  db.version(2)
    .stores({
      transactions: "++id, date",
      categories: "++id, name, type",
      budgets: "++id, categoryId, period"
    })
    .upgrade((tx) => {
      return tx.transactions.toCollection().modify((t) => {
        t.payload = JSON.stringify({
          type: t.type,
          amount: t.amount,
          category: t.category,
          note: t.note,
          isTaxDeductible: t.isTaxDeductible
        });
        delete t.type;
        delete t.amount;
        delete t.category;
        delete t.note;
        delete t.isTaxDeductible;
      });
    });

  // v3: budgets are looked up by category name directly (a category limit
  // isn't a strict foreign key elsewhere in the app, so a plain indexed
  // string is simpler than a numeric categoryId). No existing data to
  // migrate — this table was never exposed in the UI before now.
  db.version(3).stores({
    transactions: "++id, date",
    categories: "++id, name, type",
    budgets: "++id, category, period"
  });

  // v4: recurring transaction rules. `active` isn't indexed (IndexedDB
  // handles boolean keys awkwardly) — rules are few enough per profile to
  // just filter in JS after a plain toArray().
  db.version(4).stores({
    transactions: "++id, date",
    categories: "++id, name, type",
    budgets: "++id, category, period",
    recurring: "++id, nextDueDate"
  });

  // v5: multiple accounts per profile (Cash / Bank / GCash, etc). A
  // transaction's accountId lives inside its `payload` (encrypted along
  // with everything else), so existing transactions can't be migrated to
  // reference an account id directly — they're simply treated as
  // belonging to the first account whenever accountId is missing, handled
  // at read time in dashboard.js rather than here. Every profile (new or
  // existing) gets a default "Cash" account seeded on first open.
  db.version(5).stores({
    transactions: "++id, date",
    categories: "++id, name, type",
    budgets: "++id, category, period",
    recurring: "++id, nextDueDate",
    accounts: "++id, name"
  }).upgrade(async (tx) => {
    const count = await tx.accounts.count();
    if (count === 0) await tx.accounts.add({ name: "Cash", sortOrder: 0 });
  });

  // v6: savings goals, debts, and tags. All new tables — nothing to
  // migrate. A transaction's tag ids live inside its encrypted `payload`
  // (like account/category already do), not as a separate indexed field.
  db.version(6).stores({
    transactions: "++id, date",
    categories: "++id, name, type",
    budgets: "++id, category, period",
    recurring: "++id, nextDueDate",
    accounts: "++id, name",
    goals: "++id, name",
    debts: "++id, name",
    tags: "++id, name"
  });

  // v7: contribution/payment history for goals and debts, so "Add funds" /
  // "Log payment" is an auditable list with dates, not just a running total.
  // debts also gains `originalAmount` — a plain field, no migration needed —
  // as the denominator for a progress bar (existing debts fall back to
  // their current remainingBalance the first time they're rendered, see
  // debts.js, so an old debt with no progress history just starts at 0%).
  db.version(7).stores({
    transactions: "++id, date",
    categories: "++id, name, type",
    budgets: "++id, category, period",
    recurring: "++id, nextDueDate",
    accounts: "++id, name",
    goals: "++id, name",
    debts: "++id, name",
    tags: "++id, name",
    goalContributions: "++id, goalId, date",
    debtPayments: "++id, debtId, date"
  });

  return db;
}

/** Persists the password/recovery wrapping material onto a profile's row. */
async function setProfileSecurity(profileId, { passwordSalt, passwordWrapped, recoverySalt, recoveryWrapped }) {
  await shellDB.profiles.update(profileId, {
    hasPassword: true,
    passwordSalt,
    passwordWrapped,
    recoverySalt,
    recoveryWrapped
  });
}

/** Re-wraps the DEK under a newly-set password, keeping recovery wrap intact. */
async function updatePasswordWrap(profileId, { passwordSalt, passwordWrapped }) {
  await shellDB.profiles.update(profileId, { passwordSalt, passwordWrapped });
}

async function clearProfileSecurity(profileId) {
  await shellDB.profiles.update(profileId, {
    hasPassword: false,
    passwordSalt: null,
    passwordWrapped: null,
    recoverySalt: null,
    recoveryWrapped: null
  });
}
