import { useEffect, useState } from "react";
import { toast } from "sonner";

const LS = "oiPwaNotifHint";

function isStandalone() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

/** After Add to Home Screen, ask once to enable desk notifications. */
export default function PwaNotifyPrompt() {
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || asked) return undefined;
    if (!isStandalone()) return undefined;
    try {
      if (localStorage.getItem(LS) === "1") return undefined;
    } catch { /* noop */ }
    if (typeof Notification === "undefined") return undefined;
    if (Notification.permission === "granted") {
      try { localStorage.setItem(LS, "1"); } catch { /* noop */ }
      return undefined;
    }
    const t = setTimeout(() => {
      toast.message("Turn on notifications for this Home Screen app", {
        description: "Get OI reversal and huge-shift alerts while StrikLenz is on your phone.",
        duration: 16000,
        action: {
          label: "Enable",
          onClick: async () => {
            try {
              const perm = await Notification.requestPermission();
              if (perm === "granted") {
                try { localStorage.setItem("oiDeskNotif", "1"); } catch { /* noop */ }
                toast.success("Notifications on for StrikLenz");
              }
            } catch { /* noop */ }
            try { localStorage.setItem(LS, "1"); } catch { /* noop */ }
          },
        },
        onDismiss: () => { try { localStorage.setItem(LS, "1"); } catch { /* noop */ } },
        onAutoClose: () => { try { localStorage.setItem(LS, "1"); } catch { /* noop */ } },
      });
      setAsked(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [asked]);

  return null;
}
