// Lightweight reconnection wrapper for Straddle WebSocket
export function connectStraddleWS(index, opts = {}, onMessage, onOpen, onClose) {
  let urlOrigin = "";
  try {
    // Try to use REACT_APP_BACKEND_URL environment variable first
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    if (backendUrl) {
      urlOrigin = backendUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    } else {
      const o = window.location.origin;
      if (o.startsWith("https://")) urlOrigin = o.replace(/^https:/, "wss:");
      else urlOrigin = o.replace(/^http:/, "ws:");
    }
  } catch {
    urlOrigin = "ws://localhost:8000";
  }
  const params = new URLSearchParams();
  if (opts.expiry) params.set("expiry", opts.expiry);
  if (opts.position) params.set("position", opts.position);
  if (opts.qty) params.set("qty", String(opts.qty));
  // include admin token from localStorage if available
  try {
    const tok = localStorage.getItem("oi_admin_token");
    if (tok) params.set("admin_token", tok);
  } catch (_) {}

  const wsUrl = `${urlOrigin}/api/ws/straddle/${encodeURIComponent(index)}?${params.toString()}`;
  console.log("[Straddle WS] Connecting to:", wsUrl); // Debug log

  let ws = null;
  let stopped = false;
  let backoff = 1000;

  function start() {
    stopped = false;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log("[Straddle WS] Connected");
        backoff = 1000;
        if (onOpen) onOpen();
      };
      ws.onmessage = (ev) => {
        try { const d = JSON.parse(ev.data); if (onMessage) onMessage(d); } catch (e) { console.error("[Straddle WS] Parse error:", e); }
      };
      ws.onclose = () => {
        console.log("[Straddle WS] Closed, reconnecting in", backoff, "ms");
        if (onClose) onClose();
        if (stopped) return;
        setTimeout(() => { backoff = Math.min(30000, backoff * 1.5); start(); }, backoff);
      };
      ws.onerror = (err) => { 
        console.error("[Straddle WS] Error:", err);
        try { ws && ws.close(); } catch (_) {} 
      };
    } catch (e) {
      console.error("[Straddle WS] Failed to create WebSocket:", e);
      if (!stopped) {
        setTimeout(() => { backoff = Math.min(30000, backoff * 1.5); start(); }, backoff);
      }
    }
  }

  function stop() { stopped = true; try { ws && ws.close(); } catch (_) {} }
  start();
  return { stop };
}
