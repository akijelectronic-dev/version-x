const $ = id => document.getElementById(id);
const log = $("transcript-log"), input = $("text-input"), sphere = $("sphere"), mic = $("mic-btn");
let activeAgent = "auto", listening = false, history = [], tasks = [], ctrl = null, contacts = {}, pendingActions = [], camImage = null, brain = { facts: [], style: "" }, learnQ = Promise.resolve();
let ttsOn = localStorage.getItem("vx_tts") === "1", fails = 0, blockedUntil = 0;

function nowString() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "long" }) + " " + d.toLocaleString("sv-SE") + " (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";
}
const setStatus = s => { $("status").textContent = s; FLOAT.setStatus(s); };

// Agent room: ম্যানেজার কাজ দিলে এজেন্ট বসা থেকে কাজ করার অবস্থায় যায়
const MGR_IDLE = "কাজের অপেক্ষায়";
const AG_TEXT = { idle: "বসে আছে", queued: "কাজ পেয়েছে", working: "কাজ করছে", review: "যাচাই করছে", done: "শেষ" };
function setAgent(name, state) {
  const el = document.querySelector(`.agent[data-agent="${name}"]`);
  if (!el) return;
  el.dataset.state = state;
  el.querySelector("small").textContent = AG_TEXT[state];
  const node = document.querySelector(`.node[data-agent="${name}"]`);
  if (node) node.classList.toggle("pulse", state === "working");
}
function setMgr(text) {
  $("mgr-status").textContent = text;
  $("mgr").classList.toggle("busy", text !== MGR_IDLE);
}
function resetRoom() {
  ["memory", "chat", "coder", "writer"].forEach(a => setAgent(a, "idle"));
  setMgr(MGR_IDLE);
}
function onEvent(ev) {
  if (ev.type === "manager") setMgr(ev.state === "planning" ? "কাজ ভাগ করছে…" : "উত্তর গুছিয়ে নিচ্ছে…");
  else if (ev.type === "plan") { setMgr("কাজ বুঝিয়ে দিচ্ছে"); ev.steps.forEach(a => setAgent(a, "queued")); }
  else if (ev.type === "start") { setAgent(ev.agent, "working"); setMgr("কাজ দেখছে"); }
  else if (ev.type === "review") { setAgent(ev.agent, "review"); setMgr("ভুল খুঁজে দেখছে"); }
  else if (ev.type === "actions") pendingActions = ev.actions || [];
  else if (ev.type === "done") setAgent(ev.agent, "done");
}

