// Cloudflare Worker URL এখানে বসান
const WORKER_URL = "https://version-x1.akijelectronic.workers.dev/";

// লাইভ ইভেন্ট onEvent-এ আসে; শেষে ফেরত দেয় { reply, steps }
async function askAgent(message, agent = "auto", history = [], signal, onEvent = () => {}, extra = {}) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agent, history: history.slice(-10), image: extra.image || undefined, contacts: extra.contacts || [], brain: extra.brain, now: extra.now })
  });
  if (res.status === 429) throw new Error("অনেক বেশি অনুরোধ, এক মিনিট পরে চেষ্টা করুন");
  if (!res.ok) throw new Error("Server error " + res.status);

  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", final = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (_) { continue; }
      if (ev.type === "error") throw new Error(ev.message);
      if (ev.type === "final") final = ev; else onEvent(ev);
    }
  }
  if (!final) throw new Error("উত্তর অসম্পূর্ণ এসেছে");
  return final;
}

// ব্রেইন আপডেট: একটা কথোপকথন থেকে নতুন তথ্য শেখে। ফেরত দেয় নতুন ব্রেইন (অথবা null)
async function learnBrain(user, assistant, brain) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "learn", user, assistant, brain })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.brain ? data.brain : null;
}

// লাইভ ক্যামেরা: একটা ফ্রেম পাঠিয়ে ছোট মন্তব্য নেয় ("..." মানে নতুন কিছু নেই)
async function askLive(image, task, prev, brain) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "live", image, message: task, prev, brain })
  });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error("live " + res.status);
  const d = await res.json();
  return d.reply || "";
}
