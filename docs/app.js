// Kindred — a friendly social network with an anti-bullying Shield.
// Logins, data and hosting come from Firebase. See README.md to set it up.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, limit, addDoc, setDoc, getDoc,
  deleteDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- anti-bullying detector ---------- */
const RULES = [
  { cat: "Threat", lvl: 3, terms: ["kill you", "hurt you", "beat you up", "watch your back", "i will find you", "i'll find you", "gonna get you", "jump you"] },
  { cat: "Telling someone to hurt themselves", lvl: 3, terms: ["kill yourself", "kys", "go die", "end yourself", "nobody would miss you", "no one would miss you"] },
  { cat: "Exclusion", lvl: 2, terms: ["nobody likes you", "no one likes you", "everyone hates you", "you have no friends", "you don't belong", "nobody wants you", "go away loser"] },
  { cat: "Insult", lvl: 1, terms: ["stupid", "idiot", "dumb", "loser", "ugly", "fat", "freak", "pathetic", "worthless", "trash", "moron", "weirdo", "gross", "disgusting", "clown", "cringe", "lame"] },
];
const TARGET = /\b(you|ur|your|you're|youre|u)\b/;
function normalize(s) {
  return s.toLowerCase()
    .replace(/[1!|]/g, "i").replace(/0/g, "o").replace(/3/g, "e").replace(/4|@/g, "a").replace(/\$|5/g, "s").replace(/7/g, "t")
    .replace(/[*_.\-]/g, "");
}
function termRe(t) {
  const body = t.split("").map(c => c === " " ? "\\s+" : c.replace(/[.*+?^${}()|[\]\\']/g, "\\$&") + "+").join("");
  return new RegExp("\\b" + body + "\\b", "g");
}
const COMPILED = RULES.map(r => ({ ...r, res: r.terms.map(t => ({ t, re: termRe(t) })) }));
function analyze(text) {
  const norm = normalize(text);
  let level = 0; const reasons = new Set(); const hits = [];
  for (const r of COMPILED) for (const { t, re } of r.res) {
    re.lastIndex = 0;
    if (re.test(norm)) {
      hits.push(t); reasons.add(r.cat);
      let l = r.lvl;
      if (r.cat === "Insult" && TARGET.test(norm)) l = 2; // aimed at a person
      level = Math.max(level, l);
    }
  }
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (level >= 1 && letters.length > 8 && letters === letters.toUpperCase()) { level = Math.max(level, 2); reasons.add("Shouting"); }
  for (const w of S.prefs.muted) if (w && norm.includes(normalize(w))) { reasons.add("Muted word"); hits.push(w); }
  return { level, reasons: [...reasons], hits };
}
const isMuted = a => a.reasons.includes("Muted word");
const hideThreshold = () => S.prefs.level === "strict" ? 1 : S.prefs.level === "standard" ? 2 : 3;

/* ---------- state ---------- */
// mode: loading | setup | login | guest | join | member
const S = {
  mode: "loading", uid: null, isAdmin: false,
  posts: [], comments: [], users: {}, usersLoaded: false, reports: [],
  prefs: { level: "standard", muted: [], blocked: [] },
  revealed: new Set(), stats: { hidden: 0, paused: 0, kind: 0 }, log: [],
  editingProfile: false,
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ms = t => (t && t.toMillis) ? t.toMillis() : Date.now(); // pending server times count as "now"
function ago(t) { const s = Math.max(0, (Date.now() - ms(t)) / 1000); if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; if (s < 604800) return Math.floor(s / 86400) + "d"; return new Date(ms(t)).toLocaleDateString([], { month: "short", day: "numeric" }); }
const stamp = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function logIt(msg) { S.log.unshift({ t: stamp(), msg }); S.log = S.log.slice(0, 40); renderPanel(); }
let toastT;
function toast(msg) { let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); } el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2800); }
function highlight(text, hits) {
  const words = new Set(hits.flatMap(h => h.split(" ")));
  return esc(text).replace(/[A-Za-z0-9@$!|*_.\-']+/g, w => {
    const n = normalize(w).replace(/(.)\1+/g, "$1");
    for (const h of words) if (n === h.replace(/(.)\1+/g, "$1")) return `<mark class="flag">${w}</mark>`;
    return w;
  });
}
function stripHurtful(text, hits) {
  const words = new Set(hits.flatMap(h => h.split(" ")));
  return text.replace(/[A-Za-z0-9@$!|*_.\-']+/g, w => {
    const n = normalize(w).replace(/(.)\1+/g, "$1");
    for (const h of words) if (n === h.replace(/(.)\1+/g, "$1")) return "";
    return w;
  }).replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
const heart = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`;
const heartO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20s-7-4.3-9-8.6C1.6 8.3 3.5 5 6.8 5c1.9 0 3.4 1 5.2 3 1.8-2 3.3-3 5.2-3 3.3 0 5.2 3.3 3.8 6.4C19 15.7 12 20 12 20z"/></svg>`;

/* ---------- people ---------- */
const COLORS = ["#C2577A", "#7A5BC2", "#2E78C7", "#C2822E", "#0C7A69", "#B4493A", "#4F7A28", "#8A4FB0"];
function colorFor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
const avCache = {};
function avatarSrc(id) {
  const u = S.users[id]; const letter = (u?.username?.[0] || "?").toUpperCase();
  const key = id + letter; if (avCache[key]) return avCache[key];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${colorFor(id)}"/><text x="20" y="26" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return avCache[key] = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
const avHTML = (id, sm) => `<div class="av${sm ? " sm" : ""}" aria-hidden="true"><img alt="" src="${avatarSrc(id)}"></div>`;
const nm = id => S.users[id]?.username ? "@" + S.users[id].username : "Someone";
const isBanned = id => S.users[id]?.banned === true;
const isBlocked = id => S.prefs.blocked.includes(id);
const canAct = () => S.mode === "member" && !isBanned(S.uid);

/* ---------- Firebase ---------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PASTE");
let auth, db, unsubs = [];
const stopListening = () => { unsubs.forEach(u => u()); unsubs = []; };
function fail(e) {
  console.error(e);
  const c = e && e.code;
  if (c === "permission-denied") toast("Kindred didn't allow that.");
  else if (c === "unavailable") toast("You're offline. Try again when you're connected.");
  else toast("Something went wrong. Try again.");
}

function listen(user) {
  stopListening();
  const onErr = e => console.error(e);
  unsubs.push(onSnapshot(query(collection(db, "posts"), orderBy("at", "desc"), limit(200)), s => {
    S.posts = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule();
  }, onErr));
  unsubs.push(onSnapshot(query(collection(db, "comments"), orderBy("at", "desc"), limit(1000)), s => {
    S.comments = s.docs.map(d => ({ id: d.id, ...d.data() })).reverse(); schedule();
  }, onErr));
  unsubs.push(onSnapshot(collection(db, "users"), s => {
    const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.users = m; S.usersLoaded = true; decideMode(); schedule();
  }, onErr));
  if (!user.isAnonymous) {
    unsubs.push(onSnapshot(doc(db, "users", user.uid, "private", "prefs"), s => {
      if (!s.exists()) return; const d = s.data();
      S.prefs = { level: ["off", "standard", "strict"].includes(d.level) ? d.level : "standard", muted: Array.isArray(d.muted) ? d.muted.slice(0, 50) : [], blocked: Array.isArray(d.blocked) ? d.blocked.slice(0, 200) : [] };
      schedule();
    }, onErr));
    getDoc(doc(db, "admins", user.uid)).then(a => {
      S.isAdmin = a.exists();
      if (S.isAdmin) unsubs.push(onSnapshot(query(collection(db, "reports"), orderBy("at", "desc"), limit(200)), s => {
        S.reports = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule();
      }, onErr));
      schedule();
    }).catch(onErr);
  }
}
function decideMode() {
  const u = auth?.currentUser;
  if (!u) S.mode = "login";
  else if (u.isAnonymous) S.mode = "guest";
  else if (!S.usersLoaded) S.mode = "loading";
  else S.mode = S.users[u.uid] ? "member" : "join";
  updateMode();
}
const savePrefs = () => { if (S.mode === "member") setDoc(doc(db, "users", S.uid, "private", "prefs"), { level: S.prefs.level, muted: S.prefs.muted, blocked: S.prefs.blocked }).catch(fail); };

/* ---------- render ---------- */
let pending = false;
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

function render() {
  const th = hideThreshold(); let hiddenCount = 0;
  const postIds = new Set(S.posts.map(p => p.id));
  const byPost = {};
  for (const c of S.comments) if (postIds.has(c.post)) (byPost[c.post] = byPost[c.post] || []).push(c);
  const visible = S.posts.filter(p => !isBlocked(p.author) && (S.isAdmin || !isBanned(p.author)));

  // keep typed comment text and focus across re-renders
  const keep = {}; document.querySelectorAll("#posts input").forEach(i => { if (i.value) keep[i.id] = i.value; });
  const act = document.activeElement, actId = act && act.id, sel = act && act.selectionStart;

  let html = "";
  if ((S.mode === "member" || S.mode === "guest") && !visible.length)
    html = `<div class="card empty"><b>Nothing here yet</b>${S.mode === "member" ? "Write the first post. Everyone on Kindred will see it." : "Posts will show up here once people start sharing."}</div>`;
  html += visible.map(p => {
    const a = analyze(p.text); const mine = p.author === S.uid;
    const hide = !mine && (a.level >= 3 || a.level >= th || isMuted(a)) && !S.revealed.has(p.id);
    const body = hide ? hiddenBlock(p.id, p.author, a, false, p.text, "") : `<div class="post-body">${esc(p.text)}</div>`;
    const cs = (byPost[p.id] || []).filter(c => !isBlocked(c.author) && (S.isAdmin || !isBanned(c.author)));
    const cmts = cs.map(c => {
      const ca = analyze(c.text); const cmine = c.author === S.uid;
      const chide = !cmine && (ca.level >= 3 || ca.level >= th || isMuted(ca)) && !S.revealed.has(c.id);
      if (chide) { hiddenCount++; return `<div class="cmt">${avHTML(c.author, 1)}${hiddenBlock(c.id, c.author, ca, true, c.text, p.id)}</div>`; }
      const flagged = ca.level >= 1 && !cmine;
      return `<div class="cmt">${avHTML(c.author, 1)}<div class="cmt-bubble"><b>${esc(nm(c.author))}</b> <span class="small">${ago(c.at)}</span> ${isBanned(c.author) ? `<span class="chip danger">Banned</span>` : ""} ${flagged ? `<span class="chip ${ca.level >= 2 ? "danger" : "warn"}">${esc(ca.reasons.join(", "))}</span>` : ""}<p>${flagged ? highlight(c.text, ca.hits) : esc(c.text)}</p>
        <div class="cmt-tools">${tools(c.id, c.author, c.text, "comment", p.id)}</div></div></div>`;
    }).join("");
    const likes = Array.isArray(p.likes) ? p.likes : []; const liked = likes.includes(S.uid);
    return `<article class="card post">
      <div class="post-head">${avHTML(p.author)}<div class="who"><b>${esc(nm(p.author))}${mine ? " (you)" : ""}</b><span>${ago(p.at)}</span></div><span class="spacer"></span>${isBanned(p.author) ? `<span class="chip danger">Banned</span>` : ""}</div>
      ${body}
      <div class="post-acts"><button class="like${liked ? " on" : ""}" data-act="like" data-id="${p.id}" aria-pressed="${liked}" ${canAct() ? "" : "disabled"}>${liked ? heart : heartO}<span>${likes.length}</span></button>
      <span class="small">${cs.length} comment${cs.length === 1 ? "" : "s"}</span><span class="spacer" style="flex:1"></span>${tools(p.id, p.author, p.text, "post", p.id)}</div>
      <div class="comments">${cmts}
        ${canAct() ? `<form class="cmt-form" data-post="${p.id}">${avHTML(S.uid, 1)}<input id="c-${p.id}" placeholder="Write a comment" aria-label="Write a comment" maxlength="500"><button class="btn sm" type="submit">Reply</button></form>` : ""}
      </div></article>`;
  }).join("");
  $("#posts").innerHTML = html;

  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el) el.value = v; }
  if (actId && actId.startsWith("c-")) { const el = document.getElementById(actId); if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) { } } }

  $("#myAv").innerHTML = S.uid && S.mode === "member" ? `<img alt="" src="${avatarSrc(S.uid)}">` : "";
  S.stats.hidden = hiddenCount;
  renderPanel(); renderMod(); renderAcct();
}
function tools(id, by, text, kind, postId) {
  const t = [];
  const mine = by === S.uid;
  if (mine && S.mode === "member") t.push(`<button class="link" data-act="del" data-id="${id}" data-kind="${kind}">Delete</button>`);
  if (!mine) {
    if (S.isAdmin) t.push(`<button class="link" data-act="remove" data-id="${id}" data-kind="${kind}">Remove</button>`);
    if (S.mode === "member") t.push(`<button class="link" data-act="report" data-who="${esc(by)}" data-post="${esc(postId)}" data-comment="${kind === "comment" ? esc(id) : ""}" data-text="${esc(text)}">Report</button>`);
    if (S.mode === "member" || S.mode === "guest") t.push(`<button class="link" data-act="block" data-who="${esc(by)}">Block</button>`);
  }
  return t.join("");
}
function hiddenBlock(id, by, a, isCmt, text, postId) {
  const why = a.level >= 3 ? "Threat or self-harm message" : (a.reasons.join(", ") || "Filtered");
  const kind = isCmt ? "comment" : "post";
  return `<div class="${isCmt ? "cmt-bubble " : ""}hidden-cmt card" style="padding:10px 12px;flex:1">
    <strong>Hidden by Shield</strong> · may be hurtful (${esc(why)})
    <div class="cmt-tools">${a.level < 3 ? `<button class="link" data-act="reveal" data-id="${id}">Show anyway</button>` : ""}
    ${S.isAdmin ? `<button class="link" data-act="remove" data-id="${id}" data-kind="${kind}">Remove for everyone</button>` : ""}
    ${S.mode === "member" && by !== S.uid ? `<button class="link" data-act="report" data-who="${esc(by)}" data-post="${esc(postId || id)}" data-comment="${isCmt ? esc(id) : ""}" data-text="${esc(text)}">Report</button>` : ""}
    ${by !== S.uid && (S.mode === "member" || S.mode === "guest") ? `<button class="link" data-act="block" data-who="${esc(by)}">Block ${esc(nm(by))}</button>` : ""}</div></div>`;
}
const LVL_NOTES = { off: "Comments aren't filtered. Threats are still hidden.", standard: "Hides insults aimed at people, exclusion, and threats.", strict: "Also hides any rude word, even if it isn't aimed at someone." };
function renderPanel() {
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lvl === S.prefs.level));
  $("#lvlNote").textContent = LVL_NOTES[S.prefs.level];
  $("#sHidden").textContent = S.stats.hidden; $("#sPaused").textContent = S.stats.paused; $("#sKind").textContent = S.stats.kind;
  $("#muted").innerHTML = S.prefs.muted.map(w => `<span class="chip">${esc(w)}<button type="button" data-unmute="${esc(w)}" aria-label="Unmute ${esc(w)}">×</button></span>`).join("") || `<span class="small">No muted words.</span>`;
  $("#blocked").innerHTML = S.prefs.blocked.map(k => `<span class="chip">${esc(nm(k))}<button type="button" data-unblock="${esc(k)}" aria-label="Unblock">×</button></span>`).join("") || `<span class="small">Nobody blocked.</span>`;
  $("#log").innerHTML = S.log.map(l => `<li><time>${l.t}</time><span>${esc(l.msg)}</span></li>`).join("") || `<li class="small">Nothing yet. The Shield logs what it catches here.</li>`;
  $("#pill").classList.toggle("off", S.prefs.level === "off");
  $("#pillText").textContent = S.prefs.level === "off" ? "Shield off" : "Shield on · " + (S.prefs.level === "strict" ? "Strict" : "Standard");
}
function renderMod() {
  $("#modCard").hidden = !S.isAdmin;
  if (!S.isAdmin) return;
  $("#reports").innerHTML = S.reports.length ? S.reports.map(r => `<div class="mod-item">
    <div class="small"><b style="color:var(--ink)">${esc(nm(r.by))}</b> reported <b style="color:var(--ink)">${esc(nm(r.target))}</b> · ${esc(r.reason)} · ${ago(r.at)}</div>
    ${r.text ? `<div class="quote">${esc(r.text)}</div>` : ""}
    <div class="mod-acts">
      ${(r.comment ? S.comments.some(c => c.id === r.comment) : S.posts.some(p => p.id === r.post)) ? `<button class="btn sm danger" data-mod="remove" data-id="${esc(r.comment || r.post)}" data-kind="${r.comment ? "comment" : "post"}">Remove it</button>` : ""}
      ${!isBanned(r.target) ? `<button class="btn sm danger" data-mod="ban" data-who="${esc(r.target)}">Ban ${esc(nm(r.target))}</button>` : `<button class="btn sm" data-mod="unban" data-who="${esc(r.target)}">Unban</button>`}
      <button class="btn sm" data-mod="dismiss" data-id="${esc(r.id)}">Dismiss</button>
    </div></div>`).join("") : `<p class="small">No open reports.</p>`;
}
function renderAcct() {
  const a = $("#acct");
  if (S.mode === "member") { a.hidden = false; $("#acctAv").innerHTML = `<img alt="" src="${avatarSrc(S.uid)}">`; $("#acctName").textContent = nm(S.uid); }
  else if (S.mode === "guest") { a.hidden = false; $("#acctAv").innerHTML = ""; $("#acctName").textContent = "Guest · Log in"; }
  else a.hidden = true;
}