function addLine(text, cls) {
  const el = document.createElement("p");
  el.className = "line " + cls;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
// লাইভ টাইপিং ইফেক্ট
function typeLine(text, cls) {
  const el = addLine("", cls);
  const step = Math.max(1, Math.ceil(text.length / 150));
  let i = 0;
  const t = setInterval(() => {
    i += step;
    el.textContent = text.slice(0, i);
    log.scrollTop = log.scrollHeight;
    if (i >= text.length) { clearInterval(t); if (cls === "agent") renderRich(el, text); }
  }, 16);
}

// Splash → Lock
let p = 0;
const timer = setInterval(() => {
  p = Math.min(100, p + Math.random() * 14);
  $("progress-bar").style.width = p + "%";
  if (p >= 100) {
    clearInterval(timer);
    $("splash").classList.add("hide");
    setTimeout(() => $("splash").remove(), 700);
    showLock();
  }
}, 180);

function showLock() {
  const fresh = !VX.hasPin();
  $("lock-msg").textContent = fresh ? "নতুন PIN সেট করুন (৪–১২ সংখ্যা)। দীর্ঘ PIN বেশি নিরাপদ।" : "PIN দিয়ে আনলক করুন";
  $("forgot").hidden = fresh;
  $("lock").hidden = false;
  $("app").hidden = true;
  $("pin-input").value = "";
  $("pin-input").focus();
}

async function submitPin() {
  const pin = $("pin-input").value.trim(), err = $("lock-err");
  err.textContent = "";
  if (!/^\d{4,12}$/.test(pin)) { err.textContent = "৪–১২ সংখ্যার PIN দিন"; return; }
  if (Date.now() < blockedUntil) { err.textContent = "অনেকবার ভুল হয়েছে, ৩০ সেকেন্ড পরে চেষ্টা করুন"; return; }
  if (!VX.hasPin()) await VX.setup(pin);
  else if (!(await VX.unlock(pin))) {
    if (++fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; }
    err.textContent = "ভুল PIN";
    return;
  }
  history = await VX.load();
  tasks = await VX.load("tasks");
  const bn = await VX.load("brain");
  brain = bn && !Array.isArray(bn) && Array.isArray(bn.facts) ? bn : { facts: [], style: "" };
  const cts = await VX.load("contacts");
  contacts = Array.isArray(cts) ? {} : cts;
  renderTasks();
  log.innerHTML = "";
  addLine("> সিস্টেম প্রস্তুত। Manager Agent অনলাইন।", "sys");
  history.forEach(m => {
    if (m.role === "user") addLine(m.content, "user");
    else renderRich(addLine("", "agent"), m.content);
  });
  $("lock").hidden = true;
  $("app").hidden = false;
  offerPermissions();
}
$("pin-btn").onclick = submitPin;
$("pin-input").addEventListener("keydown", e => { if (e.key === "Enter") submitPin(); });
$("forgot").onclick = () => {
  if (confirm("PIN রিসেট করলে এই ডিভাইসের সব চ্যাট হিস্ট্রি স্থায়ীভাবে মুছে যাবে। এগিয়ে যাবেন?")) { VX.wipe(); showLock(); }
};

// Send
function flashNodes(steps) {
  steps.forEach((a, i) => setTimeout(() => {
    const n = document.querySelector(`.node[data-agent="${a}"]`);
    if (!n) return;
    n.classList.add("pulse");
    setTimeout(() => n.classList.remove("pulse"), 700);
  }, i * 750));
}

let sending = false;
const sendQ = [];
async function send(text, image = null) {
  text = (text || "").trim();
  if (!text) return;
  if (sending) { sendQ.push([text, image]); return; }
  sending = true;
  try { await doSend(text, image); }
  finally {
    sending = false;
    if (sendQ.length) { const [t, i] = sendQ.shift(); send(t, i); }
  }
}

async function doSend(text, image = null) {
  text = text.trim();
  if (!text) return;
  stopSpeaking();
  addLine(image ? "[ছবি] " + text : text, "user");
  pendingActions = [];
  input.value = "";
  sphere.classList.add("thinking");
  setStatus("THINKING");
  ctrl = new AbortController();
  try {
    const r = await askAgent(text, activeAgent, history, ctrl.signal, onEvent, { image, contacts: Object.keys(contacts), brain, now: nowString() });
    if (r.steps && r.steps.length > 1) addLine("> " + r.steps.join(" → ").toUpperCase(), "sys");
    setMgr(MGR_IDLE);
    setTimeout(resetRoom, 2500);
    typeLine(r.reply, "agent");
    if (document.hidden) pushNotify("Version X", r.reply.replace(/```[\s\S]*?```/g, " কোড ").slice(0, 120));
    showActions(pendingActions);
    history.push({ role: "user", content: (image ? "[ছবি] " : "") + text }, { role: "assistant", content: r.reply });
    history = history.slice(-40);
    await VX.save(history);
    learnQ = learnQ.then(() => learn(text, r.reply));
    if (ttsOn) { setStatus("SPEAKING"); speak(r.reply, () => setStatus(VOICE.active ? "LISTENING" : "STANDBY")); }
  } catch (e) {
    resetRoom();
    if (e.name === "AbortError") addLine("> বন্ধ করা হয়েছে।", "sys");
    else addLine("ত্রুটি: " + e.message, "err");
  } finally {
    sphere.classList.remove("thinking");
    if ($("status").textContent === "THINKING") setStatus(VOICE.active ? "LISTENING" : "STANDBY");
  }
}
$("send-btn").onclick = () => send(input.value);
input.addEventListener("keydown", e => { if (e.key === "Enter") send(input.value); });

document.querySelectorAll(".node").forEach(n => n.onclick = () => {
  const same = n.classList.contains("active");
  document.querySelectorAll(".node").forEach(x => x.classList.remove("active"));
  activeAgent = same ? "auto" : n.dataset.agent;
  if (!same) n.classList.add("active");
});

mic.onclick = () => {
  if (VOICE.active) { VOICE.stop(); return; }
  stopSpeaking();
  VOICE.start(t => send(t), (state, msg) => {
    if (state === "on") { listening = true; mic.classList.add("listening"); setStatus("LISTENING"); }
    else {
      listening = false; mic.classList.remove("listening");
      if ($("status").textContent === "LISTENING") setStatus("STANDBY");
      if (state === "error" && msg) addLine(msg, "err");
    }
  });
};

// Voice reply toggle
const ttsBtn = $("tts-btn");
ttsBtn.setAttribute("aria-pressed", ttsOn);
ttsBtn.onclick = () => {
  ttsOn = !ttsOn;
  localStorage.setItem("vx_tts", ttsOn ? "1" : "0");
  ttsBtn.setAttribute("aria-pressed", ttsOn);
  if (!ttsOn) stopSpeaking();
};

// Settings menu
const menu = $("menu");
$("settings-btn").onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
document.addEventListener("click", () => { menu.hidden = true; });
$("lock-btn").onclick = () => { stopSpeaking(); VX.lock(); history = []; tasks = []; contacts = {}; brain = { facts: [], style: "" }; renderTasks(); resetRoom(); log.innerHTML = ""; showLock(); };
$("clear-btn").onclick = async () => {
  if (confirm("এই ডিভাইস থেকে সব চ্যাট হিস্ট্রি মুছে ফেলবেন?")) {
    history = []; await VX.save(history);
    log.innerHTML = ""; addLine("> হিস্ট্রি মুছে ফেলা হয়েছে।", "sys");
  }
};

// STOP: বর্তমান অনুরোধ, কথা বলা আর ভয়েস ইনপুট বন্ধ
$("stop-btn").onclick = () => {
  sendQ.length = 0;
  if (ctrl) ctrl.abort();
  stopSpeaking();
  setStatus(VOICE.active ? "LISTENING" : "STANDBY");
};

// Tasks (এনক্রিপ্টেড, শুধু এই ডিভাইসে)
const saveTasks = () => VX.save(tasks, "tasks");
function renderTasks() {
  const list = $("task-list");
  list.innerHTML = "";
  if (!tasks.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "কোনো কাজ নেই। একটা যোগ করুন।";
    list.appendChild(li);
  }
  tasks.forEach((t, i) => {
    const li = document.createElement("li");
    if (t.done) li.className = "done";
    const b = document.createElement("button");
    b.className = "task-toggle"; b.textContent = t.text;
    b.onclick = () => { t.done = !t.done; saveTasks(); renderTasks(); };
    const x = document.createElement("button");
    x.className = "task-del"; x.textContent = "×"; x.setAttribute("aria-label", "কাজ মুছুন");
    x.onclick = () => { tasks.splice(i, 1); saveTasks(); renderTasks(); };
    li.append(b, x);
    list.appendChild(li);
  });
  const left = tasks.filter(t => !t.done).length;
  $("task-left").textContent = left + " left";
  $("task-bar").style.width = (tasks.length ? (tasks.length - left) / tasks.length * 100 : 0) + "%";
}
function addTask() {
  const v = $("task-input").value.trim();
  if (!v) return;
  tasks.push({ text: v.slice(0, 80), done: false });
  $("task-input").value = "";
  saveTasks(); renderTasks();
}
$("task-add").onclick = addTask;
$("task-input").addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });

