const DAILY_KEY = "slamGuesserSimple.daily.v1";

// Deploy version from this script's own ?v= (set in index.html), reused to
// cache-bust the JSON data files so they always match this game.js.
const ASSET_VERSION = (() => {
  try { return new URL(document.currentScript.src).searchParams.get("v") || ""; } catch { return ""; }
})();
const versioned = (path) => (ASSET_VERSION ? `${path}?v=${ASSET_VERSION}` : path);

/* ---- Theme (light/dark) -------------------------------
   The actual data-theme attribute is set as early as possible by an
   inline script in index.html's <head> (localStorage choice, else OS
   preference) to avoid a flash of the wrong theme before this file even
   loads. Everything here just keeps the toggle button's icon/label in
   sync and handles the user explicitly flipping it. */
const THEME_KEY = "slamGrid.theme";

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Syncs the toggle button's icon + aria-label/title to whatever theme is
// currently active. Called once on load (the button's HTML defaults to
// the light-mode look, in case JS is slow) and again after every toggle.
function updateThemeToggleUI(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  const sun = btn.querySelector(".icon-sun");
  const moon = btn.querySelector(".icon-moon");
  const isDark = theme === "dark";
  // Dark mode: show the sun ("tap to go light"). Light mode: show the
  // moon ("tap to go dark"). Uses explicit style.display values (not
  // [hidden] — inline <svg> doesn't reliably honor the hidden attribute
  // across browsers) — and not "" either, since #themeToggleBtn
  // .icon-sun's stylesheet default is display:none, which an empty
  // inline value would just fall through to instead of clearing.
  if (sun) sun.style.display = isDark ? "block" : "none";
  if (moon) moon.style.display = isDark ? "none" : "block";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore quota/privacy-mode errors — theme just won't persist */
  }
  updateThemeToggleUI(next);
}

updateThemeToggleUI(getCurrentTheme());

/* ---- Data freshness gating ----------------------------
   All four 2026 slams are shown. To hide a slam that's still being
   backfilled, add its key to DATA_FRESHNESS_HIDE_SLAMS. The footer
   notice is off; flip SHOW_FRESHNESS_NOTICE back on (and update the
   label text) if a caveat is ever worth calling out. */
const DATA_FRESHNESS_YEAR = "2026";
const DATA_FRESHNESS_HIDE_SLAMS = [];
const DATA_FRESHNESS_LABEL = "Results through RG 2026";
const DATA_FRESHNESS_LABEL_SHORT = "Results thru RG ‘26";
const SHOW_FRESHNESS_NOTICE = false;

/* ---- Daily result storage -----------------------------
   Records each completed daily so revisits show the
   finished state instead of letting the user re-play.
   Shape:
     {
       "2026-05-28": {
         "standard": { player, wrong, outcome },
         "hard":     { player, wrong, outcome }
       },
       ...
     }
   Auto-prunes to ~last 7 days to avoid unbounded growth. */

