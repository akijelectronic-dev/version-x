// ভাসমান বৃত্ত: ছোট PiP উইন্ডোতে বৃত্তটা অন্য অ্যাপের ওপরে ভেসে থাকে।
// ব্রাউজারের ভিডিও-PiP ব্যবহার করে, তাই পটভূমি কালো (সত্যিকারের স্বচ্ছ ওভারলে শুধু নেটিভ অ্যাপে সম্ভব)।
const FLOAT = (() => {
  const SIZE = 240, c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d");
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.setAttribute("aria-hidden", "true");
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(v);
  let timer = null, t = 0, status = "STANDBY", on = false, cb = () => {};
  const COL = { STANDBY: "#7f9aa0", LISTENING: "#00ff88", THINKING: "#00d2ff", SPEAKING: "#00ff88" };

  function draw() {
    t += 0.07;
    const col = COL[status] || "#00ff88";
    const pulse = status === "THINKING" ? 1 + 0.06 * Math.sin(t * 4) : 1 + 0.03 * Math.sin(t);
    const cx = SIZE / 2, cy = SIZE / 2 - 8, r = 58 * pulse;
    g.globalAlpha = 1; g.fillStyle = "#05080a"; g.fillRect(0, 0, SIZE, SIZE);
    const grad = g.createRadialGradient(cx - 18, cy - 20, 4, cx, cy, r);
    grad.addColorStop(0, "rgba(255,255,255,.28)"); grad.addColorStop(0.4, "rgba(0,255,136,.12)"); grad.addColorStop(1, "rgba(0,210,255,.04)");
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
    g.lineWidth = 2; g.strokeStyle = col; g.globalAlpha = 0.85; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke();
    g.lineWidth = 1; g.strokeStyle = "#00d2ff";
    for (let k = 0; k < 2; k++) {
      g.globalAlpha = 0.55 - k * 0.2; g.beginPath();
      const rr = r + 14 + k * 14;
      g.ellipse(cx, cy, rr, rr * 0.35, t * (k ? -0.6 : 0.8), 0, 6.2832); g.stroke();
    }
    g.fillStyle = col;
    for (let k = 0; k < 18; k++) {
      const a = t * 0.9 + k * 0.7;
      g.globalAlpha = 0.5; g.beginPath();
      g.arc(cx + Math.cos(a) * Math.cos(k * 1.3) * r * 0.78, cy + Math.sin(a * 1.1 + k) * r * 0.7, 2, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1; g.fillStyle = col; g.font = "600 15px monospace"; g.textAlign = "center";
    g.fillText(status, cx, SIZE - 14);
  }
  function ended() { clearInterval(timer); timer = null; on = false; cb(); }
  v.addEventListener("leavepictureinpicture", ended);

  return {
    get supported() { return !!(document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream); },
    get on() { return on; },
    set onchange(f) { cb = f; },
    setStatus(s) { status = s; },
    async start() {
      if (on) return;
      if (!this.supported) throw new Error("এই ব্রাউজারে ভাসমান বৃত্ত (PiP) সাপোর্ট নেই");
      draw(); timer = setInterval(draw, 66);
      if (!v.srcObject) v.srcObject = c.captureStream(15);
      try { await v.play(); await v.requestPictureInPicture(); }
      catch (e) { ended(); throw new Error("ভাসমান বৃত্ত চালু হয়নি। বাটনে সরাসরি ট্যাপ করে আবার চেষ্টা করুন।"); }
      on = true; cb();
    },
    async stop() { if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {}); ended(); }
  };
})();