// কোড ব্লক ও `inline code` সুন্দরভাবে দেখানো (DOM দিয়ে, তাই নিরাপদ)
function inlineText(el, s) {
  s.split(/`([^`\n]+)`/g).forEach((p, i) => {
    if (i % 2) { const c = document.createElement("code"); c.className = "ic"; c.textContent = p; el.appendChild(c); }
    else el.appendChild(document.createTextNode(p));
  });
}
function renderRich(el, text) {
  el.textContent = "";
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  for (let i = 0; i < parts.length; i += 3) {
    inlineText(el, parts[i]);
    if (i + 2 < parts.length) {
      const pre = document.createElement("pre"), code = document.createElement("code");
      code.textContent = parts[i + 2].replace(/\n$/, "");
      const b = document.createElement("button");
      b.className = "copy"; b.textContent = "COPY";
      b.onclick = () => navigator.clipboard.writeText(code.textContent)
        .then(() => { b.textContent = "COPIED"; setTimeout(() => (b.textContent = "COPY"), 1200); })
        .catch(() => {});
      pre.append(b, code);
      el.appendChild(pre);
    }
  }
  log.scrollTop = log.scrollHeight;
}

// TRANSCRIPT শিরোনামে ট্যাপ করলে বক্স বড়/ছোট হয়
document.querySelector(".transcript .panel-title").onclick = () =>
  document.querySelector(".transcript").classList.toggle("big");

// ---------- ফোন অ্যাকশন ----------
async function resolveNumber(a) {
  const direct = PHONE.cleanNumber(a.number);
  if (direct) return direct;
  const name = (a.name || "").trim().toLowerCase();
  if (name) {
    const key = Object.keys(contacts).find(k => k.toLowerCase() === name)
      || Object.keys(contacts).find(k => name.includes(k.toLowerCase()) || k.toLowerCase().includes(name));
    if (key) return PHONE.cleanNumber(contacts[key]);
  }
  if ("contacts" in navigator && navigator.contacts && navigator.contacts.select) {
    try {
      const sel = await navigator.contacts.select(["name", "tel"], { multiple: false });
      const pick = PHONE.cleanNumber(sel && sel[0] && sel[0].tel && sel[0].tel[0]);
      if (pick) { if (a.name) { contacts[a.name] = pick; await VX.save(contacts, "contacts"); } return pick; }
    } catch (_) {}
  }
  const typed = prompt((a.name || "এই ব্যক্তি") + " এর নম্বর দিন (শুধু এই ফোনে সেভ হবে):");
  const n = PHONE.cleanNumber(typed);
  if (n && a.name) { contacts[a.name] = n; await VX.save(contacts, "contacts"); }
  return n;
}
function showActions(list) {
  if (!list || !list.length) return;
  const box = document.createElement("div");
  box.className = "actions";
  list.slice(0, 3).forEach(a => {
    const act = PHONE.build(a, { resolveNumber, openCamera, notify: t => addLine("> " + t, "sys") });
    if (!act) return;
    const b = document.createElement("button");
    b.className = "act"; b.textContent = act.label;
    b.onclick = async () => {
      try {
        if (autoFloat && FLOAT_TYPES.has(a.type) && FLOAT.supported) { try { await FLOAT.start(); await new Promise(r => setTimeout(r, 250)); } catch (_) {} }
        const m = await act.run(); if (m) addLine("> " + m, "sys");
      }
      catch (e) { addLine("ত্রুটি: " + e.message, "err"); }
    };
    box.appendChild(b);
  });
  if (box.children.length) { log.appendChild(box); log.scrollTop = log.scrollHeight; }
}
$("contact-btn").onclick = async () => {
  const name = (prompt("পরিচিতির নাম (যেমন: মা):") || "").trim().slice(0, 40);
  if (!name) return;
  const n = PHONE.cleanNumber(prompt(name + " এর নম্বর:"));
  if (!n) { addLine("ত্রুটি: নম্বরটা সঠিক না", "err"); return; }
  contacts[name] = n;
  await VX.save(contacts, "contacts");
  addLine("> পরিচিতি সেভ হয়েছে: " + name + " (শুধু এই ফোনে, এনক্রিপ্টেড)", "sys");
};

// ---------- ক্যামেরা ----------
async function openCamera(mode) {
  $("cam").hidden = false;
  $("cam-ask").hidden = true; $("cam-ctl").hidden = false;
  camImage = null;
  try { await CAM.open(mode); }
  catch (e) { closeCamera(); addLine("ত্রুটি: " + e.message, "err"); }
}
function closeCamera() { stopLive(); CAM.close(); $("cam").hidden = true; }
$("cam-btn").onclick = () => openCamera();
$("cam-close").onclick = closeCamera;
$("cam-flip").onclick = () => CAM.flip().catch(e => addLine("ত্রুটি: " + e.message, "err"));
$("cam-shot").onclick = () => {
  stopLive();
  camImage = CAM.snap();
  $("cam-video").pause();
  $("cam-ctl").hidden = true; $("cam-ask").hidden = false;
  $("cam-q").value = "এটা কী? বিস্তারিত বলো।";
  $("cam-q").focus(); $("cam-q").select();
};
$("cam-retake").onclick = () => { camImage = null; $("cam-video").play(); $("cam-ask").hidden = true; $("cam-ctl").hidden = false; };
function sendPhoto() {
  const q = $("cam-q").value.trim() || "এটা কী? বিস্তারিত বলো।", img = camImage;
  closeCamera();
  if (img) send(q, img);
}
$("cam-send").onclick = sendPhoto;
$("cam-q").addEventListener("keydown", e => { if (e.key === "Enter") sendPhoto(); });

// ---------- ব্রেইন: কথা বলতে বলতে শেখে, সবকিছু এনক্রিপ্টেড হয়ে শুধু এই ফোনে থাকে ----------
async function learn(userText, reply) {
  if (userText.length < 8) return;
  try {
    const next = await learnBrain(userText, reply, brain);
    if (next && Array.isArray(next.facts)) { brain = next; await VX.save(brain, "brain"); }
  } catch (_) {}
}
$("brain-btn").onclick = () => {
  document.querySelector(".transcript").classList.add("big");
  const n = brain.facts.length;
  if (!n && !brain.style) { addLine("> ব্রেইন এখনো খালি। কথা বলতে বলতে শিখবে।", "sys"); return; }
  addLine("> ব্রেইনে এখন " + n + "টা তথ্য মনে আছে:", "sys");
  brain.facts.slice(0, 25).forEach(f => addLine("• " + f, "sys"));
  if (n > 25) addLine("… আরও " + (n - 25) + "টা", "sys");
  if (brain.style) addLine("> আপনার কথার ধরন: " + brain.style, "sys");
};
$("brain-clear").onclick = async () => {
  if (confirm("ব্রেইনের সব স্মৃতি এই ফোন থেকে মুছে ফেলবেন?")) {
    brain = { facts: [], style: "" };
    await VX.save(brain, "brain");
    addLine("> ব্রেইন খালি করা হয়েছে।", "sys");
  }
};

// ---------- লাইভ ক্যামেরা: প্রতি ৫ সেকেন্ডে একটা ফ্রেম, AI ছোট মন্তব্য করে ----------
let liveOn = false, liveTimer = null, liveBusy = false, livePrev = [];
async function liveTick(task) {
  if (!liveOn || liveBusy) return;
  liveBusy = true;
  try {
    const r = (await askLive(CAM.snap(640, 0.6), task, livePrev, brain)).trim();
    if (!liveOn) return;
    if (r && r !== "...") {
      const cap = $("cam-caption");
      cap.hidden = false; cap.textContent = r;
      livePrev = [...livePrev, r].slice(-3);
      if (ttsOn) speak(r);
    }
  } catch (e) {
    if (String(e.message).includes("429")) stopLive("অনেক বেশি অনুরোধ হয়ে গেছে, লাইভ বন্ধ করা হলো");
  } finally { liveBusy = false; }
}
async function startLive() {
  const task = prompt("লাইভে আমি কী করব? (খালি রাখলে যা দেখছি বলব)");
  if (task === null) return;
  liveOn = true; livePrev = [];
  $("cam-live").classList.add("on"); $("cam-live").textContent = "STOP";
  const cap = $("cam-caption"); cap.hidden = false; cap.textContent = "দেখছি…";
  PHONE.keepAwake(true);
  liveTimer = setInterval(() => liveTick(task), 5000);
  liveTick(task);
}
function stopLive(msg) {
  if (!liveOn) return;
  liveOn = false; clearInterval(liveTimer); stopSpeaking();
  $("cam-live").classList.remove("on"); $("cam-live").textContent = "LIVE";
  $("cam-caption").hidden = true;
  PHONE.keepAwake(false);
  if (msg) addLine("> " + msg, "sys");
}
$("cam-live").onclick = () => (liveOn ? stopLive() : startLive());

// ---------- ভাসমান বৃত্ত ----------
const FLOAT_TYPES = new Set(["map", "navigate", "search", "youtube", "open_url", "open_app", "calendar"]);
let autoFloat = localStorage.getItem("vx_autofloat") !== "0";
const floatBtn = $("float-btn");
FLOAT.onchange = () => floatBtn.setAttribute("aria-pressed", FLOAT.on);
floatBtn.onclick = async () => {
  try { if (FLOAT.on) await FLOAT.stop(); else await FLOAT.start(); }
  catch (e) { addLine("ত্রুটি: " + e.message, "err"); }
};
const afBtn = $("autofloat-btn");
const showAf = () => { afBtn.textContent = "ভাসমান বৃত্ত অটো: " + (autoFloat ? "চালু" : "বন্ধ"); };
showAf();
afBtn.onclick = () => { autoFloat = !autoFloat; localStorage.setItem("vx_autofloat", autoFloat ? "1" : "0"); showAf(); };

// ---------- পারমিশন ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
async function requestPermissions() {
  const res = [];
  const ask = async (name, fn) => { try { await fn(); res.push(name + " ✓"); } catch (_) { res.push(name + " ✗"); } };
  // নোটিফিকেশন আগে, কারণ এটার জন্য ট্যাপের সঙ্গে সঙ্গে চাইতে হয়
  await ask("নোটিফিকেশন", async () => { if ((await Notification.requestPermission()) !== "granted") throw 0; });
  await ask("মাইক", async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()));
  await ask("ক্যামেরা", async () => (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach(t => t.stop()));
  await ask("লোকেশন", () => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 12000 })));
  await ask("স্থায়ী স্টোরেজ", async () => { if (!(await navigator.storage.persist())) throw 0; });
  localStorage.setItem("vx_perm", "1");
  addLine("> পারমিশন: " + res.join(", "), "sys");
  if (res.some(x => x.endsWith("✗"))) addLine("> ✗ হলে ব্রাউজারের Site settings থেকে সেটা চালু করুন (ঠিকানার পাশের তালা চিহ্নে ট্যাপ করুন)।", "sys");
}
function offerPermissions() {
  if (localStorage.getItem("vx_perm") === "1") return;
  const box = document.createElement("div");
  box.className = "actions";
  const b = document.createElement("button");
  b.className = "act"; b.textContent = "পারমিশন দিন (মাইক, ক্যামেরা, লোকেশন, নোটিফিকেশন)";
  b.onclick = async () => { b.disabled = true; await requestPermissions(); box.remove(); };
  box.appendChild(b); log.appendChild(box);
}
$("perm-btn").onclick = requestPermissions;
