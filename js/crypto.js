// ---------------------------------------------------------------------------
// VAULT — Crypto module
//
// Design (envelope encryption):
//  - Each profile that opts into a password gets one random Data Encryption
//    Key (DEK). All transaction data is encrypted with the DEK.
//  - The DEK itself is "wrapped" (encrypted) twice: once under a key derived
//    from the user's password (PBKDF2), and once under a key derived from a
//    12-word recovery phrase generated at setup time.
//  - This means changing your password later only requires re-wrapping the
//    DEK, not re-encrypting every transaction — and losing your password
//    but keeping the recovery words still unlocks everything.
//
// Nothing here is sent anywhere — it all runs locally via the browser's
// Web Crypto API (window.crypto.subtle), which is only available in secure
// contexts (https, which GitHub Pages provides).
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 150000;

// --- Encoding helpers ---------------------------------------------------------
function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

// --- Unbiased random index picker (for mnemonic word selection) --------------
function randomIndex(max) {
  const range = Math.floor(0xffffffff / max) * max;
  let val;
  do {
    val = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (val >= range);
  return val % max;
}

// --- Key derivation from a password or recovery phrase ------------------------
async function deriveKeyFromSecret(secretString, saltBytes) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretString),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

// --- Data Encryption Key (DEK) -------------------------------------------------
async function generateDEK() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function wrapDEK(dek, kek) {
  const raw = await crypto.subtle.exportKey("raw", dek);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
  return { iv: bufToBase64(iv), ciphertext: bufToBase64(ciphertext) };
}

// Throws if the key is wrong (AES-GCM auth tag fails) — callers should
// catch this and treat it as "incorrect password / recovery phrase".
async function unwrapDEK(wrapped, kek) {
  const iv = new Uint8Array(base64ToBuf(wrapped.iv));
  const ciphertext = base64ToBuf(wrapped.ciphertext);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ciphertext);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

// --- General-purpose encrypt/decrypt for transaction payloads ------------------
async function encryptJSON(obj, dek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, bytes);
  return bufToBase64(iv) + ":" + bufToBase64(ciphertext);
}

async function decryptJSON(payload, dek) {
  const [ivB64, ctB64] = payload.split(":");
  const iv = new Uint8Array(base64ToBuf(ivB64));
  const ciphertext = base64ToBuf(ctB64);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, ciphertext);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// --- Recovery mnemonic ----------------------------------------------------------
// Not the official BIP39 list (that needs a network fetch we don't have) —
// this is our own curated word set, used the same way: 12 random words the
// user writes down, which regenerate the same recovery key when re-entered.
const WORDLIST = [
  "anchor","arrow","autumn","banner","basil","beacon","birch","blossom","bramble","breeze",
  "bridge","canyon","cedar","charcoal","cinder","clover","cobalt","comet","copper","coral",
  "cotton","crater","cricket","crimson","crystal","current","dawn","delta","desert","dune",
  "eagle","ember","emerald","falcon","feather","fern","fjord","flint","forest","fossil",
  "garnet","glacier","granite","gravel","harbor","hazel","heather","hickory","horizon","hollow",
  "indigo","ivory","jasper","juniper","kestrel","lagoon","lantern","laurel","lichen","linen",
  "lotus","lumen","maple","marble","meadow","mesa","meteor","mineral","mirage","moss",
  "nectar","nimbus","nomad","oasis","obsidian","olive","onyx","opal","orchid","otter",
  "outpost","paddle","pebble","pepper","petal","pigeon","pine","plateau","plume","pollen",
  "poplar","prairie","prism","quarry","quartz","quill","rapid","raven","reed","ridge",
  "river","robin","rowan","rustic","saffron","sage","salt","sequoia","shale","shore",
  "silt","slate","sorrel","sparrow","spruce","stone","summit","sundew","sunfish","swallow",
  "sycamore","tangerine","teal","terra","thistle","thorn","thunder","tidal","timber","topaz",
  "tundra","turquoise","umber","valley","velvet","verdant","vessel","violet","walnut","warbler",
  "willow","woodland","zephyr","acorn","alpine","amber","aspen","azure","barley","basalt",
  "boulder","brook","cactus","canary","cavern","cliff","cloud","coyote","dahlia","dolphin"
];

function generateMnemonic() {
  const words = [];
  for (let i = 0; i < 12; i++) {
    words.push(WORDLIST[randomIndex(WORDLIST.length)]);
  }
  return words;
}

function normalizeMnemonic(words) {
  return words.map((w) => w.trim().toLowerCase()).join(" ");
}