function getDailyResults() {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDailyResult(date, mode, result) {
  if (game.isDemo) return; // practice round never writes the daily lock
  try {
    const all = getDailyResults();
    if (!all[date]) all[date] = {};
    all[date][mode] = result;

    // Prune: keep only the most recent 2 dates. Only today matters now
    // for the "you've already played today" restore, but we keep yesterday
    // too as a small buffer for timezone-edge cases.
    const dates = Object.keys(all).sort();
    while (dates.length > 2) {
      delete all[dates.shift()];
    }

    localStorage.setItem(DAILY_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

function getDailyResult(date, mode) {
  const all = getDailyResults();
  return all?.[date]?.[mode] || null;
}

/* ---- Per-day game history (week strip) ----------------
   One localStorage entry per day, never overwritten (first play wins).
   Key:   slamGrid.dayResult.YYYY-MM-DD
   Value: { date, dayOfWeek, round, outcome, guesses, player, revealPct }
   revealPct: share of the grid visible at the winning guess (wins only;
   null on a miss, absent on entries saved before it existed). */

const DAY_RESULT_KEY_PREFIX = "slamGrid.dayResult.";

function getDayResult(dateIso) {
  try {
    const raw = localStorage.getItem(DAY_RESULT_KEY_PREFIX + dateIso);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDayResult(result) {
  if (game.isDemo) return; // practice round stays out of week history
  try {
    if (localStorage.getItem(DAY_RESULT_KEY_PREFIX + result.date)) return;
    localStorage.setItem(DAY_RESULT_KEY_PREFIX + result.date, JSON.stringify(result));
  } catch {
    /* ignore quota errors */
  }
}

/* ---- Reveal progress (anti-replay) ---------------------
   Which grid cells the player has already seen today, so a refresh or a
   second tab resumes the reveal instead of replaying it from zero — and
   the early-win reveal % can't be gamed by reloading and pausing early.
   Cells are keyed by slam:year, not reveal order, because desktop and
   mobile reveal in different orders.
   `paused` remembers a paused reveal so a refresh comes back paused.
   Key:   slamGrid.revealSeen.YYYY-MM-DD
   Value: { player, keys: ["AustralianOpen:2019", ...], paused }  (today only) */

const REVEAL_SEEN_KEY_PREFIX = "slamGrid.revealSeen.";

// Today's record for the current player, or null if there isn't one.
function readRevealRecord() {
  if (game.isDemo) return null;
  try {
    const raw = localStorage.getItem(REVEAL_SEEN_KEY_PREFIX + game.date);
    const rec = raw ? JSON.parse(raw) : null;
    return rec && rec.player === game.current?.name ? rec : null;
  } catch {
    return null;
  }
}

function writeRevealRecord(rec) {
  if (game.isDemo || !game.date || !game.current) return;
  try {
    localStorage.setItem(REVEAL_SEEN_KEY_PREFIX + game.date, JSON.stringify(rec));
    // Only today's record matters — drop older days'.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k.startsWith(REVEAL_SEEN_KEY_PREFIX) && k !== REVEAL_SEEN_KEY_PREFIX + game.date) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore quota errors */
  }
}

// Set of seen cell keys for today's player, or null if there's no record.
function getRevealSeen() {
  const rec = readRevealRecord();
  return rec ? new Set(rec.keys) : null;
}

function addRevealSeen(keys) {
  if (game.isDemo || !game.current || !keys.length) return;
  const rec = readRevealRecord() || { player: game.current.name, keys: [] };
  const seen = new Set(rec.keys);
  const before = seen.size;
  keys.forEach((k) => seen.add(k));
  if (seen.size === before) return;
  writeRevealRecord({ ...rec, keys: [...seen] });
}

function isRevealPausedStored() {
  return !!readRevealRecord()?.paused;
}

function storeRevealPaused(paused) {
  if (game.isDemo || !game.current) return;
  const rec = readRevealRecord() || { player: game.current.name, keys: [] };
  if (!!rec.paused === paused) return;
  writeRevealRecord({ ...rec, paused });
}

function markAllCellsSeen() {
  addRevealSeen([...document.querySelectorAll("#table .reveal-cell")].map((c) => c.dataset.key));
  storeRevealPaused(false); // nothing left to be paused on
}

// Skip the reveal animation outright only once the day is finished. A
// mid-round refresh resumes it instead (seen cells shown, the rest still to
// come) — except rounds begun before seen-tracking existed, which have no
// record and so keep the old "show the full grid" restore.
function shouldSkipReveal() {
  const saved = getDailyResult(game.date, game.mode);
  if (!saved) return false;
  if (!saved.inProgress) return true;
  return getRevealSeen() === null;
}

/* ---- First-visit intro (practice round) ---------------
   Brand-new players get one practice round with a known player before
   today's puzzle, using the real grid/guess/hint/tiebreak UI. While
   game.isDemo is true, every history writer (saveDailyResult,
   saveDayResult, addRevealSeen) is a no-op, so the practice round never
   touches the daily lock, week strip, difficulty chart, or championship. */

const INTRO_SEEN_KEY = "slamGrid.introSeen";
// Set when the player picks "Practice round"; cleared only when the
// practice truly ends. A refresh mid-practice restarts the practice
// instead of dropping a brand-new player into today's grid.
const DEMO_IN_PROGRESS_KEY = "slamGrid.demoInProgress";

function isDemoInProgress() {
  try {
    return !localStorage.getItem(INTRO_SEEN_KEY) && !!localStorage.getItem(DEMO_IN_PROGRESS_KEY);
  } catch {
    return false;
  }
}
const INTRO_PLAYER_NAME = "Rafael Nadal";

// True only with no trace of a previous visit. The how-to flag counts as
// history too: it covers players from before the intro existed, and makes
// a refresh mid-practice drop straight into the real puzzle.
function isFirstTimePlayer() {
  try {
    if (localStorage.getItem(INTRO_SEEN_KEY)) return false;
    if (localStorage.getItem("slamGuesserSimple.seenHowTo.v1")) return false;
    if (localStorage.getItem(DAILY_KEY)) return false;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(DAY_RESULT_KEY_PREFIX) || k.startsWith(REVEAL_SEEN_KEY_PREFIX)) return false;
    }
    return true;
  } catch {
    return false; // no storage → can't tell, so don't risk showing it to a returning player
  }
}

function markIntroSeen() {
  try { localStorage.setItem(INTRO_SEEN_KEY, "1"); } catch { /* ignore */ }
}

// Start the practice round. Returns false (caller plays today's puzzle)
// if the intro player can't be found.
function startIntro() {
  const player = game.players.find((p) => p.name === INTRO_PLAYER_NAME);
  if (!player) {
    markIntroSeen();
    return false;
  }
  game.isDemo = true;
  game.introPlayer = player;
  document.getElementById("introBanner").hidden = false;
  document.body.classList.add("is-practice");
  next();
  return true;
}

// Leave the practice round (via "Skip practice", "Play today's grid →", or
// closing its result modal) and load today's real puzzle fresh.
function endIntro() {
  if (!game.isDemo) return;
  game.isDemo = false;
  game.introPlayer = null;
  try { localStorage.removeItem(DEMO_IN_PROGRESS_KEY); } catch { /* ignore */ }
  markIntroSeen();
  document.getElementById("introBanner").hidden = true;
  document.body.classList.remove("is-practice");
  next();
}

// First-visit How to Play: no × and no Esc — the player chooses between the
// practice round and today's grid. Opened later from the info icon it's the
// normal dialog (× + "Vamos!").
function setHowToChoiceMode(on) {
  document.getElementById("howToClose").hidden = on;
  document.getElementById("howToVamos").hidden = on;
  document.getElementById("howToChoice").hidden = !on;
  game.howToChoice = on;
}

function markHowToSeen() {
  try { localStorage.setItem("slamGuesserSimple.seenHowTo.v1", "1"); } catch { /* ignore */ }
}

// The practice round is already loaded behind the dialog; closing it
// starts the reveal.
function choosePracticeRound() {
  markHowToSeen();
  try { localStorage.setItem(DEMO_IN_PROGRESS_KEY, "true"); } catch { /* ignore */ }
  document.getElementById("howToDialog").close();
}

function choosePlayToday() {
  markHowToSeen();
  endIntro(); // loads today's grid; its reveal waits for the dialog to close
  document.getElementById("howToDialog").close();
}

function getMondayOfWeek(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysFromMon = (date.getDay() + 6) % 7;
  const mon = new Date(y, m - 1, d - daysFromMon);
  return [
    mon.getFullYear(),
    String(mon.getMonth() + 1).padStart(2, "0"),
    String(mon.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDaysToIso(dateIso, n) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getWeekResults(todayIso) {
  const monday = getMondayOfWeek(todayIso);
  return Array.from({ length: 7 }, (_, i) => getDayResult(addDaysToIso(monday, i)));
}

function isDayWon(result) {
  return !!result && (result.outcome === "won" || result.outcome === "tiebreak");
}

function isChampionThisWeek(today) {
  if (dayOfWeekIndex(today) !== 6) return false;
  return getWeekResults(today).every(isDayWon);
}

/* ------------------------------------------------------- */

/* Restore a saved daily — either finished (locked, share enabled) or
   in-progress (mid-round wrong-count, hints visible, can keep guessing).
   Returns true if a restoration was performed, false otherwise. */
function maybeRestoreFinishedDaily() {
  const saved = getDailyResult(game.date, game.mode);
  if (!saved) return false;

  // Historical play is immutable. If we have a snapshot of the player as
  // they existed when the user played this date, replay against THAT,
  // regardless of how the live rotation has changed since (added players,
  // re-shuffled pool, etc.).
  if (saved.playerSnapshot) {
    game.current = saved.playerSnapshot;
    game.previous = saved.playerSnapshot.name;
    render();
  } else {
    if (!game.current || saved.player !== game.current.name) return false;
  }

  // Reset the round state to match the saved state
  game.wrong = saved.wrong;
  game.lastOutcome = saved.outcome;
  game.revealPct = saved.revealPct ?? null;
  game.wrongGuessNames = saved.wrongGuessNames || [];

  const inProgress = !!saved.inProgress && saved.outcome === null;

  // Rebuild hint cards (gender appears at wrong>=1, nation at wrong>=2,
  // answer/correct at the very end — for finished rounds only).
  const panel = document.getElementById("hintPanel");
  panel.innerHTML = "";

  if (saved.wrong >= 1) {
    const g = document.createElement("div");
    const genderClass = (game.current.gender || "").toLowerCase();
    g.className = `hint-card gender-card ${genderClass}`;
    g.textContent = `👤 Gender: ${game.current.gender}`;
    panel.appendChild(g);
  }
  if (saved.wrong >= 2) {
    const n = document.createElement("div");
    n.className = "hint-card nation-card";
    const flag = nationalityToFlag(game.current.nationality);
    n.textContent = `${flag} ${game.current.nationality}`;
    panel.appendChild(n);
  }

  if (inProgress) {
    // Mid-round: leave the input/buttons enabled so the user can keep
    // guessing. No banner, no answer reveal.
    game.locked = false;
    document.getElementById("guessBtn").disabled = false;
    document.getElementById("tiebreakBtn").disabled = false;
    document.getElementById("shareBtn").disabled = true;
    updateUI();
    return true;
  }

  // Finished round — append the outcome card
  if (saved.outcome === "win" || saved.outcome === "tiebreak") {
    const a = document.createElement("div");
    a.className = "hint-card correct-card";
    a.textContent = `✅ Correct: ${game.current.name}`;
    panel.appendChild(a);
  } else {
    const a = document.createElement("div");
    a.className = "hint-card answer-card";
    a.textContent = `❌ Answer: ${game.current.name}`;
    panel.appendChild(a);
  }

  // Show a small "already played" banner so the state is explicit
  const banner = document.createElement("div");
  banner.className = "hint-card already-played-card";
  banner.textContent = "🕘 You've already played today's game";
  panel.insertBefore(banner, panel.firstChild);

  // Screen-reader users landing on an already-finished day get no visual
  // cue at all otherwise — mirror the banner + outcome card as one
  // announcement, same outcome-naming convention as a live loss (item 2).
  const restoreOutcomeText =
    saved.outcome === "win" ? "Correct! " :
    saved.outcome === "tiebreak" ? "Correct! Tiebreak win. " :
    "Incorrect. ";
  announce(`You've already played today's game. ${restoreOutcomeText}The answer was ${game.current.name}.`);

  // Lock the input/buttons via the same end-of-round flow
  game.locked = true;
  document.getElementById("guessBtn").disabled = true;
  document.getElementById("tiebreakBtn").disabled = true;
  document.getElementById("shareBtn").disabled = false;

  revealCountdown();

  updateUI();
  return true;
}

/* ------------------------------------------------------- */

function todayLocal() {
  // YYYY-MM-DD in the user's local timezone
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ========================================================= */

let game = {
  players: [],
  guessPool: [],
  current: null,
  previous: null,
  wrong: 0,
  wrongGuessNames: [],
  locked: false,
  selectedSuggestion: false,
  suggestionIndex: -1,
  suggestionItems: [],
  lockProgressHints: false,
  roundHistory: [],
  currentRoundResult: null,
  day: 0,
  lastOutcome: null,

  mode: "standard",
  playType: "daily", // single play type — no practice mode in this build
  date: null,
};
/* =========================================================
   DAILY ROTATION — Fisher-Yates with a stable seed
   =========================================================
   Per-mode deterministic schedule. Walks through every player in
   shuffled order before any repeats. Cycle length = pool size:
     Standard ≈ 328 days, Winners ≈ 100, Hard ≈ 233.

   Bump SHUFFLE_SEED to reshuffle the rotation. Note: any change to
   the player pool (adding/removing players) will shift the schedule. */

const SHUFFLE_SEED = "slam-guesser-simple-v1";
const ROTATION_EPOCH = "2026-01-01"; // day 0 of the rotation

// Lightweight integer hash for strings (32-bit, deterministic).
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Mulberry32 — a good small PRNG seeded by an integer.
function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic shuffle of an array (Fisher-Yates with a seeded RNG).
function shuffleStable(arr, seedStr) {
  const out = arr.slice();
  const rand = mulberry32(hashStr(seedStr));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Cache the shuffled order per mode so we don't redo the work each round.
const shuffleCache = {};

function getRotationFor(mode, pool) {
  // Cache key combines mode + a hash of the pool contents (first 16
  // player names). Different day-of-week buckets all happen to be
  // size 51 but contain different players — keying only on length
  // would cause Monday's bucket shuffle to be reused for Tuesday.
  const fingerprint = pool.slice(0, 16).map((p) => p.name).join("|");
  const key = `${mode}:${pool.length}:${hashStr(fingerprint)}`;
  if (!shuffleCache[key]) {
    shuffleCache[key] = shuffleStable(pool, `${SHUFFLE_SEED}:${mode}:${pool.length}`);
  }
  return shuffleCache[key];
}

// Whole-day delta between two YYYY-MM-DD strings (b - a). Negative if a > b.
function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

// Day-index for the rotation. Can be negative (pre-epoch) — we wrap via
// the safe modulo below.
function rotationDayIndex(dateIso) {
  return daysBetween(ROTATION_EPOCH, dateIso);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function pickRotationPlayer(mode, dateIso, pool) {
  if (!pool || pool.length === 0) return null;
  const order = getRotationFor(mode, pool);
  const i = mod(rotationDayIndex(dateIso), order.length);
  return order[i];
}

/* =========================================================
   DIFFICULTY BUCKETING — Mon (easy) → Sun (hard)
   =========================================================
   Each player has an `autoScore` (notability + recency) computed by the
   admin/builder tools and baked into players.json. We rank all
   eligible players by autoScore descending and split into 7 equal
   buckets. Bucket 0 → Monday, bucket 6 → Sunday.

   Players with a `manualDay` field override the auto-bucket and play
   on that specific day-of-week.

   Filter is per-date: given today's date, return only the subset of
   players who belong to today's day-of-week. The seeded rotation then
   picks among that subset. */

const DAY_NAMES_RUNTIME = [
  "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday",
];
const DAY_LABELS = ["R1", "R2", "R3", "R4", "QF", "SF", "F"];

// Day index for a YYYY-MM-DD string (0=Mon, 6=Sun).
function dayOfWeekIndex(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  // JS Date: 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const js = new Date(y, m - 1, d).getDay();
  return (js + 6) % 7;
}

// Returns the subset of `pool` assigned to the day-of-week of `dateIso`.
function filterToDayBucket(pool, dateIso) {
  const todayIdx = dayOfWeekIndex(dateIso);
  const todayName = DAY_NAMES_RUNTIME[todayIdx];

  // First: anyone manually assigned to today is in today's bucket.
  const manuals = pool.filter((p) => p.manualDay === todayName);

  // For everyone else (no manualDay), rank by autoScore desc and bucket
  // into 7 equal slices.
  const auto = pool.filter((p) => !p.manualDay);
  auto.sort((a, b) => (b.autoScore ?? 0) - (a.autoScore ?? 0));

  const per = Math.ceil(auto.length / 7);
  const start = todayIdx * per;
  const end = Math.min(start + per, auto.length);
  const autoForToday = auto.slice(start, end);

  // If nothing matches (e.g., autoScore missing on all players because
  // an older players.json predates the admin update), fall back to the
  // full pool so the game still works.
  const combined = [...manuals, ...autoForToday];
  return combined.length > 0 ? combined : pool;
}

/* =========================================================
   SCHEDULE — loaded once from schedule.json
   =========================================================
   Pre-baked mapping of date → player name. Baked dates are frozen and
   unaffected by later database changes. Unbaked dates fall back to live
   rotation. File shape: { "YYYY-MM-DD": "Player Name" }
   The file is optional. If missing, all dates use live rotation. */

let schedule = {}; // { "YYYY-MM-DD": "Player Name" }

function getScheduleEntry(dateIso) {
  return schedule?.[dateIso] || null;
}

async function loadSchedule() {
  try {
    const res = await fetch(versioned("./schedule.json"));
    if (!res.ok) return; // file not deployed yet — silent
    const data = await res.json();
    schedule = (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
  } catch {
    schedule = {};
  }
}

/* DAILY PUZZLE SYSTEM */

/* PLAY TYPE */

function getPlayType() {
  return "daily"; // single play type
}

/* MODE */

function getMode() {
  // Single-mode game. Any URL "mode" param is ignored.
  return "standard";
}

/* TODAY */

function getTodayString() {
  // Use the user's LOCAL date. Using toISOString() here would return UTC,
  // which can be a day ahead in the evening for US users and shift the
  // daily seed/puzzle a day earlier than expected.
  return todayLocal();
}

/* DATE */

function getRequestedDate() {
  // Daily is "today only" in this simplified build. No past-date access.
  return getTodayString();
}

/* LOAD */

async function load() {
  const res = await fetch(versioned("./players.json"));

  game.players = await res.json();

  const res2 = await fetch(versioned("./guess_pool.json"));

  game.guessPool = await res2.json();

  buildGuessPoolIndex();

  // Load pre-baked schedule — optional file. Unbaked dates fall back to live rotation.
  await loadSchedule();

  // URL STATE
  game.playType = getPlayType();
  game.mode = getMode();
  game.date = getRequestedDate();

  // Practice round: brand-new player, or a refresh mid-practice (restarts it).
  if (!((isDemoInProgress() || isFirstTimePlayer()) && startIntro())) next();

  // Strip any query string so the URL stays clean Wordle-style. Note:
  // ?date= / ?play= params are NOT read by this build (today-only); this
  // just tidies the address bar if someone arrives with a query string.
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
}

/* RESET HINTS */

function clearHints() {
  document.getElementById("hintPanel").innerHTML = "";
}

/* MESSAGE */

function isMobileDevice() {
  if (navigator.maxTouchPoints > 1) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function showMessage(text) {
  const openDialog = document.querySelector("dialog[open]");
  let container;
  if (openDialog) {
    container = openDialog.querySelector(".dialog-toast");
  }
  if (!container) container = document.getElementById("hintPanel");

  const div = document.createElement("div");
  div.className = "hint-card invalid-card";
  div.textContent = text;
  container.appendChild(div);
  setTimeout(() => div.remove(), 4000);

  announce(text);
}

// Screen-reader announcement — updates the visually-hidden aria-live
// region (see #liveRegion in index.html). Polite live regions announce
// on text change, so just setting new text each call is enough; no need
// to clear first.
function announce(text) {
  const el = document.getElementById("liveRegion");
  if (el) el.textContent = text;
}

/* FLAGS */

function nationalityToFlag(nation) {
  const map = {
    Algeria: "🇩🇿",
    Australia: "🇦🇺",
    Austria: "🇦🇹",
    Argentina: "🇦🇷",
    // Neutral-athlete status (post-2022 sanctions) — no national flag shown.
    Belarus: "",
    Belgium: "🇧🇪",
    "Bosnia and Herzegovina": "🇧🇦",
    Brazil: "🇧🇷",
    Bulgaria: "🇧🇬",
    Canada: "🇨🇦",
    Chile: "🇨🇱",
    China: "🇨🇳",
    Colombia: "🇨🇴",
    Croatia: "🇭🇷",
    Cyprus: "🇨🇾",
    "Czech Republic": "🇨🇿",
    Denmark: "🇩🇰",
    Ecuador: "🇪🇨",
    Egypt: "🇪🇬",
    Estonia: "🇪🇪",
    Finland: "🇫🇮",
    France: "🇫🇷",
    Georgia: "🇬🇪",
    Germany: "🇩🇪",
    Greece: "🇬🇷",
    Hungary: "🇭🇺",
    India: "🇮🇳",
    Indonesia: "🇮🇩",
    Ireland: "🇮🇪",
    Israel: "🇮🇱",
    Italy: "🇮🇹",
    Japan: "🇯🇵",
    Kazakhstan: "🇰🇿",
    Latvia: "🇱🇻",
    Lebanon: "🇱🇧",
    Lithuania: "🇱🇹",
    Luxembourg: "🇱🇺",
    Mexico: "🇲🇽",
    Moldova: "🇲🇩",
    Monaco: "🇲🇨",
    Morocco: "🇲🇦",
    Netherlands: "🇳🇱",
    "New Zealand": "🇳🇿",
    Norway: "🇳🇴",
    Paraguay: "🇵🇾",
    Peru: "🇵🇪",
    Philippines: "🇵🇭",
    Poland: "🇵🇱",
    Portugal: "🇵🇹",
    Romania: "🇷🇴",
    // Neutral-athlete status (post-2022 sanctions) — no national flag shown.
    Russia: "",
    Serbia: "🇷🇸",
    Slovakia: "🇸🇰",
    Slovenia: "🇸🇮",
    "South Africa": "🇿🇦",
    "South Korea": "🇰🇷",
    Spain: "🇪🇸",
    Sweden: "🇸🇪",
    Switzerland: "🇨🇭",
    Taiwan: "🇹🇼",
    Thailand: "🇹🇭",
    Tunisia: "🇹🇳",
    Turkey: "🇹🇷",
    Ukraine: "🇺🇦",
    "United Kingdom": "🇬🇧",
    "United States": "🇺🇸",
    USA: "🇺🇸",
    US: "🇺🇸",
    Uzbekistan: "🇺🇿",
  };

  return map[nation] || "";
}

/* NEXT PLAYER */

function next() {
  game.wrong = 0;
  game.wrongGuessNames = [];
  game.locked = false;
  game.selectedSuggestion = false;
  game.hintLocked = false;
  game.lockProgressHints = false;

  const shareBtn = document.getElementById("shareBtn");
  shareBtn.disabled = true;

  game.lastOutcome = null;
  game.revealPct = null;

  document.getElementById("guessBtn").disabled = false;
  document.getElementById("tiebreakBtn").disabled = false;

  document.getElementById("guess").value = "";

  hideSuggestions();
  clearHints();

  // First-visit practice round: fixed player, always animates, no restore.
  if (game.isDemo) {
    game.current = game.introPlayer;
    game.previous = game.introPlayer.name;
    game._skipReveal = false;
    render();
    updateUI();
    return;
  }

  // Baked schedule takes priority over live rotation.
  const scheduledName = getScheduleEntry(game.date);
  if (scheduledName) {
    const match = game.players.find((p) => p.name === scheduledName);
    if (match) {
      game.current = match;
      game.previous = match.name;
      game._skipReveal = shouldSkipReveal();
      render();
      updateUI();
      maybeRestoreFinishedDaily();
      return;
    }
    console.warn(`[schedule] ${game.date} → "${scheduledName}" not found in players, falling back to live rotation`);
  }

  // Eligibility flow:
  //   1. Take the top-N players by autoScore (default 500).
  //   2. ADD any below-cut players who have a manualDay (Mon-Sun) override
  //      — admin force-included them.
  //   3. REMOVE any player whose manualDay === "excluded" — admin force-
  //      excluded them despite high score.
  //
  // Below-cut players are still in `game.players` for autocomplete
  // matching; the eligibility filter is just about who can be picked.
  const TOP_N = 500;
  const sortedByScore = game.players
    .slice()
    .sort((a, b) => (b.autoScore ?? 0) - (a.autoScore ?? 0));
  const topN = sortedByScore.slice(0, TOP_N);
  const topNSet = new Set(topN.map((p) => p.name));

  // Below-cut players with a Mon-Sun override get force-included.
  const forceIncluded = sortedByScore.slice(TOP_N).filter(
    (p) => p.manualDay && p.manualDay !== "excluded"
  );

  // Anything explicitly excluded gets dropped.
  let eligiblePlayers = [...topN, ...forceIncluded].filter(
    (p) => p.manualDay !== "excluded"
  );

  // Day-of-week difficulty bucket — Mon = easiest, Sun = hardest. Each
  // player is assigned to one day, either via manualDay override or via
  // auto-ranking by autoScore. We filter the eligible pool to today's
  // bucket so the rotation picks only from players assigned to today.
  eligiblePlayers = filterToDayBucket(eligiblePlayers, game.date);

  // SAFETY CHECK
  if (!eligiblePlayers.length) {
    showMessage("No eligible players");
    return;
  }

  let p = pickRotationPlayer(game.mode, game.date, eligiblePlayers);

  game.current = p;
  game.previous = p.name;

  // A finished day is about to be restored — skip the career-reveal
  // animation since the user has already seen the table. (Mid-round
  // restores resume the reveal from what was seen; see shouldSkipReveal.)
  game._skipReveal = shouldSkipReveal();

  render();
  updateUI();

  // If the user already finished today's puzzle, replay the finished state
  // instead of letting them guess again.
  maybeRestoreFinishedDaily();
}

/* GUESS */

function guess() {
  if (game.locked) return;

  const input = document.getElementById("guess");
  const val = input.value.trim();

  if (!val) {
    showMessage("⚠️ Please select a player");
    return;
  }

  if (!game.selectedSuggestion) {
    showMessage("⚠️ Choose a player from the dropdown");
    return;
  }

  const target = game.current.name.toLowerCase();
  const guessLower = val.toLowerCase();

  const ok =
    guessLower === target ||
    guessLower === target.split(" ").pop() ||
    sortedNameKey(val) === sortedNameKey(game.current.name);

  if (ok) {
    game.lastOutcome = "win";
    game.revealPct = currentRevealPct();
    game.lockProgressHints = true; // only block gender/nation hints

    showHints(true);

    const guessNum = game.wrong + 1;
    announce(`Correct! You won in ${guessNum === 1 ? "1 guess" : `${guessNum} guesses`}.`);

    endRound();
  } else {
    game.wrong++;
    game.wrongGuessNames.push(val);

    if (game.wrong >= 3) {
      // Salvage round: a multiple-choice pick before the reveal. Only
      // offered when the candidate cascade can find at least one valid
      // distractor — otherwise fall straight through to a normal loss.
      const tiebreakOptions = buildTiebreakOptions(game.current, game.wrongGuessNames, game.wrong);
      if (tiebreakOptions) {
        announce("Incorrect. Starting tiebreak.");
        openTiebreak(tiebreakOptions);
      } else {
        game.lastOutcome = "lose";
        showHints(false);
        announce(`Incorrect. Missed it — the answer was ${game.current.name}.`);
        endRound();
      }
    } else {
      showHints(false);
      announce(
        game.wrong === 1
          ? `Incorrect. Hint revealed: gender is ${game.current.gender}.`
          : `Incorrect. Hint revealed: country is ${game.current.nationality}.`
      );
      // Mid-round: persist the in-progress state so a refresh restores it.
      saveDailyResult(game.date, game.mode, {
        player: game.current.name,
        playerSnapshot: game.current,
        wrong: game.wrong,
        wrongGuessNames: game.wrongGuessNames,
        outcome: null,
        inProgress: true,
      });
    }

    updateUI();
  }

  // Clear the input after a processed guess (win or wrong) so the player
  // has a fresh box for their next attempt. Early-return validation cases
  // above bail before this point and preserve what the user typed.
  input.value = "";
  game.selectedSuggestion = false;

  hideSuggestions();
}

/* VOLUNTARY TIEBREAK */

// Tapping the Tiebreak button (available any time before the automatic
// 3-guess trigger) opens a confirmation first — unlike the automatic
// trigger, this one is optional, so it needs an "are you sure" beat.
function openTiebreakConfirm() {
  if (game.locked) return;
  const dlg = document.getElementById("tiebreakConfirmDialog");
  if (dlg && typeof dlg.showModal === "function") {
    dlg.showModal();
  }
}

function confirmPlayTiebreak() {
  const dlg = document.getElementById("tiebreakConfirmDialog");
  if (dlg && dlg.open) dlg.close();

  if (game.locked) return;

  const tiebreakOptions = buildTiebreakOptions(game.current, game.wrongGuessNames, game.wrong);
  if (tiebreakOptions) {
    // Skip the "Let's go!" intro — that's only for the automatic
    // 3-guess trigger. A voluntary trigger goes straight to the clock.
    announce("Starting tiebreak.");
    openTiebreak(tiebreakOptions, { skipIntro: true });
  } else {
    // Safety net — essentially unreachable given the player pool size.
    game.lastOutcome = "lose";
    game.lockProgressHints = true;
    showHints(false);
    announce(`Missed it — the answer was ${game.current.name}.`);
    endRound();
  }
}

/* HINTS */

function showHints(correct) {
  const panel = document.getElementById("hintPanel");

  // ❌ only block progressive hints (gender/nation)
  if (!game.lockProgressHints) {
    if (game.wrong === 1) {
      const g = document.createElement("div");
      const genderClass = (game.current.gender || "").toLowerCase();
      g.className = `hint-card gender-card ${genderClass}`;
      g.textContent = `👤 Gender: ${game.current.gender}`;
      panel.appendChild(g);
    }

    if (game.wrong === 2) {
      const n = document.createElement("div");
      n.className = "hint-card nation-card";

      const flag = nationalityToFlag(game.current.nationality);

      n.textContent = `${flag} ${game.current.nationality}`;
      panel.appendChild(n);
    }
  }

  // ✅ ALWAYS allow final answer reveal
  if (correct) {
    const a = document.createElement("div");
    a.className = "hint-card correct-card";
    a.textContent = `✅ Correct: ${game.current.name}`;
    panel.appendChild(a);
  }

  if (game.wrong >= 3 && !correct) {
    const a = document.createElement("div");
    a.className = "hint-card answer-card";
    a.textContent = `❌ Answer: ${game.current.name}`;
    panel.appendChild(a);
  }
}

/* =========================================================
   3RD SET TIEBREAK — multiple-choice salvage round
   =========================================================
   Offered after the 3rd wrong guess instead of an immediate reveal.
   A correct pick upgrades the round to a win (outcome "tiebreak"); a
   wrong pick or a 10-second timeout ends as a normal miss. */

const TIEBREAK_SECONDS = 10;
const TIEBREAK_SLAMS = ["AustralianOpen", "FrenchOpen", "Wimbledon", "USOpen"];

// All years that appear anywhere in a player's slam record (any value,
// including "A"/"NH" — this is about career overlap, not participation).
function getCareerYears(p) {
  const years = new Set();
  for (const s of TIEBREAK_SLAMS) {
    const obj = p.slams?.[s];
    if (!obj) continue;
    for (const y of Object.keys(obj)) years.add(y);
  }
  return years;
}

// `minYears` lets callers demand more than a single shared year — used to
// tighten the 0/1-guess tiers, where career overlap is the only filter (or
// the only filter besides gender) and a single shared year isn't enough of
// a plausibility signal on its own.
function hasCareerOverlap(p, targetYears, minYears) {
  const need = minYears ?? 1;
  let shared = 0;
  for (const y of getCareerYears(p)) {
    if (targetYears.has(y)) {
      shared++;
      if (shared >= need) return true;
    }
  }
  return false;
}

// Fill-to-3 across tiers: 4 total options (target + 3 distractors) is the
// target every day, not a ceiling that varies. Each tier fills whatever
// slots are still open after the tighter tiers ran dry, rather than the
// whole selection collapsing to a single tier once one has ≥1 candidate.
// Returns null only if literally zero distractors qualify even at the
// loosest tier (tiebreak should be skipped entirely — a safety net that
// shouldn't realistically trigger against this player pool).
//
// The candidate pool depends on how many guesses had been used at the
// moment the tiebreak was triggered — it mirrors exactly which hints the
// user has actually seen so far, whether the tiebreak was reached
// automatically (3 guesses) or voluntarily (0, 1, or 2):
//   0 guesses: no gender/country hint revealed yet — any player at all,
//              filtered only by career overlap: 4+ shared years first,
//              falling back to 2+ for short-career players where a 4-year
//              bar would leave too few (or zero) candidates.
//   1 guess:   gender hint revealed — same gender + overlap (4+ shared
//              years, falling back to 2+), country not yet filtered.
//   2 or 3:    both hints revealed — the full gender/country/overlap
//              cascade, unchanged from before (1+ shared year — country
//              already narrows the pool, so overlap only needs to be a
//              light plausibility check here).
// Overlap always applies at every guess count — it's a baseline
// plausibility filter, not something tied to a revealed hint.
function buildTiebreakOptions(target, guessedNames, guessesUsed) {
  const targetYears = getCareerYears(target);
  const targetScore = target.autoScore ?? 0;

  // Distractors must never repeat a name the user already guessed this
  // round — that would either give away the answer (if it matched) or
  // just look broken. The target itself is exempt: a wrong guess is by
  // definition never the target, so this only ever filters distractors.
  const guessedSet = new Set((guessedNames || []).map((n) => n.toLowerCase()));
  const eligible = (p) =>
    p !== target && p.name !== target.name && !guessedSet.has(p.name.toLowerCase());

  const closestFirst = (pool) =>
    pool.slice().sort((a, b) =>
      Math.abs((a.autoScore ?? 0) - targetScore) - Math.abs((b.autoScore ?? 0) - targetScore)
    );

  let tiers;
  if (guessesUsed === 0) {
    // 4-year overlap first; fall back to 2 years for short-career players
    // where a 4-year bar would otherwise leave too few (or zero) candidates.
    const overlap4 = game.players.filter((p) => eligible(p) && hasCareerOverlap(p, targetYears, 4));
    const overlap2 = game.players.filter((p) => eligible(p) && hasCareerOverlap(p, targetYears, 2));
    tiers = [overlap4, overlap2];
  } else if (guessesUsed === 1) {
    const sameGender = game.players.filter((p) => eligible(p) && p.gender === target.gender);
    const overlap4 = sameGender.filter((p) => hasCareerOverlap(p, targetYears, 4));
    const overlap2 = sameGender.filter((p) => hasCareerOverlap(p, targetYears, 2));
    tiers = [overlap4, overlap2];
  } else {
    // 2 or 3 guesses used — both gender and country hints revealed.
    // Country is preserved as long as possible so that hint stays
    // meaningful, and is only dropped once overlap alone can't find a
    // candidate either.
    // Tier 1: gender + country + career overlap.
    // Tier 2: gender + country                (drop overlap).
    // Tier 3: gender + career overlap          (drop country instead).
    // Tier 4: gender only                      (drop both).
    const sameGender = game.players.filter((p) => eligible(p) && p.gender === target.gender);
    const sameCountry = sameGender.filter((p) => p.nationality === target.nationality);
    const withOverlap = sameGender.filter((p) => hasCareerOverlap(p, targetYears));
    const tier1 = sameCountry.filter((p) => hasCareerOverlap(p, targetYears));
    tiers = [tier1, sameCountry, withOverlap, sameGender];
  }

  const distractors = [];
  const picked = new Set();
  for (const tier of tiers) {
    if (distractors.length >= 3) break;
    const fresh = tier.filter((p) => !picked.has(p));
    for (const p of closestFirst(fresh)) {
      if (distractors.length >= 3) break;
      distractors.push(p);
      picked.add(p);
    }
  }

  if (distractors.length === 0) return null;

  // Seeded per day so the option order is deterministic for a re-render
  // but varies day to day, same approach as the daily rotation shuffle.
  return shuffleStable([target, ...distractors], `tiebreak:${game.mode}:${game.date}`);
}

// Opens the tiebreak modal and resolves it (win/miss) before handing off
// to endRound(). `options` is the pre-shuffled array of 2-4 players.
//
// Two states inside the same dialog: an untimed intro screen ("Let's
// go!") and the play screen (options + 10s countdown). For the automatic
// 3-guess trigger the intro shows first and the clock only starts once
// the user taps through it; pass `{ skipIntro: true }` for a voluntary
// trigger (via the Tiebreak button + confirmation) to go straight to the
// play screen and start the clock immediately.
function openTiebreak(options, opts) {
  const skipIntro = !!(opts && opts.skipIntro);

  const dlg = document.getElementById("tiebreakDialog");
  if (!dlg || typeof dlg.showModal !== "function") {
    // Defensive fallback — treat as a normal loss if <dialog> isn't supported.
    game.lastOutcome = "lose";
    showHints(false);
    endRound();
    return;
  }

  game.locked = true;
  document.getElementById("guessBtn").disabled = true;
  document.getElementById("tiebreakBtn").disabled = true;

  // The grid is covered from here on, so a tiebreak win is credited with
  // what was visible when it started, not what revealed behind the dialog.
  const revealPctAtStart = currentRevealPct();

  const introEl = document.getElementById("tiebreakIntro");
  const playEl = document.getElementById("tiebreakPlay");
  const readyBtn = document.getElementById("tiebreakReadyBtn");
  const optionsEl = document.getElementById("tiebreakOptions");
  const barEl = document.getElementById("tiebreakBar");

  introEl.hidden = skipIntro;
  playEl.hidden = true;
  optionsEl.innerHTML = "";
  dlg.classList.toggle("is-intro", !skipIntro);

  let resolved = false;
  let started = false; // true once "Let's go!" is tapped — the clock only runs after this
  let rafId = null;
  let elapsedMs = 0; // accumulated run time across pause/resume segments
  let segmentStart = 0; // performance.now() when the current running segment began
  const totalMs = TIEBREAK_SECONDS * 1000;

  function stopClock() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function renderBar(frac) {
    barEl.style.transform = `scaleX(${frac})`;
  }

  // Driven every frame (not once/second) so the bar shrinks continuously
  // instead of stepping in 10 discrete per-second jumps.
  function tick(now) {
    const elapsed = elapsedMs + (now - segmentStart);
    const frac = Math.max(0, 1 - elapsed / totalMs);
    renderBar(frac);
    if (frac <= 0) {
      // One more frame so the fully-empty bar actually paints before the
      // dialog closes, instead of resolving in the same frame it was set.
      requestAnimationFrame(() => finalize(false));
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function detachLifecycleGuards() {
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("beforeunload", onLeave);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  function finalize(won) {
    if (resolved) return;
    resolved = true;
    stopClock();
    detachLifecycleGuards();
    optionsEl.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    game.lastOutcome = won ? "tiebreak" : "lose";
    game.revealPct = won ? revealPctAtStart : null;
    // Whatever guess count the tiebreak was triggered at (0-3), any
    // gender/nation hint due by that point was already shown by an
    // earlier wrong guess — block showHints() from re-adding it here.
    game.lockProgressHints = true;
    showHints(won);
    announce(won ? "Correct! Tiebreak win." : `Incorrect. Tiebreak lost — the answer was ${game.current.name}.`);
    // Open the result modal WHILE the tiebreak dialog is still open (dialogs
    // stack), then close the tiebreak dialog underneath it — closing it
    // first and letting the async "close" event trigger endRound() left a
    // ~1-frame gap with no modal open at all, flashing the page underneath.
    endRound();
    dlg.close();
  }

  // The user actually left the page (not just backgrounded the tab) while
  // the tiebreak was unresolved — forfeit it as a miss right now, written
  // synchronously to localStorage. This bypasses endRound()'s normal
  // DOM/modal flow, which the page may not survive long enough to run;
  // on a later visit maybeRestoreFinishedDaily() picks this record up and
  // shows the finished/lost state without ever reopening the tiebreak.
  function forfeitAsMiss() {
    if (resolved) return;
    resolved = true;
    stopClock();
    saveDailyResult(game.date, game.mode, {
      player: game.current.name,
      playerSnapshot: game.current,
      wrong: game.wrong,
      outcome: "lose",
    });
    saveDayResult({
      date: game.date,
      dayOfWeek: DAY_NAMES_RUNTIME[dayOfWeekIndex(game.date)],
      round: ROUND_BY_DAY[dayOfWeekIndex(game.date)].round,
      outcome: "missed",
      guesses: game.wrong,
      player: game.current.name,
    });
  }

  function onLeave() {
    forfeitAsMiss();
  }

  // Backgrounding (tab hidden) pauses the clock instead of forfeiting —
  // only meaningful once the countdown has actually started; the intro
  // screen has no clock to pause. Guarded against repeated hidden/visible
  // firings: stopClock() is idempotent, and resume only restarts the
  // rAF loop if one isn't already running, folding the elapsed time from
  // the segment that just ended into elapsedMs so the bar resumes from
  // exactly where it paused instead of losing or double-counting time.
  function onVisibilityChange() {
    if (!started || resolved) return;
    if (document.hidden) {
      if (rafId !== null) {
        elapsedMs += performance.now() - segmentStart;
        stopClock();
      }
    } else if (rafId === null && elapsedMs < totalMs) {
      segmentStart = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);
  document.addEventListener("visibilitychange", onVisibilityChange);

  options.forEach((player) => {
    const btn = document.createElement("button");
    btn.className = "tiebreak-option";
    btn.type = "button";
    btn.textContent = player.name;
    btn.addEventListener("click", () => finalize(player.name === game.current.name));
    optionsEl.appendChild(btn);
  });

  function startClock() {
    started = true;
    introEl.hidden = true;
    playEl.hidden = false;
    dlg.classList.remove("is-intro");
    renderBar(1);
    segmentStart = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  if (skipIntro) {
    startClock();
  } else {
    readyBtn.addEventListener("click", function onReady() {
      readyBtn.removeEventListener("click", onReady);
      startClock();
    }, { once: true });
  }

  dlg.showModal();
}

/* END ROUND */

function endRound() {
  const won = game.lastOutcome === "win" || game.lastOutcome === "tiebreak";

  // Round over mid-reveal: the result modal doesn't wait for the grid. A
  // paused reveal just resumes at its normal pace behind the modal.
  if (revealState.paused) toggleRevealPause();

  // record result BEFORE locking next round (practice round isn't a result)
  if (game.current && !game.isDemo) {
    game.roundHistory.push({
      player: game.current.name,
      result: won ? "correct" : game.wrong >= 3 ? "fail" : "partial",
    });
  }

  // Persist the finished daily round so revisits restore it on refresh.
  if (game.current) {
    saveDailyResult(game.date, game.mode, {
      player: game.current.name,
      // Full snapshot of the player as they existed at play time. Future
      // pool updates can reshuffle the schedule freely; revisits to this
      // date will replay against this snapshot, not the current rotation.
      playerSnapshot: game.current,
      wrong: game.wrong,
      outcome: game.lastOutcome,
      revealPct: won ? game.revealPct : null,
    });
    // Per-day history for the week strip (first attempt only). "tiebreak"
    // counts as won everywhere (championship, week-strip ✓) but keeps its
    // own outcome value so the restore flow can show tiebreak branding.
    const histOutcome =
      game.lastOutcome === "win" ? "won" :
      game.lastOutcome === "tiebreak" ? "tiebreak" : "missed";
    saveDayResult({
      date: game.date,
      dayOfWeek: DAY_NAMES_RUNTIME[dayOfWeekIndex(game.date)],
      round: ROUND_BY_DAY[dayOfWeekIndex(game.date)].round,
      outcome: histOutcome,
      guesses: game.lastOutcome === "win" ? game.wrong + 1 : game.wrong,
      player: game.current.name,
      revealPct: won ? game.revealPct : null,
    });
    paintRoundButton();
  }

  game.locked = true;

  document.getElementById("guessBtn").disabled = true;
  document.getElementById("tiebreakBtn").disabled = true;
  document.getElementById("shareBtn").disabled = !!game.isDemo; // nothing to share from practice

  updateUI();

  // Open the modal first. The countdown stays hidden until the user
  // closes the modal — that dismissal becomes the "see you tomorrow"
  // reveal moment.
  openResultModal();
}

function populateWeekStrip(containerEl) {
  if (!containerEl) return;
  const todayIso = game.date || todayLocal();
  const weekResults = getWeekResults(todayIso);
  const todayIdx = dayOfWeekIndex(todayIso);
  const showPctRow = weekResults.some((r) => isDayWon(r) && partialRevealPct(r.revealPct) !== null);

  containerEl.innerHTML = "";

  weekResults.forEach((result, i) => {
    const cell = document.createElement("div");
    cell.className = "week-cell";

    if (result) {
      cell.classList.add(isDayWon(result) ? "is-won" : "is-missed");
    } else if (i === todayIdx) {
      cell.classList.add("is-today");
    } else if (i < todayIdx) {
      cell.classList.add("is-past-unplayed");
    } else {
      cell.classList.add("is-future");
    }

    const labelEl = document.createElement("span");
    labelEl.className = "week-cell-label";
    labelEl.textContent = DAY_LABELS[i];
    cell.appendChild(labelEl);

    const markerEl = document.createElement("span");
    markerEl.className = "week-cell-marker";
    if (result) {
      markerEl.textContent = isDayWon(result) ? "✅" : "❌";
    }
    cell.appendChild(markerEl);

    // Reveal % under the ✅ for early wins; the row only exists when some
    // day this week has one, so a week without any adds no height.
    if (showPctRow) {
      const pctEl = document.createElement("span");
      pctEl.className = "week-cell-pct";
      const pct = isDayWon(result) ? partialRevealPct(result.revealPct) : null;
      if (pct !== null) {
        pctEl.textContent = `${pct}%`;
        pctEl.setAttribute("aria-label", `${pct}% of their career revealed`);
      }
      cell.appendChild(pctEl);
    }

    containerEl.appendChild(cell);
  });
}

// Open the round-end modal. "Winner" (lime glow) on a correct
// guess, "Missed" (orange border) after 3 wrong.
function openResultModal() {
  const dlg = document.getElementById("resultDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;

  const isTiebreak = game.lastOutcome === "tiebreak";
  const won = game.lastOutcome === "win" || isTiebreak;

  // Border treatment via class on the dialog itself
  dlg.classList.remove("is-win", "is-loss");
  dlg.classList.add(won ? "is-win" : "is-loss");

  // Outcome label — emoji + word, both colored by parent state
  const outcome = document.getElementById("resultOutcome");
  outcome.classList.remove("is-win", "is-loss");
  outcome.classList.add(won ? "is-win" : "is-loss");
  const champion = won && !game.isDemo && isChampionThisWeek(game.date || todayLocal());
  outcome.textContent = champion ? "🏆 Champion" : isTiebreak ? "Tiebreak Win!" : won ? "Winner" : "Missed It";

  // Share button glows on any win (plain win, tiebreak, or championship —
  // "champion" only ever fires when `won` is already true, so this one
  // flag covers all three). No glow on a miss.
  const shareBtn = document.getElementById("resultShareBtn");
  if (shareBtn) shareBtn.classList.toggle("is-glowing", won);

  // Practice round: no Share (nothing to share yet) and no week strip
  // (it's about real results) — just the way into today's puzzle.
  const demo = !!game.isDemo;
  if (shareBtn) shareBtn.hidden = demo;
  document.getElementById("resultPlayTodayBtn").hidden = !demo;
  document.querySelector(".result-week-divider").hidden = demo;
  document.getElementById("resultWeekStrip").hidden = demo;

  // Player name with country flag to the right
  const playerEl = document.getElementById("resultPlayer");
  playerEl.innerHTML = "";
  if (game.current) {
    const nameSpan = document.createElement("span");
    nameSpan.textContent = game.current.name;
    playerEl.appendChild(nameSpan);

    const flag = nationalityToFlag(game.current.nationality);
    if (flag) {
      const flagSpan = document.createElement("span");
      flagSpan.className = "result-flag";
      flagSpan.textContent = flag;
      playerEl.appendChild(flagSpan);
    }
  }

  // Early-win brag line: how little of the career was showing.
  const revealEl = document.getElementById("resultReveal");
  const pct = won ? partialRevealPct(game.revealPct) : null;
  revealEl.hidden = pct === null;
  revealEl.textContent = pct === null ? "" : `Solved with ${pct}% of their career revealed`;

  dlg.showModal();
  populateWeekStrip(document.getElementById("resultWeekStrip"));
}

// Gentle reveal of the courtside countdown clock — only appears after the
// user's round is over. Lives at the bottom of the page as a "see you
// tomorrow" moment, not a constant fixture.
function revealCountdown() {
  const el = document.getElementById("countdown");
  if (!el) return;
  if (!el.hasAttribute("hidden") && el.classList.contains("is-visible")) return;
  el.hidden = false;
  // Force a frame so the transition runs from opacity 0 → 1.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("is-visible"));
  });
}

/* AUTOCOMPLETE (CHANGED ONLY SOURCE) */

/* Strip diacritics for fuzzy autocomplete matching ("Alex" should find
   "Àlex Corretja"). Built once after the guess pool loads. */
function deaccent(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* Accent- and word-order-insensitive key for guess matching. guess() used
   to compare raw lowercased strings, which meant a guess_pool.json entry
   whose name-token order didn't match the player's canonical `name` field
   (e.g. "Han Xinyun" as a guess when the record is "Xinyun Han") would
   register a correct pick as wrong. Sorting tokens closes that whole class
   of bug regardless of what order future data ends up in. */
function sortedNameKey(s) {
  return deaccent(s)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

let guessPoolIndex = []; // [{ display: "Àlex Corretja", search: "alex corretja" }]

function buildGuessPoolIndex() {
  guessPoolIndex = game.guessPool.map((name) => ({
    display: name,
    search: deaccent(name).toLowerCase(),
  }));
}

function updateSuggestions() {
  game.suggestionIndex = -1;
  game.suggestionItems = [];

  game.selectedSuggestion = false;

  const rawInput = document.getElementById("guess").value;
  const input = deaccent(rawInput).toLowerCase();

  const box = document.getElementById("suggestions");
  const guessInput = document.getElementById("guess");

  if (input.length < 3) {
    box.style.display = "none";
    guessInput.setAttribute("aria-expanded", "false");
    guessInput.removeAttribute("aria-activedescendant");
    return;
  }

  // Match against the deaccented index, return the original display name.
  const matches = guessPoolIndex
    .filter((p) => p.search.includes(input))
    .slice(0, 8)
    .map((p) => p.display);

  box.innerHTML = "";
  matches.forEach((m) => {
    const div = document.createElement("div");
    div.className = "suggestion";
    div.textContent = m;

    const index = game.suggestionItems.length;
    div.dataset.index = index;
    div.id = `suggestion-opt-${index}`;
    div.setAttribute("role", "option");
    div.setAttribute("aria-selected", "false");

    game.suggestionItems.push(div);

    div.onclick = () => {
      document.getElementById("guess").value = m;
      game.selectedSuggestion = true;
      hideSuggestions();
    };

    box.appendChild(div);
  });

  box.style.display = matches.length ? "block" : "none";
  guessInput.setAttribute("aria-expanded", matches.length ? "true" : "false");
  guessInput.removeAttribute("aria-activedescendant");
}

function hideSuggestions() {
  document.getElementById("suggestions").style.display = "none";
  const guessInput = document.getElementById("guess");
  guessInput.setAttribute("aria-expanded", "false");
  guessInput.removeAttribute("aria-activedescendant");
}
function updateHighlight() {
  const items = game.suggestionItems;
  const guessInput = document.getElementById("guess");

  for (let i = 0; i < items.length; i++) {
    if (i === game.suggestionIndex) {
      items[i].style.background = "#1e293b";
      items[i].style.color = "white";
      items[i].setAttribute("aria-selected", "true");
      guessInput.setAttribute("aria-activedescendant", items[i].id);

      const box = document.getElementById("suggestions");

      const item = items[i];

      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;

      const boxTop = box.scrollTop;
      const boxBottom = boxTop + box.offsetHeight;

      if (itemTop < boxTop) {
        box.scrollTop = itemTop;
      }

      if (itemBottom > boxBottom) {
        box.scrollTop = itemBottom - box.offsetHeight;
      }
    } else {
      items[i].style.background = "";
      items[i].style.color = "";
      items[i].setAttribute("aria-selected", "false");
    }
  }

  if (game.suggestionIndex < 0) {
    guessInput.removeAttribute("aria-activedescendant");
  }
}

/* SHARE */

/* =========================================================
   SHARE — spoiler-free, emoji-forward summary
   =========================================================
   Reveals effort (guesses used) and mode, never the player.
   Format:
     🎾 Slam Grid — Daily 2026-05-27 · Standard
     ✅ Solved in 2/3
     🔴 🟢 ⚪
     https://...
*/

function buildShareLines() {
  const isTiebreak = game.lastOutcome === "tiebreak";
  const won = game.lastOutcome === "win" || isTiebreak;
  const wrong = game.wrong;
  const guessNum = won ? wrong + 1 : null;

  // Header — friendly date ("May 28")
  let tag = "";
  if (game.date) {
    const [y, m, d] = game.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    tag = dt.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }
  const header = `Slam Grid — ${tag}`;

  // Balls row — a tennis ball for each used attempt (right or wrong),
  // ⚪ for unused. Ends in ✅ on a win or ❌ on a loss.
  // "Used" = the slot was filled by a guess (correct or not). When the
  // round ends in a win, the final correct guess counts as used; when
  // it ends in a loss, the wrong guesses count as used.
  // A tiebreak win skips the ball count entirely — it doesn't map to a
  // guess count the same way — and states the salvage outright.
  let ballsLine;
  if (isTiebreak) {
    ballsLine = "🎾 I won in a tiebreak!";
  } else {
    const attemptsUsed = won ? guessNum : wrong;
    const balls = [];
    for (let i = 0; i < 3; i++) {
      balls.push(i < attemptsUsed ? "🎾" : "⚪");
    }
    balls.push(won ? " ✅" : " ❌");
    ballsLine = balls.join("");
  }

  // Career stat line — count of W / F / SF / QF across the player's slams.
  let statLine = null;
  if (game.current && game.current.slams) {
    const counts = { W: 0, F: 0, SF: 0, QF: 0 };
    for (const t of Object.values(game.current.slams)) {
      for (const r of Object.values(t)) {
        if (counts[r] !== undefined) counts[r]++;
      }
    }
    const parts = [];
    if (counts.W) parts.push(`${counts.W} 🟩`);
    if (counts.F) parts.push(`${counts.F} 🟪`);
    if (counts.SF) parts.push(`${counts.SF} 🟨`);
    if (counts.QF) parts.push(`${counts.QF} 🟧`);
    if (parts.length) statLine = parts.join("  ");
  }

  return { header, ballsLine, statLine };
}

function share() {
  // Daily is "today only" — recipients of a shared link will see their own
  // today, not the sharer's. Always share the bare URL.
  const url = `${window.location.origin}${window.location.pathname}`;

  const { header, ballsLine, statLine } = buildShareLines();

  const text = [header, ballsLine, statLine].filter(Boolean).join("\n");
  const fullText = `${text}\n\n${url}`;

  if (isMobileDevice() && navigator.share) {
    navigator
      .share({
        title: "🎾 Slam Grid",
        text,
        url,
      })
      .catch(() => {});
    return;
  }

  navigator.clipboard
    .writeText(fullText)
    .then(() => showMessage("📋 Copied!"))
    .catch(() => showMessage("Couldn't copy"));
}

/* =========================================================
   STORY IMAGE SHARE
   ========================================================= */

const SHARE_URL = "TEST";

// Returns a canvas-ready color/text config for a result value.
function storyCell(v) {
  if (!v || v === "") return { bg: "#243f32", fg: "transparent", label: "" };
  const d = displayResult(v);
  if (v === "W")  return { bg: "#16a34a", fg: "#ffffff", label: d };
  if (v === "F")  return { bg: "#c084fc", fg: "#2e1065", label: d };
  if (v === "SF") return { bg: "#fde047", fg: "#713f12", label: d };
  if (v === "QF") return { bg: "#fdba74", fg: "#7c2d12", label: d };
  if (v === "4R" || v === "3R" || v === "2R" || v === "1R")
                  return { bg: "#3b82f6", fg: "#ffffff", label: d };
  if (v === "A")  return { bg: "#c5cac6", fg: "#4a6e63", label: d };
  if (v === "NH") return { bg: "#115e59", fg: "#ffffff", label: d };
  if (v.startsWith("Q")) return { bg: "#93c5fd", fg: "#1e3a8a", label: d };
  return { bg: "#e8eae6", fg: "#666666", label: d };
}

// Pick the best 8-consecutive-year window for the story grid.
// Strength per cell: W=7, F=6, SF=5, QF=4, 4R=3, 3R=2, 2R=1, 1R=0.5, else=0.
function pickYearWindow(p, slams, allYears) {
  if (allYears.length <= 8) return allYears;
  const strength = { W: 15, F: 10, SF: 8, QF: 6, "4R": 2, "3R": 1, "2R": 1, "1R": 0.5 };
  let bestScore = -1, bestStart = 0;
  for (let start = 0; start <= allYears.length - 8; start++) {
    let score = 0;
    for (let yi = start; yi < start + 8; yi++) {
      const y = allYears[yi];
      for (const slam of slams) {
        const v = p.slams?.[slam]?.[y] || "";
        score += strength[v] || 0;
      }
    }
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  return allYears.slice(bestStart, bestStart + 8);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Drawing helpers shared by both share images.
function canvasKit(ctx) {
  // Renders an emoji to a tiny offscreen canvas and scans the alpha channel
  // to find the true pixel bounding box. Returns the visual center as an
  // offset from the draw origin. This bypasses measureText entirely, which
  // mis-reports advance width for regional indicator flag emoji on iOS.
  function measureEmojiCenter(text, fontSize) {
    const tmpSize = Math.ceil(fontSize * 2.5);
    const tmp = document.createElement("canvas");
    tmp.width = tmpSize;
    tmp.height = tmpSize;
    const tc = tmp.getContext("2d");
    tc.font = `${fontSize}px serif`;
    tc.textBaseline = "top";
    tc.textAlign = "left";
    tc.fillStyle = "#ffffff";
    tc.fillText(text, 0, 0);
    const { data } = tc.getImageData(0, 0, tmpSize, tmpSize);
    let minX = tmpSize, maxX = 0, minY = tmpSize, maxY = 0, found = false;
    for (let py = 0; py < tmpSize; py++) {
      for (let px = 0; px < tmpSize; px++) {
        if (data[(py * tmpSize + px) * 4 + 3] > 30) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          found = true;
        }
      }
    }
    return found
      ? { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
      : { cx: fontSize / 2, cy: fontSize / 2 };
  }

  function drawEmojiCentered(text, centerX, centerY, fontSize) {
    const { cx, cy } = measureEmojiCenter(text, fontSize);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text, centerX - cx, centerY - cy);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return { drawEmojiCentered, roundRect };
}

// Logo for both share images: og_image.png drawn large, with its tiny
// baked-in tagline (source px x497-883, y371-401) painted over in the
// background green and redrawn at a readable size in the same spot. If the
// logo artwork changes, those coordinates need updating.
async function drawShareLogo(ctx, W, centerY) {
  try {
    const logo = await loadImage("./og_image.png");
    const LOGO_W = 860, LOGO_H = LOGO_W * (logo.height / logo.width);
    const LX = (W - LOGO_W) / 2, LY = centerY - LOGO_H / 2, LS = LOGO_W / logo.width;
    ctx.drawImage(logo, LX, LY, LOGO_W, LOGO_H);
    ctx.fillStyle = "#1d3e35";
    ctx.fillRect(LX + 490 * LS, LY + 364 * LS, 410 * LS, 46 * LS);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgb(198, 207, 204)";
    ctx.font = "italic 32px Georgia, serif";
    ctx.fillText("A game for tennis fans.", LX + 500 * LS, LY + 400 * LS);
  } catch {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 54px Georgia, serif";
    ctx.fillText("SLAM GRID", W / 2, centerY + 8);
    ctx.fillStyle = "rgb(198, 207, 204)";
    ctx.font = "italic 32px Georgia, serif";
    ctx.fillText("A game for tennis fans.", W / 2, centerY + 58);
  }
  ctx.textAlign = "center";
}

// Logo + date block shared by both share images (same size and place).
const SHARE_LOGO_CENTER_Y = 292;
const SHARE_DATE_Y = 492;
function drawShareDate(ctx, W) {
  const [fy, fm, fd] = (game.date || todayLocal()).split("-").map(Number);
  ctx.textAlign = "center";
  ctx.fillStyle = "#9ab8b0";
  ctx.font = "36px Georgia, serif";
  ctx.fillText(new Date(fy, fm - 1, fd).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }), W / 2, SHARE_DATE_Y);
}

function drawShareCta(ctx, W, y) {
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "36px Georgia, serif";
  ctx.fillText("Play every day at", W / 2, y);
  ctx.fillStyle = "#a5e85a";
  ctx.font = "bold 60px Georgia, serif";
  ctx.fillText(SHARE_URL, W / 2, y + 78);
}

// Headline shared by both share images.
function shareResultLine() {
  const isTiebreak = game.lastOutcome === "tiebreak";
  const won = game.lastOutcome === "win" || isTiebreak;
  const guessNum = game.wrong + 1;
  if (won && isChampionThisWeek(game.date || todayLocal())) return { text: "I am a Slam Grid Champion!", color: "#a5e85a" };
  if (isTiebreak) return { text: "I won in a tiebreak!", color: "#a5e85a" };
  if (won) return { text: guessNum === 1 ? "I got it in 1 guess" : `I got it in ${guessNum} guesses`, color: "#a5e85a" };
  return { text: "Missed it!", color: "#fdba74" };
}

// One-line summary of the week for the weekly-results image.
const NEXT_ROUND_NAME = ["Round 2", "Round 3", "Round 4", "the Quarterfinals", "the Semifinals", "the Final"];
function weekStatusLine(weekResults, todayIdx) {
  const upToToday = weekResults.slice(0, todayIdx + 1);
  const played = upToToday.filter(Boolean).length;
  const wins = upToToday.filter(isDayWon).length;
  const skipped = weekResults.slice(0, todayIdx).filter((r) => !r).length;

  if (todayIdx === 6 && wins === 7) return "🏆 7 for 7 — Champion";
  if (todayIdx === 6 && weekResults[6]) {
    if (isDayWon(weekResults[6])) return `${wins} for ${played} — won the Final`;
    if (wins === 6) return "6 for 7 — fell in the Final";
  }
  if (!skipped && played && wins === played) return `${wins} for ${played} — through to ${NEXT_ROUND_NAME[todayIdx]}`;
  if (skipped) return `${wins} for ${played} played this week`;
  let streak = 0;
  for (let i = todayIdx; i >= 0 && isDayWon(weekResults[i]); i--) streak++;
  if (streak >= 3) return `${streak} straight — ${wins} for ${played} this week`;
  return `${wins} for ${played} this week`;
}

async function buildStoryImage() {
  const p = game.current;
  if (!p) return null;

  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1d3e35";
  ctx.fillRect(0, 0, W, H);

  const { drawEmojiCentered, roundRect } = canvasKit(ctx);

  const isTiebreak = game.lastOutcome === "tiebreak";
  const won = game.lastOutcome === "win" || isTiebreak;

  // 1. LOGO + DATE
  await drawShareLogo(ctx, W, SHARE_LOGO_CENTER_Y);
  drawShareDate(ctx, W);

  // 2. RESULT LINE (fixed y)
  const { text: resultLine, color: resultColor } = shareResultLine();

  ctx.textAlign = "center";
  ctx.fillStyle = resultColor;
  ctx.font = "bold 62px Georgia, serif";
  ctx.fillText(resultLine, W / 2, 572);

  // 3. PROMPT (fixed y)
  ctx.fillStyle = "#ffffff";
  ctx.font = "40px Georgia, serif";
  ctx.fillText("Can you name this player?", W / 2, 632);

  // 4. GRID CARD + CELLS
  const slams = ["AustralianOpen", "FrenchOpen", "Wimbledon", "USOpen"];
  const FLAGS = { AustralianOpen: "🇦🇺", FrenchOpen: "🇫🇷", Wimbledon: "🇬🇧", USOpen: "🇺🇸" };

  const allYears = [...new Set(slams.flatMap((s) => Object.keys(p.slams?.[s] || {})))]
    .map(Number).sort((a, b) => a - b).map(String);
  const years = pickYearWindow(p, slams, allYears);
  const numRows = years.length;

  const GRID_TOP_BASELINE = 795;
  const ROW_H = numRows === 8 ? 68 : 72; // tighten for 8 rows to keep footer in safe zone
  const CELL_W = 184;
  const CELL_H = 62;
  const CELL_R = 9;

  const cardX = 54, cardY = 680, cardW = 972;
  const cardH = numRows * ROW_H + 90;

  roundRect(cardX, cardY, cardW, cardH, 20);
  ctx.fillStyle = "#15302a";
  ctx.fill();
  ctx.strokeStyle = "#2a4a3a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Column left edges — shared by flag headers and grid rows
  const colLefts = [198, 398, 598, 798];

  // Flag headers — centered over each column using the same colLefts + CELL_W/2
  ctx.textAlign = "center";
  ctx.font = "52px serif";
  slams.forEach((slam, ci) => {
    drawEmojiCentered(FLAGS[slam], colLefts[ci] + CELL_W / 2, 722, 52);
  });
  years.forEach((y, r) => {
    const rowBaseline = GRID_TOP_BASELINE + r * ROW_H;

    ctx.textAlign = "right";
    ctx.fillStyle = "#9ab8b0";
    ctx.font = "bold 32px Georgia, serif";
    ctx.fillText(`'${String(y).slice(2)}`, 160, rowBaseline);

    slams.forEach((slam, ci) => {
      const rawV = p.slams?.[slam]?.[y] || "";
      const gated =
        y === DATA_FRESHNESS_YEAR &&
        DATA_FRESHNESS_HIDE_SLAMS.includes(slam) &&
        rawV !== "A" && rawV !== "NH" && rawV !== "";
      const v = gated ? "" : rawV;
      const { bg, fg, label: cellLabel } = storyCell(v);

      const cellX = colLefts[ci];
      const cellY = rowBaseline - 42;

      roundRect(cellX, cellY, CELL_W, CELL_H, CELL_R);
      ctx.fillStyle = bg;
      ctx.fill();

      if (cellLabel) {
        ctx.textAlign = "center";
        ctx.fillStyle = fg;
        ctx.font = "bold 30px Georgia, serif";
        ctx.fillText(cellLabel, cellX + CELL_W / 2, cellY + CELL_H / 2 + 11);
      }
    });
  });

  const gridBottom = cardY + cardH;

  // 5. CTA — flows from gridBottom
  drawShareCta(ctx, W, gridBottom + 110);

  return canvas;
}

/* Weekly-results share image — spoiler-free: the week is drawn as a row of
   grid cells in the game's round colors (R1-R4 blue, QF orange, SF yellow,
   F purple; a champion's Sunday turns into a green W), each marked won,
   missed, or skipped. Nothing about today's player appears. */
const WEEK_CELL_STYLE = [
  { bg: "#3b82f6", fg: "#ffffff" }, { bg: "#3b82f6", fg: "#ffffff" },
  { bg: "#3b82f6", fg: "#ffffff" }, { bg: "#3b82f6", fg: "#ffffff" },
  { bg: "#fdba74", fg: "#7c2d12" }, { bg: "#fde047", fg: "#713f12" },
  { bg: "#c084fc", fg: "#2e1065" },
];
const WEEKDAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

async function buildWeekImage() {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const { drawEmojiCentered, roundRect } = canvasKit(ctx);
  const todayIso = game.date || todayLocal();

  ctx.fillStyle = "#1d3e35";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";

  // 1. LOGO + DATE
  await drawShareLogo(ctx, W, SHARE_LOGO_CENTER_Y);
  drawShareDate(ctx, W);

  // 3. HEADLINE (+ reveal % on an early win), centered as a block between
  //    the date (text bottom ~500) and the week card (top 690)
  const won = game.lastOutcome === "win" || game.lastOutcome === "tiebreak";
  const revealPct = won ? partialRevealPct(game.revealPct) : null;
  const CAP = 46, PCT_GAP = 54;
  const blockH = revealPct !== null ? CAP + PCT_GAP + 8 : CAP;
  const headY = 500 + (190 - blockH) / 2 + CAP;
  const { text: headline, color: headColor } = shareResultLine();
  ctx.fillStyle = headColor;
  ctx.font = "bold 64px Georgia, serif";
  ctx.fillText(headline, W / 2, headY);
  if (revealPct !== null) {
    ctx.fillStyle = "#a5e85a";
    ctx.font = "italic 36px Georgia, serif";
    ctx.fillText(`with only ${revealPct}% of their career revealed`, W / 2, headY + PCT_GAP);
  }

  // 4. WEEK CARD
  const weekResults = getWeekResults(todayIso);
  const todayIdx = dayOfWeekIndex(todayIso);
  const champion = isChampionThisWeek(todayIso);
  const cardX = 54, cardY = 690, cardW = 972, cardH = 470;
  roundRect(cardX, cardY, cardW, cardH, 24);
  ctx.fillStyle = "#15302a";
  ctx.fill();
  ctx.strokeStyle = "#2a4a3a";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px Georgia, serif";
  ctx.fillText("My Slam Grid week", W / 2, cardY + 68);

  const N = 7, GAP = 14;
  const cellW = Math.floor((cardW - 60 - GAP * (N - 1)) / N), cellH = 150;
  const cellY = cardY + 140;
  weekResults.forEach((result, i) => {
    const x = cardX + 30 + i * (cellW + GAP);
    const cx = x + cellW / 2;
    const isToday = i === todayIdx;
    const skipped = i < todayIdx && !result;
    const future = i > todayIdx;
    const champSunday = champion && i === 6;
    const style = champSunday ? { bg: "#16a34a", fg: "#ffffff" } : WEEK_CELL_STYLE[i];

    ctx.fillStyle = isToday ? "#ffffff" : "#9ab8b0";
    ctx.font = "bold 26px Georgia, serif";
    ctx.fillText(WEEKDAY_SHORT[i], cx, cellY - 22);

    ctx.globalAlpha = future ? 0.28 : skipped ? 0.4 : 1;
    roundRect(x, cellY, cellW, cellH, 16);
    ctx.fillStyle = style.bg;
    ctx.fill();
    ctx.fillStyle = style.fg;
    ctx.font = "bold 46px Georgia, serif";
    ctx.fillText(champSunday ? "W" : DAY_LABELS[i], cx, cellY + cellH / 2 + 16);
    ctx.globalAlpha = 1;

    if (isToday) {
      roundRect(x - 6, cellY - 6, cellW + 12, cellH + 12, 20);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    const markY = cellY + cellH + 46;
    if (result) {
      ctx.font = "44px serif";
      drawEmojiCentered(isDayWon(result) ? "✅" : "❌", cx, markY, 44);
    } else if (skipped) {
      ctx.fillStyle = "#6b8a80";
      ctx.font = "bold 44px Georgia, serif";
      ctx.fillText("–", cx, markY + 12);
    }
  });

  ctx.fillStyle = champion ? "#a5e85a" : "#ffffff";
  ctx.font = "bold 40px Georgia, serif";
  ctx.fillText(weekStatusLine(weekResults, todayIdx), W / 2, cardY + cardH - 40);

  // 5. CTA
  drawShareCta(ctx, W, 1290);

  return canvas;
}

// kind: "grid" (today's grid) or "week" (weekly results)
async function shareImage(kind = "grid") {
  if (!game.current) return;
  const canvas = await (kind === "week" ? buildWeekImage() : buildStoryImage());
  if (!canvas) throw new Error("share image builder returned null");

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("toBlob produced no data")); return; }

      const todayIso = game.date || todayLocal();
      const filename = kind === "week" ? `slam-grid-week-${todayIso}.png` : `slam-grid-${todayIso}.png`;

      function downloadBlob() {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        // Must be in the DOM for Safari/Firefox to honour the click
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showMessage("Image saved — post it to your story!");
        resolve();
      }

      const file = new File([blob], filename, { type: "image/png" });
      if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: "Slam Grid",
          text: kind === "week" ? "My Slam Grid week — play every day at " + SHARE_URL : "Can you name this player? Play at " + SHARE_URL,
        }).then(resolve).catch((err) => {
          if (err && err.name === "AbortError") { resolve(); return; }
          // Share failed (e.g. user-activation expired) — fall back to download
          downloadBlob();
        });
      } else {
        downloadBlob();
      }
    }, "image/png");
  });
}

/* =========================================================
   SHARE MENU
   ========================================================= */

let _shareMenuCleanup = null;
let _shareMenuOpen = false;

function openSharePopover(event) {
  const menu = document.getElementById("sharePopover");
  if (!menu) return;

  // Toggle closed if already open
  if (_shareMenuOpen) { closeSharePopover(); return; }

  const btn = event.currentTarget;
  const wrap = btn.closest(".share-wrap");
  if (!wrap) return;

  // Reparent the menu into the triggering button's wrapper. When triggered
  // from the result modal, this puts the menu inside the modal's stacking
  // context (top-layer), so it renders above the modal automatically.
  wrap.appendChild(menu);

  menu.classList.add("is-open");
  _shareMenuOpen = true;

  // Defer outside-click listener by one tick so the opening click itself
  // doesn't immediately trigger it.
  setTimeout(() => {
    function onOutside(e) {
      if (!menu.contains(e.target) && e.target !== btn) closeSharePopover();
    }
    function onKey(e) {
      if (e.key === "Escape") closeSharePopover();
    }
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
    _shareMenuCleanup = () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey);
      _shareMenuOpen = false;
    };
  }, 0);
}

function closeSharePopover() {
  const menu = document.getElementById("sharePopover");
  if (menu) menu.classList.remove("is-open");
  if (_shareMenuCleanup) { _shareMenuCleanup(); _shareMenuCleanup = null; }
}

function sharePopoverText() {
  closeSharePopover();
  share();
}

// kind: "grid" (today's grid) or "week" (weekly results)
function sharePopoverImage(kind) {
  closeSharePopover();
  if (!game.current) { showMessage("Finish today's game first"); return; }
  shareImage(kind).catch((err) => {
    console.error("shareImage failed:", err);
    showMessage("Couldn't create image — try again");
  });
}

/* CLASS MAP */

function cls(v) {
  if (!v) return "";

  if (v === "W") return "W";
  if (v === "F") return "F";
  if (v === "SF") return "SF";
  if (v === "QF") return "QF";

  if (v === "4R") return "R4";
  if (v === "3R") return "R3";
  if (v === "2R") return "R2";
  if (v === "1R") return "R1";

  if (v === "A") return "A";
  if (v === "NH") return "NH";

  if (v === "Q1") return "Q1";
  if (v === "Q2") return "Q2";
  if (v === "Q3") return "Q3";

  if (v.includes("Q")) return "Q";

  return "";
}

/* Display label for a result value. Data uses "4R/3R/2R/1R" historically
   (Wikipedia convention), but the rest of the product talks about rounds
   as "R1/R2/R3/R4" (Slam Grid convention, matches the difficulty chart).
   This is a display-only flip — the underlying data stays untouched. */
function displayResult(v) {
  if (v === "4R") return "R4";
  if (v === "3R") return "R3";
  if (v === "2R") return "R2";
  if (v === "1R") return "R1";
  return v;
}

/* RENDER */

function isMobileLayout() {
  return window.innerWidth <= 640;
}

let _lastLayoutIsMobile = null;

const MOBILE_SLAM_LABELS = {
  AustralianOpen: "AO 🇦🇺",
  FrenchOpen:     "RG 🇫🇷",
  Wimbledon:      "W 🇬🇧",
  USOpen:         "USO 🇺🇸",
};

function buildDesktopTable(p, years, slams) {
  const SLAM_LABELS = {
    AustralianOpen: "Australian Open",
    FrenchOpen: "French Open",
    Wimbledon: "Wimbledon",
    USOpen: "US Open",
  };

  let html = "<thead><tr><th>Slam</th>";
  years.forEach((y) => { html += `<th>${y}</th>`; });
  html += "</tr></thead><tbody>";

  for (let rowIdx = 0; rowIdx < slams.length; rowIdx++) {
    const slam = slams[rowIdx];
    html += `<tr><td class="slam">${SLAM_LABELS[slam] || slam}</td>`;
    for (let colIdx = 0; colIdx < years.length; colIdx++) {
      const y = years[colIdx];
      const v = p.slams?.[slam]?.[y] || "";
      const gated =
        y === DATA_FRESHNESS_YEAR &&
        DATA_FRESHNESS_HIDE_SLAMS.includes(slam) &&
        v !== "A" && v !== "NH" && v !== "";
      const displayV = gated ? "" : v;
      html += `<td class="${cls(displayV)} reveal-cell" data-row="${rowIdx}" data-col="${colIdx}" data-key="${slam}:${y}">${displayResult(displayV)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  return { html, numCols: years.length, numRows: slams.length };
}

function buildMobileTable(p, years, slams) {
  let html = "<thead><tr><th class='year-col'>Year</th>";
  for (const slam of slams) {
    html += `<th>${MOBILE_SLAM_LABELS[slam] || slam}</th>`;
  }
  html += "</tr></thead><tbody>";

  years.forEach((y, rowIdx) => {
    html += `<tr><td class="year-col">${y}</td>`;
    slams.forEach((slam, colIdx) => {
      const v = p.slams?.[slam]?.[y] || "";
      const gated =
        y === DATA_FRESHNESS_YEAR &&
        DATA_FRESHNESS_HIDE_SLAMS.includes(slam) &&
        v !== "A" && v !== "NH" && v !== "";
      const displayV = gated ? "" : v;
      html += `<td class="${cls(displayV)} reveal-cell" data-row="${rowIdx}" data-col="${colIdx}" data-key="${slam}:${y}">${displayResult(displayV)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  return { html, numCols: slams.length, numRows: years.length };
}

function render() {
  const p = game.current;

  const slams = Object.keys(p.slams || {});

  const years = [...new Set(slams.flatMap((s) => Object.keys(p.slams?.[s] || {})))]
    .map(Number)
    .sort((a, b) => a - b)
    .map(String);

  const hasFresh = slams.some((s) => !!p.slams?.[s]?.[DATA_FRESHNESS_YEAR]);

  const mobile = isMobileLayout();
  _lastLayoutIsMobile = mobile;
  const { html, numCols, numRows } = mobile
    ? buildMobileTable(p, years, slams)
    : buildDesktopTable(p, years, slams);

  // A re-render (new round, or crossing the mobile/desktop breakpoint
  // mid-reveal) replaces every cell — drop any reveal still in flight.
  stopReveal();
  document.getElementById("table").innerHTML = html;

  const existingFoot = document.getElementById("freshnessFoot");
  if (existingFoot) existingFoot.remove();
  if (hasFresh && SHOW_FRESHNESS_NOTICE) {
    const foot = document.createElement("p");
    foot.id = "freshnessFoot";
    foot.className = "freshness-foot";
    foot.innerHTML =
      `<span class="freshness-long">${DATA_FRESHNESS_LABEL}</span>` +
      `<span class="freshness-short">${DATA_FRESHNESS_LABEL_SHORT}</span>`;
    document.querySelector(".table-footer").append(foot);
  }

  // Trigger the column-by-column reveal animation. Skipped on restores
  // (the user has already seen this player), only fires on fresh rounds.
  if (game._skipReveal) {
    // Full grid on screen (finished-day restore, layout-breakpoint
    // re-render) — it's all been seen now.
    markAllCellsSeen();
  } else {
    // Pre-mark not-yet-seen cells as hidden immediately so the gray plate
    // is in place even if the actual reveal is deferred (e.g. how-to modal
    // is open). Cells seen on an earlier visit today stay showing.
    const seen = revealedKeys();
    const cells = document.querySelectorAll("#table .reveal-cell");
    cells.forEach((c) => c.classList.toggle("is-hidden", !seen.has(c.dataset.key)));

    const howTo = document.getElementById("howToDialog");
    const howToOpen = howTo && howTo.open;
    const willShowHowTo = !localStorage.getItem("slamGuesserSimple.seenHowTo.v1");

    if (howToOpen || willShowHowTo) {
      // Defer the reveal until the modal is closed.
      game._pendingReveal = { cols: numCols, rows: numRows, rowMajor: mobile };
    } else {
      animateReveal(numCols, numRows, mobile);
    }
  }

  // After the table updates, refresh the "scroll for full career" hint
  // (runs on next frame so layout is settled).
  requestAnimationFrame(updateScrollHint);
}

/* Reveal animation: each cell stamps in one at a time.
   Desktop (rowMajor=false): column-by-column, top-to-bottom within each column.
   Mobile  (rowMajor=true):  row-by-row, left-to-right within each row (AO first).

   Driven by a single timer walking a queue (rather than one setTimeout
   per cell scheduled up front) so the player can pause, resume, or skip
   it via the Pause/Skip pills under the grid. */
const REVEAL_STAGGER_MS = 350; // per-cell beat

const revealState = {
  active: false,  // reveal in progress
  paused: false,  // currently paused
  queue: [],      // cells not yet revealed, in order
  timer: null,    // pending setTimeout id
  nextAt: 0,      // when the pending step fires (for resuming mid-beat)
  remaining: 0,   // ms left in the beat when paused
  rowMajor: false,
  numCols: 0,
};

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Share of the career grid seen so far today, 1-100: cells showing now
// plus any seen earlier (a previous visit or another tab), so reloading
// and pausing early can't lower it. Floored so it only reads 100 when
// every cell has been seen.
function currentRevealPct() {
  const cells = [...document.querySelectorAll("#table .reveal-cell")];
  if (!cells.length) return 100;
  const seen = getRevealSeen() || new Set();
  const shown = cells.filter((c) => !c.classList.contains("is-hidden") || seen.has(c.dataset.key)).length;
  if (shown === cells.length) return 100;
  return Math.max(1, Math.floor((shown / cells.length) * 100));
}

// The reveal % worth bragging about: only when the win came before the
// whole grid was showing. Null otherwise (full grid, a miss, old records).
function partialRevealPct(pct) {
  return typeof pct === "number" && pct < 100 ? pct : null;
}

function animateReveal(numCols, numRows, rowMajor = false) {
  stopReveal();

  const cells = [...document.querySelectorAll("#table .reveal-cell")];
  const carry = game._revealCarry;
  game._revealCarry = null;

  // Reduced motion: no animation, nothing to pause — show the grid at once.
  if (prefersReducedMotion()) {
    cells.forEach((c) => c.classList.remove("is-hidden"));
    markAllCellsSeen();
    return;
  }

  // Resume rather than replay: cells already seen (earlier visit, another
  // tab, or before a layout switch) show straight away; only the rest
  // animate in.
  const seen = getRevealSeen() || new Set();
  if (carry) carry.keys.forEach((k) => seen.add(k));
  const unseen = cells.filter((c) => !seen.has(c.dataset.key));
  cells.forEach((c) => c.classList.toggle("is-hidden", !seen.has(c.dataset.key)));
  if (!unseen.length) return; // fully seen — no animation, no controls
  void document.getElementById("table").offsetWidth;

  const orderOf = (cell) => {
    const row = parseInt(cell.dataset.row, 10);
    const col = parseInt(cell.dataset.col, 10);
    return rowMajor ? row * numCols + col : col * numRows + row;
  };

  revealState.queue = unseen.sort((a, b) => orderOf(a) - orderOf(b));
  revealState.active = true;
  revealState.paused = false;
  revealState.rowMajor = rowMajor;
  revealState.numCols = numCols;
  setRevealControlsVisible(true);

  // Paused before a refresh or layout switch → come back paused, on "Resume".
  if (carry ? carry.paused : isRevealPausedStored()) {
    revealState.paused = true;
    revealState.remaining = carry ? carry.remaining : 0;
    updateRevealPauseButton();
    return;
  }
  scheduleRevealStep(carry ? carry.remaining : 0); // a layout switch finishes the interrupted beat
}

function scheduleRevealStep(delay) {
  revealState.nextAt = Date.now() + delay;
  revealState.timer = setTimeout(revealStep, delay);
}

function revealStep() {
  revealState.timer = null;
  const cell = revealState.queue.shift();
  // Queue drained: the last cell's stamp has played out — hide the controls.
  if (!cell) {
    storeRevealPaused(false);
    return stopReveal();
  }
  stampCell(cell);
  scheduleRevealStep(REVEAL_STAGGER_MS);
}

function stampCell(cell) {
  cell.classList.remove("is-hidden");
  cell.classList.add("is-stamping");
  addRevealSeen([cell.dataset.key]);
  // Desktop only: auto-scroll to keep the next column in view.
  const wrap = document.querySelector(".table-wrap");
  const col = parseInt(cell.dataset.col, 10);
  if (!revealState.rowMajor && wrap && col < revealState.numCols - 1) {
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const RIGHT_MARGIN = 40;
    if (cellRect.right > wrapRect.right - RIGHT_MARGIN) {
      const overflow = cellRect.right - (wrapRect.right - RIGHT_MARGIN);
      const maxScroll = wrap.scrollWidth - wrap.clientWidth;
      const target = Math.min(wrap.scrollLeft + overflow, maxScroll);
      if (target > wrap.scrollLeft + 1) {
        wrap.scrollTo({ left: target, behavior: "smooth" });
      }
    }
  }
  setTimeout(() => cell.classList.remove("is-stamping"), 350);
}

function toggleRevealPause() {
  if (!revealState.active) return;
  if (revealState.paused) {
    revealState.paused = false;
    // Continue from where it stopped: finish the beat that was interrupted.
    scheduleRevealStep(revealState.remaining);
  } else {
    clearTimeout(revealState.timer);
    revealState.timer = null;
    revealState.remaining = Math.max(0, revealState.nextAt - Date.now());
    revealState.paused = true;
  }
  storeRevealPaused(revealState.paused); // survives a refresh
  updateRevealPauseButton();
}

// Reveal every still-hidden cell at once and drop the controls. The cells
// count as revealed immediately; visually they cross-fade from the grey
// plate in a quick wave (SKIP_STEPS delay classes, in reveal order)
// rather than all snapping in on one frame.
const SKIP_STEPS = 8;
function skipReveal() {
  if (!revealState.active) return;
  const cells = revealState.queue;
  const stepClass = (i) => `skip-step-${Math.floor((i * SKIP_STEPS) / cells.length)}`;
  cells.forEach((c, i) => c.classList.add("is-skipping", stepClass(i)));
  void document.getElementById("table").offsetWidth; // commit the plate as the transition's start
  cells.forEach((c) => c.classList.remove("is-hidden"));
  addRevealSeen(cells.map((c) => c.dataset.key));
  storeRevealPaused(false);
  setTimeout(() => cells.forEach((c, i) => c.classList.remove("is-skipping", stepClass(i))), 1000);
  stopReveal();
}

// Reset reveal state and hide the controls. Also used before a re-render
// replaces the table, so stale timers can't touch detached cells.
function stopReveal() {
  clearTimeout(revealState.timer);
  revealState.timer = null;
  revealState.queue = [];
  revealState.active = false;
  revealState.paused = false;
  setRevealControlsVisible(false);
}

function setRevealControlsVisible(visible) {
  const box = document.getElementById("revealControls");
  if (!box || box.hidden === !visible) return;
  // Don't strand keyboard focus on a button that's about to vanish.
  const hadFocus = !visible && box.contains(document.activeElement);
  box.hidden = !visible;
  if (visible) updateRevealPauseButton();
  if (hadFocus) {
    const input = document.getElementById("guess");
    if (input && !input.disabled) input.focus();
  }
}

function updateRevealPauseButton() {
  const btn = document.getElementById("revealPauseBtn");
  if (!btn) return;
  const paused = revealState.paused;
  btn.setAttribute("aria-label", paused ? "Resume grid reveal" : "Pause grid reveal");
  btn.querySelector(".reveal-control-icon").textContent = paused ? "▶︎" : "⏸︎";
  document.getElementById("revealPauseLabel").textContent = paused ? "Resume" : "Pause";
}

function updateScrollHint() {
  const wrap = document.querySelector(".table-wrap");
  const hint = document.getElementById("scrollHint");
  if (!wrap || !hint) return;
  // Allow 2px of slack for sub-pixel rounding.
  const needsScroll = wrap.scrollWidth > wrap.clientWidth + 2;
  hint.hidden = !needsScroll;
}

// Recompute on resize (orientation change, window resize, etc.)
window.addEventListener("resize", () => {
  clearTimeout(window.__scrollHintTimer);
  window.__scrollHintTimer = setTimeout(updateScrollHint, 80);

  // Re-render when crossing the mobile/desktop breakpoint (debounced 200ms).
  clearTimeout(window.__layoutTimer);
  window.__layoutTimer = setTimeout(() => {
    if (game.current && isMobileLayout() !== _lastLayoutIsMobile) relayoutGrid();
  }, 200);
});

// Rebuild the grid for the other layout without the player being able to
// tell: hidden cells stay hidden, shown cells stay shown, and a running
// reveal carries on (a paused one stays paused). Cells are matched by
// slam:year, since the two layouts reveal in different orders.
function relayoutGrid() {
  if (revealState.active) {
    const shown = [...document.querySelectorAll("#table .reveal-cell")]
      .filter((c) => !c.classList.contains("is-hidden"))
      .map((c) => c.dataset.key);
    game._revealCarry = {
      keys: new Set(shown),
      paused: revealState.paused,
      remaining: revealState.paused ? revealState.remaining : Math.max(0, revealState.nextAt - Date.now()),
    };
    game._skipReveal = false;
  } else if (game._pendingReveal) {
    game._skipReveal = false; // reveal still waiting on the How-to dialog — keep the grid hidden
  } else {
    game._skipReveal = true; // reveal finished (or never animated) — full grid, as before
  }
  render(); // render() → stopReveal() clears the old timer before the table is replaced
}

// Cells the player has already seen: today's saved record plus anything
// carried across a layout re-render (the practice round saves nothing).
function revealedKeys() {
  const keys = getRevealSeen() || new Set();
  if (game._revealCarry) game._revealCarry.keys.forEach((k) => keys.add(k));
  return keys;
}

/* UI */

function updateUI() {
  // Drive the three pip dots. Each pip "fills" once its index is <= wrong.
  // We use used-1 / used-2 / used-3 classes to escalate the color as the
  // count climbs, applied to ALL filled pips so the row visually intensifies.
  const wrong = game.wrong;
  const pips = [
    document.getElementById("pip1"),
    document.getElementById("pip2"),
    document.getElementById("pip3"),
  ];

  for (let i = 0; i < pips.length; i++) {
    const p = pips[i];
    if (!p) continue;
    p.classList.remove("used-1", "used-2", "used-3");
    const isUsed = i < wrong;
    if (isUsed) {
      // pick the class matching the current total wrong count
      p.classList.add(`used-${Math.min(wrong, 3)}`);
    }
    p.setAttribute("aria-label", `Guess ${i + 1}: ${isUsed ? "incorrect" : "not yet used"}`);
  }

  const pipsGroup = document.getElementById("pipsGroup");
  if (pipsGroup) {
    pipsGroup.setAttribute("aria-label", `Guesses used: ${Math.min(wrong, 3)} of 3`);
  }
}

/* EVENTS */

document.getElementById("guess").addEventListener("input", updateSuggestions);

document.getElementById("guess").addEventListener("keydown", (e) => {
  const box = document.getElementById("suggestions");

  if (box.style.display === "block") {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      game.suggestionIndex = Math.min(
        game.suggestionIndex + 1,
        game.suggestionItems.length - 1
      );

      updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      game.suggestionIndex = Math.max(game.suggestionIndex - 1, 0);

      updateHighlight();
    } else if (e.key === "Enter") {
      if (game.suggestionIndex >= 0) {
        e.preventDefault();
        game.suggestionItems[game.suggestionIndex].click();
      } else {
        guess();
      }
    } else if (e.key === "Escape") {
      // ARIA combobox pattern: Escape closes the listbox without clearing
      // the input. Focus stays on the input either way (it never moved).
      e.preventDefault();
      hideSuggestions();
    }
  } else {
    if (e.key === "Enter") guess();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".controls")) {
    hideSuggestions();
  }
});

// First-visit onboarding: open the how-to-play dialog once.
function maybeShowFirstTimeHowTo() {
  const KEY = "slamGuesserSimple.seenHowTo.v1";
  try {
    if (localStorage.getItem(KEY)) return;
    const dlg = document.getElementById("howToDialog");
    if (dlg && typeof dlg.showModal === "function") {
      if (game.isDemo) {
        // Brand-new player: force the practice-or-today choice. The seen
        // flag is set when they choose, so a refresh before choosing
        // offers the choice again.
        setHowToChoiceMode(true);
        dlg.showModal();
        return;
      }
      dlg.showModal();
      localStorage.setItem(KEY, "1");
    }
  } catch {
    /* ignore */
  }
}

// Countdown to the next local midnight (when the next daily grid drops).
// Drives both the digital readout (H:MM) and the analog clock hands.
// Reloads the page once midnight passes so the new day's puzzle loads.
function startCountdown() {
  const el = document.getElementById("countdownTime");
  if (!el) return;
  const handHour = document.getElementById("handHour");
  const handMinute = document.getElementById("handMinute");

  // Remember the date this page loaded on. When the local date changes
  // (i.e. midnight passes), reload so today's grid loads.
  const startDate = new Date().toDateString();

  function tick() {
    const now = new Date();

    // Date-rollover check — fires reliably at midnight even though `ms`
    // never goes negative (we always compute the *next* upcoming midnight).
    if (now.toDateString() !== startDate) {
      window.location.reload();
      return;
    }

    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );
    const ms = tomorrow - now;
    // Ceiling minutes — if any seconds remain in the current minute,
    // round up. Avoids the misleading "00:00" display while there are
    // still 0-59 seconds left until the new grid drops.
    const totalMinutes = Math.ceil(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    // Digital: HH:MM (always 2-digit hour for steady spacing)
    el.textContent = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

    // Analog: show the actual current local time (like the courtside clock).
    if (handHour && handMinute) {
      const localH = now.getHours() % 12;
      const localM = now.getMinutes();
      const localS = now.getSeconds();
      const hourAngle = localH * 30 + localM * 0.5;
      const minAngle = localM * 6 + localS * 0.1;
      handHour.setAttribute("transform", `rotate(${hourAngle} 50 50)`);
      handMinute.setAttribute("transform", `rotate(${minAngle} 50 50)`);
    }
  }
  tick();
  setInterval(tick, 1000);
}

// Each day-of-week maps to a round (R1-R4 → QF → SF → F) styled to
// match the in-game result-cell palette + a difficulty-gradient halo.
// Kept in sync with the chart pills defined in index.html.
const ROUND_BY_DAY = [
  // 0=Mon ... 6=Sun
  { round: "R1", halo: "#a5e85a", fill: "#3b82f6", text: "#ffffff" },
  { round: "R2", halo: "#ccea4f", fill: "#3b82f6", text: "#ffffff" },
  { round: "R3", halo: "#fde047", fill: "#3b82f6", text: "#ffffff" },
  { round: "R4", halo: "#fdcd5c", fill: "#3b82f6", text: "#ffffff" },
  { round: "QF", halo: "#fdb168", fill: "#fdba74", text: "#7c2d12" },
  { round: "SF", halo: "#dc7a3f", fill: "#fde047", text: "#713f12" },
  { round: "F",  halo: "#b8512a", fill: "#c084fc", text: "#2e1065" },
];

function todayDayIndex() {
  // 0=Mon..6=Sun. JS native getDay() is 0=Sun..6=Sat — shift it.
  return (new Date().getDay() + 6) % 7;
}

function paintRoundButton() {
  const halo = document.getElementById("roundBtnHalo");
  const fill = document.getElementById("roundBtnFill");
  const label = document.getElementById("roundBtnLabel");
  if (!halo || !fill || !label) return;
  if (isChampionThisWeek(game.date || todayLocal())) {
    halo.style.background = "#a5e85a";
    fill.style.background = "#16a34a";
    fill.style.color = "#ffffff";
    label.textContent = "W";
    halo.classList.add("is-painted");
    return;
  }
  const r = ROUND_BY_DAY[todayDayIndex()];
  halo.style.background = r.halo;
  fill.style.background = r.fill;
  fill.style.color = r.text;
  label.textContent = r.round;
  halo.classList.add("is-painted");
}

function openDifficultyDialog() {
  const dlg = document.getElementById("difficultyDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;

  const todayIdx = todayDayIndex();
  const todayIso = game.date || todayLocal();
  const weekResults = getWeekResults(todayIso);
  const champion = isChampionThisWeek(todayIso);

  document.querySelectorAll(".diff-pill").forEach((el) => {
    const dayIdx = parseInt(el.dataset.day, 10);
    el.classList.toggle("is-today", dayIdx === todayIdx);
    el.classList.remove("is-future");

    const prevOutcome = el.querySelector(".diff-outcome");
    if (prevOutcome) prevOutcome.remove();
    const prevBadge = el.querySelector(".diff-badge");
    if (prevBadge) prevBadge.remove();
    const prevPct = el.querySelector(".diff-pct");
    if (prevPct) prevPct.remove();

    // Early-win reveal % under the pill (same rule as the week strip)
    const appendRevealPct = (result) => {
      const pct = isDayWon(result) ? partialRevealPct(result.revealPct) : null;
      if (pct === null) return;
      const pctEl = document.createElement("div");
      pctEl.className = "diff-pct";
      pctEl.textContent = `${pct}%`;
      pctEl.setAttribute("aria-label", `${pct}% of their career revealed`);
      el.appendChild(pctEl);
    };

    // Sunday pill: switch to green W on championship, restore to purple F otherwise
    const haloEl = el.querySelector(".diff-halo");
    const fillEl = el.querySelector(".diff-fill");
    if (dayIdx === 6 && haloEl && fillEl) {
      if (champion) {
        haloEl.style.background = "#a5e85a";
        fillEl.style.background = "#16a34a";
        fillEl.style.color = "#ffffff";
        fillEl.textContent = "W";
        const trophy = document.createElement("div");
        trophy.className = "diff-outcome";
        trophy.textContent = "🏆";
        el.appendChild(trophy);
        appendRevealPct(weekResults[dayIdx]);
        // Champion Sunday: the green W + trophy already say "won" —
        // no corner badge on top of it.
        return;
      } else {
        haloEl.style.background = "#b8512a";
        fillEl.style.background = "#c084fc";
        fillEl.style.color = "#2e1065";
        fillEl.textContent = "F";
      }
    }

    const result = weekResults[dayIdx];
    const badge = document.createElement("div");
    badge.className = "diff-badge";

    if (result) {
      // Covers "today, already played" too — a result existing at all
      // (regardless of which day) means show the real outcome, not a
      // blank "today" state.
      if (isDayWon(result)) {
        badge.classList.add("is-won");
        badge.textContent = "✓";
      } else {
        badge.classList.add("is-missed");
        badge.textContent = "✕";
      }
      el.appendChild(badge);
      appendRevealPct(result);
    } else if (dayIdx === todayIdx) {
      // Today, not yet played — the white "today" ring already signals
      // this; a badge here would be redundant.
    } else if (dayIdx < todayIdx) {
      // Past day with no recorded result — shouldn't normally happen
      // given daily play, but don't let it silently look identical to
      // "not yet reached" or blend in as if nothing needs explaining.
      badge.classList.add("is-unplayed");
      badge.textContent = "–";
      el.appendChild(badge);
    } else {
      // Future — not yet reached this week.
      el.classList.add("is-future");
    }
  });

  dlg.showModal();
}

load().then(() => {
  maybeShowFirstTimeHowTo();
  startCountdown();
  paintRoundButton();
  // Reveal the page. One animation frame after marking ready so the
  // browser flushes the initial paint with everything already in its
  // final state — fades in cleanly instead of snapping.
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
  });
});

// Safety fallback: if `load()` errors or never resolves (offline, missing
// JSON, etc.), still reveal the page after 2s so the user isn't staring
// at a blank screen forever.
setTimeout(() => {
  document.body.classList.add("is-ready");
}, 2000);

// When the how-to dialog closes, if there's a pending reveal animation
// (deferred because the modal was open), play it now.
document.addEventListener("DOMContentLoaded", () => {
  const howTo = document.getElementById("howToDialog");
  if (howTo) {
    // First-visit choice can't be dismissed with Esc.
    howTo.addEventListener("cancel", (e) => {
      if (game && game.howToChoice) e.preventDefault();
    });
    howTo.addEventListener("close", () => {
      if (game && game.howToChoice) setHowToChoiceMode(false);
      if (game && game._pendingReveal) {
        const { cols, rows, rowMajor } = game._pendingReveal;
        game._pendingReveal = null;
        animateReveal(cols, rows, rowMajor);
      }
    });
  }

  // When the result modal closes, fade in the countdown clock. This is
  // the "see you tomorrow" beat — held back until the user dismisses
  // the result so it has its own moment instead of competing with the
  // modal's reveal.
  const result = document.getElementById("resultDialog");
  if (result) {
    result.addEventListener("close", () => {
      // Closing the practice round's result (button, ×, or Esc) moves on
      // to today's real puzzle — no countdown, the day hasn't been played.
      if (game.isDemo) {
        endIntro();
        return;
      }
      revealCountdown();
      paintRoundButton();
    });
  }

  // Round-of-day button → open the difficulty chart modal
  const roundBtn = document.getElementById("roundBtn");
  if (roundBtn) {
    roundBtn.addEventListener("click", openDifficultyDialog);
  }

  // Tiebreak modal — the round is undecided until a pick or the timeout,
  // so ESC must not dismiss it for free.
  const tiebreakDialog = document.getElementById("tiebreakDialog");
  if (tiebreakDialog) {
    tiebreakDialog.addEventListener("cancel", (e) => e.preventDefault());
  }
});
