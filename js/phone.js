// ফোন অ্যাকশন: AI শুধু প্রস্তাব দেয়, ইউজার বাটনে ট্যাপ করলে তবেই চলে।
// ব্রাউজার যা পারে তার ভেতরেই কাজ করে (কল/এসএমএস অ্যাপ খোলা, ম্যাপ, টাইমার, ফ্ল্যাশলাইট ইত্যাদি)।
const PHONE = (() => {
  const enc = encodeURIComponent;
  const cleanNumber = s => { const n = String(s || "").replace(/[^\d+]/g, ""); return /^\+?\d{3,15}$/.test(n) ? n : null; };
  const httpsUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch (_) { return null; } };
  let torch = null;

  function beep() {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator();
      o.connect(c.destination); o.frequency.value = 880; o.start();
      setTimeout(() => { o.stop(); c.close(); }, 700);
    } catch (_) {}
  }
  function fmt(sec) {
    if (sec % 3600 === 0) return sec / 3600 + " ঘণ্টা";
    if (sec % 60 === 0) return sec / 60 + " মিনিট";
    return sec + " সেকেন্ড";
  }
  async function flashlight(on) {
    if (!on) { if (torch) { torch.stop(); torch = null; } return "ফ্ল্যাশলাইট বন্ধ"; }
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const t = s.getVideoTracks()[0];
    const caps = t.getCapabilities ? t.getCapabilities() : {};
    if (!caps.torch) { t.stop(); throw new Error("এই ডিভাইসে ব্রাউজার থেকে ফ্ল্যাশলাইট চালানো যায় না"); }
    await t.applyConstraints({ advanced: [{ torch: true }] });
    torch = t;
    return "ফ্ল্যাশলাইট চালু";
  }
  const APP_LINKS = {
    whatsapp: "whatsapp://send", messenger: "fb-messenger://", facebook: "fb://feed", instagram: "instagram://app",
    youtube: "vnd.youtube://", telegram: "tg://", spotify: "spotify://", playstore: "market://search?q=", maps: "geo:0,0?q="
  };
  let wake = null;
  async function keepAwake(on) {
    try {
      if (on) { if (!navigator.wakeLock) return false; wake = await navigator.wakeLock.request("screen"); return true; }
      if (wake) { await wake.release(); wake = null; }
      return !!navigator.wakeLock;
    } catch (_) { return false; }
  }
  const go = url => { location.href = url; };
  const open = url => { window.open(url, "_blank", "noopener"); };

  // ফেরত দেয় { label, run } অথবা null (অচেনা/অনিরাপদ হলে)
  function build(a, h) {
    const who = a.name || a.number || a.to || "";
    switch (a.type) {
      case "call": return { label: "CALL · " + who, run: async () => { const n = await h.resolveNumber(a); if (!n) throw new Error("নম্বর পাওয়া যায়নি"); go("tel:" + n); } };
      case "sms": return { label: "SMS · " + who, run: async () => { const n = await h.resolveNumber(a); if (!n) throw new Error("নম্বর পাওয়া যায়নি"); go("sms:" + n + "?body=" + enc(a.text)); } };
      case "whatsapp": return { label: "WHATSAPP · " + (who || "চ্যাট"), run: async () => {
        const n = (a.number || a.name) ? await h.resolveNumber(a) : "";
        open("https://wa.me/" + (n ? n.replace(/\D/g, "") : "") + "?text=" + enc(a.text)); } };
      case "email": return { label: "EMAIL · " + (a.to || ""), run: async () => go("mailto:" + enc(a.to) + "?subject=" + enc(a.subject) + "&body=" + enc(a.body)) };
      case "map": return { label: "MAP · " + a.query, run: async () => open("https://www.google.com/maps/search/?api=1&query=" + enc(a.query)) };
      case "navigate": return { label: "NAVIGATE · " + a.query, run: async () => open("https://www.google.com/maps/dir/?api=1&destination=" + enc(a.query)) };
      case "search": return { label: "SEARCH · " + a.query, run: async () => open("https://www.google.com/search?q=" + enc(a.query)) };
      case "youtube": return { label: "YOUTUBE · " + a.query, run: async () => open("https://www.youtube.com/results?search_query=" + enc(a.query)) };
      case "open_url": { const u = httpsUrl(a.url); return u ? { label: "OPEN · " + new URL(u).hostname, run: async () => open(u) } : null; }
      case "timer": return { label: "TIMER · " + fmt(a.seconds), run: async () => {
        if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (_) {} }
        setTimeout(() => {
          beep(); if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
          if ("Notification" in window && Notification.permission === "granted") new Notification("Version X", { body: a.label || "টাইমার শেষ" });
          h.notify("টাইমার শেষ: " + (a.label || fmt(a.seconds)));
        }, a.seconds * 1000);
        return "টাইমার চালু (" + fmt(a.seconds) + "). অ্যাপ খোলা রাখুন, বন্ধ করলে বাজবে না।"; } };
      case "copy": return { label: "COPY", run: async () => { await navigator.clipboard.writeText(a.text); return "কপি হয়েছে"; } };
      case "share": return { label: "SHARE", run: async () => { if (!navigator.share) throw new Error("শেয়ার সাপোর্ট নেই"); await navigator.share({ text: a.text }); } };
      case "flashlight": return { label: a.on ? "FLASHLIGHT ON" : "FLASHLIGHT OFF", run: () => flashlight(a.on) };
      case "vibrate": return { label: "VIBRATE", run: async () => { if (!navigator.vibrate) throw new Error("ভাইব্রেশন সাপোর্ট নেই"); navigator.vibrate(a.ms); } };
      case "camera": return { label: "CAMERA", run: async () => h.openCamera(a.mode) };
      case "alarm": return { label: "ALARM · " + String(a.hour).padStart(2, "0") + ":" + String(a.minute).padStart(2, "0"), run: async () => {
        const t = new Date(); t.setHours(a.hour, a.minute, 0, 0);
        if (t <= new Date()) t.setDate(t.getDate() + 1);
        const hhmm = String(a.hour).padStart(2, "0") + ":" + String(a.minute).padStart(2, "0");
        if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (_) {} }
        keepAwake(true);
        setTimeout(() => {
          let n = 0; const iv = setInterval(() => { beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400]); if (++n >= 6) clearInterval(iv); }, 1500);
          if ("Notification" in window && Notification.permission === "granted") new Notification("Version X", { body: a.label || ("অ্যালার্ম " + hhmm) });
          h.notify("অ্যালার্ম: " + (a.label || hhmm));
        }, t - new Date());
        return "অ্যালার্ম সেট (" + hhmm + "). এটা শুধু অ্যাপ খোলা থাকলে বাজবে। অ্যাপ বন্ধ থাকলেও জাগাতে চাইলে ফোনের Clock অ্যাপে সেট করুন।"; } };
      case "calendar": return { label: "CALENDAR · " + (a.title || "ইভেন্ট"), run: async () => {
        const f = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "T" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "00";
        let url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + enc(a.title) + "&details=" + enc(a.details) + "&location=" + enc(a.place);
        const s = a.start ? new Date(a.start) : null;
        if (s && !isNaN(s)) url += "&dates=" + f(s) + "/" + f(new Date(s.getTime() + a.minutes * 60000));
        open(url); } };
      case "location": return { label: "MY LOCATION", run: () => new Promise((ok, no) => {
        if (!navigator.geolocation) return no(new Error("লোকেশন সাপোর্ট নেই"));
        navigator.geolocation.getCurrentPosition(async pos => {
          const link = "https://www.google.com/maps?q=" + pos.coords.latitude.toFixed(5) + "," + pos.coords.longitude.toFixed(5);
          try { await navigator.clipboard.writeText(link); } catch (_) {}
          ok("আপনার লোকেশন (কপি করা হয়েছে): " + link);
        }, () => no(new Error("লোকেশনের অনুমতি দিন")), { enableHighAccuracy: true, timeout: 15000 }); }) };
      case "battery": return { label: "BATTERY", run: async () => {
        if (!navigator.getBattery) throw new Error("এই ব্রাউজারে ব্যাটারির তথ্য পাওয়া যায় না");
        const b = await navigator.getBattery();
        return "ব্যাটারি " + Math.round(b.level * 100) + "%, চার্জ " + (b.charging ? "হচ্ছে" : "হচ্ছে না"); } };
      case "network": return { label: "NETWORK", run: async () => {
        const c = navigator.connection || {};
        return (navigator.onLine ? "অনলাইন" : "অফলাইন") + (c.effectiveType ? ", নেটওয়ার্ক " + c.effectiveType : "") + (c.downlink ? ", গতি প্রায় " + c.downlink + " Mbps" : ""); } };
      case "keep_awake": return { label: a.on ? "KEEP SCREEN ON" : "SCREEN AUTO-OFF", run: async () => (await keepAwake(a.on)) ? (a.on ? "স্ক্রিন জেগে থাকবে (অ্যাপ খোলা থাকলে)" : "স্ক্রিন আগের মতো বন্ধ হবে") : (() => { throw new Error("এই ব্রাউজারে সাপোর্ট নেই"); })() };
      case "fullscreen": return { label: "FULLSCREEN", run: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } };
      case "open_app": { const u = APP_LINKS[a.app]; return u ? { label: "APP · " + a.app, run: async () => { go(u); return "অ্যাপ খুলছে… না খুললে অ্যাপটা ইনস্টল নেই বা ফোন অনুমতি দিচ্ছে না।"; } } : null; }
      case "note": return { label: "SAVE NOTE", run: async () => {
        const blob = new Blob([(a.title ? a.title + "\n\n" : "") + a.text], { type: "text/plain;charset=utf-8" });
        const el = document.createElement("a");
        el.href = URL.createObjectURL(blob); el.download = (a.title || "note").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) + ".txt";
        document.body.appendChild(el); el.click(); el.remove();
        return "নোট ডাউনলোড হয়েছে (Downloads ফোল্ডারে)"; } };
      default: return null;
    }
  }
  return { build, cleanNumber, keepAwake };
})();
