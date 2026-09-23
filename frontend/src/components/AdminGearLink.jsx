import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Settings } from "lucide-react";

/**
 * Small admin-only entry point to /admin/settings. Renders only inside the
 * terminal for a signed-in admin. Non-admins never see it.
 */
export default function AdminGearLink() {
  const loc = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    try {
      setIsAdmin(!!sessionStorage.getItem("oi_admin_token"));
    } catch (_) {
      setIsAdmin(false);
    }
  }, [loc.pathname]);

  if (!isAdmin) return null;
  if (!loc.pathname.startsWith("/terminal")) return null;

  return (
    <Link
      to="/admin/settings"
      title="Platform Settings"
      className="fixed bottom-4 left-4 z-[60] inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white/95 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-lg shadow-emerald-500/10 backdrop-blur transition hover:border-emerald-500 hover:text-emerald-700"
    >
      <Settings className="h-4 w-4 text-emerald-600" />
      Platform Settings
    </Link>
  );
}
