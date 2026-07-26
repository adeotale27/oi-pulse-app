// Lightweight reconnection wrapper for live spot price WebSocket
export function connectSpotWS(onMessage, onOpen, onClose) {
  let urlOrigin = "";
  try {
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    if (backendUrl) {
      urlOrigin = backendUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    } else {
      const o = window.location.origin;
      urlOrigin = o.startsWith("https://") ? o.replace(/^https:/, "wss:") : o.replace(/^http:/, "ws:");
    }
  } catch {
    urlOrigin = "ws://localhost:8000";
  }

  const wsUrl = `${urlOrigin}/api/ws/spot`;
  let ws = null;
  let stopped = false;
  let backoff = 1000;

  function start() {
    stopped = false;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        backoff = 1000;
        if (onOpen) onOpen();
      };
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (onMessage) onMessage(d);
        } catch (e) {
          console.error("[Spot WS] Parse error:", e);
        }
      };
      ws.onclose = () => {
        if (onClose) onClose();
        if (stopped) return;
        setTimeout(() => {
          backoff = Math.min(30000, backoff * 1.5);
          start();
        }, backoff);
      };
      ws.onerror = (err) => {
        console.error("[Spot WS] Error:", err);
        try {
          ws && ws.close();
        } catch (_e) {}
      };
    } catch (e) {
      console.error("[Spot WS] Failed to create WebSocket:", e);
      if (!stopped) {
        setTimeout(() => {
          backoff = Math.min(30000, backoff * 1.5);
          start();
        }, backoff);
      }
    }
  }

  function stop() {
    stopped = true;
    try {
      ws && ws.close();
    } catch (_e) {}
  }

  start();
  return { stop };
}