/* ---------- mode / banner ---------- */
function updateMode() {
  const b = $("#banner");
  const can = canAct();
  $("#compose").disabled = !can; $("#postBtn").disabled = !can;
  $("#composer").hidden = !(S.mode === "member");
  if (S.mode === "member" && isBanned(S.uid)) { b.hidden = false; b.className = "banner bad"; b.textContent = "A moderator removed your ability to post here."; }
  else if (S.mode === "guest") { b.hidden = false; b.className = "banner"; b.innerHTML = `You're browsing as a guest. You can read, but you need an account to post, comment or like. <button class="link" type="button" data-login style="color:var(--accent)">Log in or sign up</button>`; }
  else b.hidden = true;
  renderGate(); renderAcct(); schedule();
}

/* ---------- login / sign up / join screens ---------- */
let gateShown = null, authTab = "login";
const brand = `<div class="gate-brand"><span class="logo-mark" aria-hidden="true"></span>Kindred</div>`;
const AUTH_ERRORS = {
  "auth/invalid-credential": "That email or password is wrong.",
  "auth/wrong-password": "That email or password is wrong.",
  "auth/user-not-found": "There's no account with that email. Try signing up.",
  "auth/email-already-in-use": "There's already an account with that email. Try logging in.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
  "auth/network-request-failed": "You're offline. Check your connection.",
  "auth/operation-not-allowed": "This way of logging in isn't turned on yet. See step 3 in the README.",
  "auth/admin-restricted-operation": "Guest browsing isn't turned on yet. See step 3 in the README.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
};
const authMsg = e => AUTH_ERRORS[e?.code] || "Couldn't log in. Try again.";

