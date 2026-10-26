// চ্যাট হিস্ট্রি PIN থেকে তৈরি AES-GCM key দিয়ে এনক্রিপ্ট হয়ে শুধু এই ডিভাইসে থাকে।
const VX = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  let key = null; // শুধু মেমোরিতে, কোথাও সেভ হয় না

  async function derive(pin, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ iv: b64(iv), ct: b64(ct) });
  }
  async function decrypt(str) {
    const { iv, ct } = JSON.parse(str);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
    return JSON.parse(dec.decode(pt));
  }
  return {
    hasPin: () => !!localStorage.getItem("vx_check"),
    async setup(pin) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      localStorage.setItem("vx_salt", b64(salt));
      localStorage.removeItem("vx_history");
      key = await derive(pin, salt);
      localStorage.setItem("vx_check", await encrypt("ok"));
    },
    async unlock(pin) {
      try {
        key = await derive(pin, unb64(localStorage.getItem("vx_salt")));
        await decrypt(localStorage.getItem("vx_check"));
        return true;
      } catch { key = null; return false; }
    },
    async save(obj, name = "data") { if (key) localStorage.setItem("vx_" + name, await encrypt(obj)); },
    async load(name = "data") {
      const d = localStorage.getItem("vx_" + name);
      if (!d || !key) return [];
      try { return await decrypt(d); } catch { return []; }
    },
    lock() { key = null; },
    wipe() { ["vx_salt", "vx_check", "vx_data", "vx_tasks", "vx_contacts", "vx_brain", "vx_history"].forEach(k => localStorage.removeItem(k)); key = null; }
  };
})();
