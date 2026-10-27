// ক্যামেরা: লাইভ প্রিভিউ, ছবি তোলা (ছোট করে JPEG), সামনে/পেছনে বদল
const CAM = (() => {
  let stream = null, facing = "environment";
  const video = () => document.getElementById("cam-video");
  function stop() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
  async function start() {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
    } catch (_) { throw new Error("ক্যামেরা চালু হয়নি। ব্রাউজারে ক্যামেরার অনুমতি দিন।"); }
    const v = video();
    v.srcObject = stream;
    v.style.transform = facing === "user" ? "scaleX(-1)" : "none";
    await v.play().catch(() => {});
  }
  return {
    async open(mode) { if (mode) facing = mode; await start(); },
    async flip() { facing = facing === "user" ? "environment" : "user"; await start(); },
    close: stop,
    snap(max = 1024, q = 0.7) {
      const v = video(), c = document.getElementById("cam-canvas");
      const r = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * r); c.height = Math.round(v.videoHeight * r);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", q);
    }
  };
})();