function usernameProblem(v) {
  if (!/^[a-z0-9_]{3,20}$/.test(v)) return "Use 3 to 20 lowercase letters, numbers or underscores.";
  if (Object.entries(S.users).some(([id, u]) => id !== S.uid && u.username === v)) return "That username is taken. Try another.";
  if (analyze(v.replace(/_/g, " ")).level >= 1) return "Pick a username that isn't mean or rude.";
  return "";
}

function renderGate() {
  const g = $("#gate"), c = $("#gateCard");
  let view = "";
  if (S.mode === "loading") view = "loading";
  else if (S.mode === "setup") view = "setup";
  else if (S.mode === "login") view = "login-" + authTab;
  else if (S.mode === "join") view = "join";
  else if (S.mode === "member" && S.editingProfile) view = "edit";
  g.hidden = !view;
  document.documentElement.style.overflow = view ? "hidden" : "";
  if (view === gateShown) return; // keep anything typed
  gateShown = view;
  if (!view) return;

  if (view === "loading") { c.innerHTML = brand + `<div style="display:flex;gap:12px;align-items:center"><div class="spin" aria-hidden="true"></div><p>Loading…</p></div>`; return; }
  if (view === "setup") {
    c.innerHTML = brand + `<h1>Almost ready</h1><p>Kindred isn't connected to Firebase yet. Paste your project's settings into <b>docs/firebase-config.js</b> on GitHub, then reload. The README walks through it.</p>`;
    return;
  }
  if (view.startsWith("login")) {
    const signup = authTab === "signup";
    c.innerHTML = brand + `
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${!signup}" data-tab="login">Log in</button>
        <button type="button" role="tab" aria-selected="${signup}" data-tab="signup">Sign up</button>
      </div>
      <form class="auth-form" id="authForm">
        <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required>
          ${signup ? `<span class="hint">At least 6 characters.</span>` : `<button class="link" type="button" id="forgot" style="align-self:flex-start">Forgot password?</button>`}</div>
        ${signup ? `<label class="check"><input type="checkbox" id="age"> <span>I'm 13 or older.</span></label>` : ""}
        <div class="err" id="authErr" hidden></div>
        <button class="btn primary wide" type="submit" id="authBtn">${signup ? "Create account" : "Log in"}</button>
      </form>
      <div class="or">or</div>
      <button class="btn wide" type="button" id="googleBtn"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>
      <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:16px">
        <button class="btn wide" type="button" id="guestBtn">Continue as guest</button>
        <span class="hint" style="text-align:center">Guests can read Kindred but can't post, comment or like.</span>
      </div>`;
    const err = m => { const e = $("#authErr"); e.hidden = !m; e.textContent = m || ""; };
    c.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { authTab = b.dataset.tab; gateShown = null; renderGate(); });
    $("#authForm").addEventListener("submit", async e => {
      e.preventDefault(); err("");
      const email = $("#email").value.trim(), pw = $("#password").value;
      if (signup && !$("#age").checked) { err("You need to be 13 or older to join Kindred."); return; }
      $("#authBtn").disabled = true;
      try { signup ? await createUserWithEmailAndPassword(auth, email, pw) : await signInWithEmailAndPassword(auth, email, pw); }
      catch (x) { err(authMsg(x)); const b = $("#authBtn"); if (b) b.disabled = false; }
    });
    const f = $("#forgot");
    if (f) f.onclick = async () => {
      const email = $("#email").value.trim();
      if (!email) { err("Type your email above first, then tap Forgot password."); $("#email").focus(); return; }
      try { await sendPasswordResetEmail(auth, email); err(""); toast("Check your email for a link to reset your password."); }
      catch (x) { err(authMsg(x)); }
    };
    $("#googleBtn").onclick = async () => {
      err("");
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (x) { if (x?.code !== "auth/popup-closed-by-user" && x?.code !== "auth/cancelled-popup-request") err(authMsg(x)); }
    };
    $("#guestBtn").onclick = async () => { err(""); try { await signInAnonymously(auth); } catch (x) { err(authMsg(x)); } };
    $("#email").focus();
    return;
  }

  // join (first time) or edit profile
  const editing = view === "edit"; const mine = S.users[S.uid] || {};
  c.innerHTML = brand + `<h1>${editing ? "Your account" : "Welcome! Pick your username"}</h1>
    <form id="joinForm" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="uname">Username</label>
        <div class="at"><input id="uname" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="20" value="${esc(mine.username || "")}" placeholder="your_name"></div>
        <span class="hint" id="unameHint">This is how people see you on Kindred.</span></div>
      <div class="field"><label for="bio">About you <span class="hint">(optional)</span></label>
        <textarea id="bio" maxlength="120" placeholder="Robotics, watercolors, pineapple pizza defender">${esc(mine.bio || "")}</textarea>
        <span class="hint" id="bioHint"></span></div>
      ${editing ? "" : `<label class="pledge"><input type="checkbox" id="pledge"> <span>I'll be kind on Kindred. No bullying, threats or hate. I know the Shield checks what I post.</span></label>`}
      <div class="err" id="joinErr" hidden></div>
      <div class="modal-acts">${editing ? `<button class="btn" type="button" id="cancelEdit">Close</button>` : `<button class="btn" type="button" id="logoutBtn">Log out</button>`}<button class="btn primary" type="submit" id="joinBtn">${editing ? "Save" : "Join Kindred"}</button></div>
    </form>
    ${editing ? `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:14px">
      <span class="hint">Your user ID (the site owner needs this to make someone an admin)</span>
      <div class="idbox">${esc(S.uid)}</div>
      <button class="btn" type="button" id="logoutBtn">Log out</button></div>` : ""}`;
  const u = $("#uname"), hint = $("#unameHint");
  u.addEventListener("input", () => {
    const v = u.value.trim().toLowerCase().replace(/\s+/g, "_"); if (v !== u.value) u.value = v;
    const p = v ? usernameProblem(v) : "";
    hint.className = "hint" + (p ? " bad" : v ? " good" : "");
    hint.textContent = p || (v ? (v === mine.username ? "This is your username." : "@" + v + " is available.") : "This is how people see you on Kindred.");
  });
  const cancel = $("#cancelEdit"); if (cancel) cancel.onclick = () => { S.editingProfile = false; updateMode(); };
  $("#logoutBtn").onclick = () => { S.editingProfile = false; signOut(auth); };
  $("#joinForm").addEventListener("submit", async e => {
    e.preventDefault();
    const je = $("#joinErr"); je.hidden = true;
    const v = u.value.trim().toLowerCase(); const bio = $("#bio").value.trim();
    const p = usernameProblem(v);
    if (p) { hint.className = "hint bad"; hint.textContent = p; u.focus(); return; }
    if (bio && analyze(bio).level >= 2) { $("#bioHint").className = "hint bad"; $("#bioHint").textContent = "That sounds hurtful. Try describing yourself instead."; return; }
    const pl = $("#pledge"); if (pl && !pl.checked) { pl.closest(".pledge").style.outline = "2px solid var(--warn)"; pl.focus(); return; }
    $("#joinBtn").disabled = true;
    try {
      await claimUsername(v, bio, editing ? mine : null);
      S.editingProfile = false;
      toast(editing ? "Saved" : "Welcome to Kindred, @" + v);
      logIt(editing ? "Updated your profile" : "Joined Kindred as @" + v);
    } catch (x) {
      je.hidden = false; je.textContent = x?.message === "taken" ? "That username was just taken. Try another." : "Couldn't save. Try again.";
      if (x?.message !== "taken") console.error(x);
      const b = $("#joinBtn"); if (b) b.disabled = false;
    }
  });
  u.focus();
}

// Usernames live in their own collection so the server can stop duplicates.
async function claimUsername(name, bio, old) {
  await runTransaction(db, async tx => {
    const nameRef = doc(db, "usernames", name);
    const taken = await tx.get(nameRef);
    if (taken.exists() && taken.data().uid !== S.uid) throw new Error("taken");
    if (!taken.exists()) tx.set(nameRef, { uid: S.uid });
    const userRef = doc(db, "users", S.uid);
    if (old) {
      tx.update(userRef, { username: name, bio });
      if (old.username && old.username !== name) tx.delete(doc(db, "usernames", old.username));
    } else {
      tx.set(userRef, { username: name, bio, joined: serverTimestamp(), banned: false });
    }
  });
}

/* ---------- tone meter ---------- */
const TONE = ["Sounds kind", "Might sound rude", "This could hurt someone", "This can't be posted"];
function updateTone() {
  const v = $("#compose").value.trim(); const el = $("#tone");
  if (!v) { el.className = "tone"; el.textContent = "Tone check is on"; return; }
  const a = analyze(v); el.className = "tone l" + a.level; el.textContent = TONE[a.level];
}

/* ---------- dialogs ---------- */
function openModal(html, bind) {
  $("#modalRoot").innerHTML = `<div class="scrim" data-scrim><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const first = $("#modalRoot").querySelector("button,input"); first && first.focus();
  bind && bind($("#modalRoot"));
}
function closeModal() { $("#modalRoot").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
$("#modalRoot").addEventListener("click", e => { if (e.target.dataset.scrim !== undefined) closeModal(); });

// The Shield checks everything before it goes out.
function gate(text, onSend, onEdit) {
  const a = analyze(text);
  if (a.level === 0) { onSend(text); return; }
  S.stats.paused++;
  if (a.level >= 3) {
    logIt("Stopped a message: " + a.reasons.join(", ").toLowerCase());
    const selfHarm = a.reasons.includes("Telling someone to hurt themselves");
    openModal(`<span class="chip danger">${esc(a.reasons.join(", "))}</span>
      <h2>This can't be posted on Kindred</h2>
      <div class="quote">${highlight(text, a.hits)}</div>
      <p>${selfHarm ? "Telling someone to hurt themselves can do real damage, even as a joke." : "Messages that threaten someone aren't allowed here, even as a joke."} If you're angry with someone, it's OK to step away and come back later.</p>
      <p class="small">If you're the one feeling overwhelmed, you can call or text 988 (US) to talk to someone.</p>
      <div class="modal-acts"><button class="btn primary" data-m="edit">Edit message</button></div>`,
      root => root.querySelector('[data-m="edit"]').onclick = () => { closeModal(); onEdit(); });
    return;
  }
  const kinder = stripHurtful(text, a.hits);
  logIt("Paused a message for a second look");
  openModal(`<span class="chip ${a.level >= 2 ? "danger" : "warn"}">${esc(a.reasons.join(", "))}</span>
    <h2>${a.level >= 2 ? "Pause. This could really hurt someone." : "Want to take another look?"}</h2>
    <div class="quote">${highlight(text, a.hits)}</div>
    <p>Would you say this to their face? Real people read this, sometimes over and over.${a.level >= 2 ? " If you post it, the Shield will likely hide it from them anyway." : ""}</p>
    ${kinder && kinder !== text ? `<p class="small">Without the hurtful words:</p><div class="quote">${esc(kinder)}</div>` : ""}
    <div class="modal-acts">
      <button class="btn" data-m="anyway">Post anyway</button>
      <button class="btn" data-m="edit">Edit</button>
      ${kinder && kinder !== text ? `<button class="btn primary" data-m="kind">Use kinder version</button>` : ""}
    </div>`,
    root => {
      root.querySelector('[data-m="edit"]').onclick = () => { closeModal(); onEdit(); };
      root.querySelector('[data-m="anyway"]').onclick = () => { closeModal(); logIt("You posted after a warning"); onSend(text); };
      const k = root.querySelector('[data-m="kind"]');
      if (k) k.onclick = () => { closeModal(); S.stats.kind++; logIt("You chose the kinder version"); onSend(kinder); };
    });
  renderPanel();
}

function openReport(who, postId, commentId, text) {
  const name = nm(who);
  openModal(`<h2>Report ${esc(name)}</h2>
    ${text ? `<div class="quote">${esc(text)}</div>` : ""}
    <p>What's going on? Only Kindred's admins see reports.</p>
    <div class="reasons">
      ${["Bullying or harassment", "Threat or violence", "Encouraging self-harm", "Hate speech", "Spam"].map((r, i) => `<label><input type="radio" name="reason" id="r${i}" value="${r}" ${i === 0 ? "checked" : ""}> ${r}</label>`).join("")}
      <label><input type="checkbox" id="alsoBlock" checked> Also block ${esc(name)}</label>
    </div>
    <div class="modal-acts"><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="send">Submit report</button></div>`,
    root => {
      root.querySelector('[data-m="cancel"]').onclick = closeModal;
      root.querySelector('[data-m="send"]').onclick = async () => {
        const reason = root.querySelector('input[name="reason"]:checked').value;
        const blk = root.querySelector("#alsoBlock").checked;
        closeModal();
        try {
          await addDoc(collection(db, "reports"), { by: S.uid, target: who, post: postId || "", comment: commentId || "", text: (text || "").slice(0, 1000), reason, at: serverTimestamp() });
          logIt(`Reported ${name}: ${reason.toLowerCase()}`);
          toast(blk ? `Reported and blocked ${name}` : "Report sent to Kindred's admins");
          if (blk) block(who, true);
        } catch (x) { fail(x); }
      };
    });
}
function block(who, quiet) {
  if (!who || who === S.uid || S.prefs.blocked.includes(who)) return;
  S.prefs.blocked.push(who); savePrefs(); logIt("Blocked " + nm(who)); schedule();
  if (!quiet) toast("Blocked. You won't see their posts or comments.");
}
function confirmBox(title, body, yes, onYes) {
  openModal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="modal-acts"><button class="btn" data-m="no">Cancel</button><button class="btn primary" data-m="yes">${esc(yes)}</button></div>`, root => {
    root.querySelector('[data-m="no"]').onclick = closeModal;
    root.querySelector('[data-m="yes"]').onclick = () => { closeModal(); onYes(); };
  });
}
const refFor = (kind, id) => doc(db, kind === "post" ? "posts" : "comments", id);

/* ---------- events ---------- */
$("#compose").addEventListener("input", updateTone);
$("#composer").addEventListener("submit", e => {
  e.preventDefault(); if (!canAct()) return;
  const ta = $("#compose"); const v = ta.value.trim(); if (!v) return;
  gate(v, async text => {
    try { await addDoc(collection(db, "posts"), { author: S.uid, text, at: serverTimestamp(), likes: [] }); ta.value = ""; updateTone(); toast("Posted"); }
    catch (x) { fail(x); }
  }, () => ta.focus());
});
$("#posts").addEventListener("submit", e => {
  const f = e.target.closest(".cmt-form"); if (!f) return; e.preventDefault();
  const post = f.dataset.post; const v = f.querySelector("input").value.trim(); if (!v || !canAct()) return;
  gate(v, async text => {
    try { await addDoc(collection(db, "comments"), { post, author: S.uid, text, at: serverTimestamp() }); const el = document.getElementById("c-" + post); if (el) el.value = ""; toast("Comment added"); }
    catch (x) { fail(x); }
  }, () => { const el = document.getElementById("c-" + post); el && el.focus(); });
});
$("#posts").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "like" && canAct()) {
    const p = S.posts.find(x => x.id === id); const liked = (p?.likes || []).includes(S.uid);
    updateDoc(doc(db, "posts", id), { likes: liked ? arrayRemove(S.uid) : arrayUnion(S.uid) }).catch(fail);
  }
  if (act === "reveal") { S.revealed.add(id); schedule(); }
  if (act === "block") block(b.dataset.who);
  if (act === "report") openReport(b.dataset.who, b.dataset.post, b.dataset.comment, b.dataset.text || "");
  if (act === "del") confirmBox(`Delete this ${b.dataset.kind}?`, "It will be gone for everyone.", "Delete", () => deleteDoc(refFor(b.dataset.kind, id)).then(() => toast("Deleted")).catch(fail));
  if (act === "remove" && S.isAdmin) confirmBox(`Remove this ${b.dataset.kind}?`, "It will be deleted for everyone.", "Remove", () => deleteDoc(refFor(b.dataset.kind, id)).then(() => { toast("Removed"); logIt("Removed a " + b.dataset.kind + " for everyone"); }).catch(fail));
});
$("#reports").addEventListener("click", e => {
  const b = e.target.closest("[data-mod]"); if (!b || !S.isAdmin) return;
  const a = b.dataset.mod;
  if (a === "remove") deleteDoc(refFor(b.dataset.kind, b.dataset.id)).then(() => toast("Removed for everyone")).catch(fail);
  if (a === "ban") confirmBox(`Ban ${nm(b.dataset.who)}?`, "Their posts and comments will be hidden and they won't be able to post.", "Ban", () => updateDoc(doc(db, "users", b.dataset.who), { banned: true }).then(() => toast("Banned")).catch(fail));
  if (a === "unban") updateDoc(doc(db, "users", b.dataset.who), { banned: false }).then(() => toast("Unbanned")).catch(fail);
  if (a === "dismiss") deleteDoc(doc(db, "reports", b.dataset.id)).catch(fail);
});
document.querySelector(".seg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; S.prefs.level = b.dataset.lvl; S.revealed.clear();
  savePrefs(); logIt("Filter set to " + b.textContent); schedule();
});
$("#pill").addEventListener("click", () => $("#shieldPanel").scrollIntoView({ behavior: "smooth", block: "start" }));
$("#muteForm").addEventListener("submit", e => {
  e.preventDefault(); const v = $("#muteInput").value.trim().toLowerCase(); if (!v || S.prefs.muted.includes(v)) return;
  S.prefs.muted.push(v); $("#muteInput").value = ""; savePrefs(); logIt(`Muted "${v}"`); schedule();
});
$("#shieldPanel").addEventListener("click", e => {
  const um = e.target.closest("[data-unmute]"); if (um) { S.prefs.muted = S.prefs.muted.filter(w => w !== um.dataset.unmute); savePrefs(); schedule(); }
  const ub = e.target.closest("[data-unblock]"); if (ub) { S.prefs.blocked = S.prefs.blocked.filter(k => k !== ub.dataset.unblock); savePrefs(); logIt("Unblocked someone"); schedule(); }
});
$("#acct").addEventListener("click", () => {
  if (S.mode === "guest") { signOut(auth); return; }
  S.editingProfile = true; gateShown = null; updateMode();
});
$("#banner").addEventListener("click", e => { if (e.target.closest("[data-login]")) signOut(auth); });
setInterval(schedule, 60000); // keep "5m ago" labels fresh

/* ---------- start ---------- */
renderPanel();
if (!configured) { S.mode = "setup"; updateMode(); }
else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app);
  onAuthStateChanged(auth, user => {
    S.uid = user ? user.uid : null; S.isAdmin = false; S.reports = [];
    S.usersLoaded = false; S.editingProfile = false; gateShown = null;
    if (!user) { authTab = "login"; stopListening(); S.posts = []; S.comments = []; S.users = {}; S.prefs = { level: "standard", muted: [], blocked: [] }; }
    else listen(user);
    decideMode();
  });
}
