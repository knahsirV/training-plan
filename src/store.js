// Remembers the active tab and which cards are open. Every access is guarded:
// private mode throws on localStorage rather than returning null.
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('tp.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('tp.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
};
