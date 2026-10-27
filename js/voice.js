// একবার চালু করলে মাইক চালু থাকে, বন্ধ না করা পর্যন্ত নিজে থেকে আবার শুনতে থাকে।
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const VOICE = (() => {
  let rec = null, active = false, paused = false, onText = () => {}, onState = () => {}, last = "", lastAt = 0;
  function create() {
    const r = new SR();
    r.lang = "bn-BD";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = e => {
      if (paused) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript.trim();
        // কিছু Android ফোনে একই বাক্য দুবার আসে, তাই কাছাকাছি সময়ে একই কথা বাদ
        if (!t || (t === last && Date.now() - lastAt < 2500)) continue;
        last = t; lastAt = Date.now();
        onText(t);
      }
    };
    r.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { active = false; onState("error", "মাইকের অনুমতি দিন"); }
      else if (e.error === "network") { active = false; onState("error", "ভয়েস সার্ভারে সংযোগ হয়নি"); }
    };
    r.onend = () => {
      if (active && !paused) setTimeout(() => { try { r.start(); } catch (_) {} }, 300);
      else if (!active) onState("off");
    };
    return r;
  }
  return {
    start(textCb, stateCb) {
      if (!SR) { stateCb("error", "এই ব্রাউজারে ভয়েস সাপোর্ট নেই। Chrome ব্যবহার করুন।"); return; }
      onText = textCb; onState = stateCb; active = true; paused = false;
      rec = create();
      try { rec.start(); onState("on"); } catch (_) {}
    },
    stop() { active = false; paused = false; if (rec) { try { rec.stop(); } catch (_) {} } onState("off"); },
    pause() { if (!active) return; paused = true; try { rec.stop(); } catch (_) {} },
    resume() { if (!active) return; paused = false; setTimeout(() => { if (active && !paused) { try { rec.start(); } catch (_) {} } }, 400); },
    get active() { return active; }
  };
})();
function stopVoice() { VOICE.stop(); }

// বাংলা ভয়েসে উত্তর পড়ে শোনানো। বলার সময় মাইক থামে, যাতে নিজের গলা নিজে না শোনে।
let speakId = 0;
function speak(text, onEnd) {
  if (!("speechSynthesis" in window)) { if (onEnd) onEnd(); return; }
  const my = ++speakId;
  speechSynthesis.cancel();
  VOICE.pause();
  const clean = text.replace(/```[\s\S]*?```/g, " কোড ব্লক ").replace(/[*#`_]/g, "");
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "bn-BD";
  const voices = speechSynthesis.getVoices();
  const bn = voices.find(x => /^bn[-_]BD/i.test(x.lang)) || voices.find(x => /^bn/i.test(x.lang));
  if (bn) u.voice = bn;
  u.pitch = 1.1;
  u.onend = u.onerror = () => { if (my !== speakId) return; VOICE.resume(); if (onEnd) onEnd(); };
  speechSynthesis.speak(u);
}
function stopSpeaking() { if ("speechSynthesis" in window) speechSynthesis.cancel(); }
