// সার্ভিস ওয়ার্কার: Android-এ নোটিফিকেশন দেখানোর জন্য দরকার (কিছু ক্যাশ করে না)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => (cs.length ? cs[0].focus() : self.clients.openWindow("./"))));
});
