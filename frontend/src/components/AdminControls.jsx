import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Users, LogOut, KeyRound, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import GuestDirectoryModal from "@/components/GuestDirectoryModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";

/**
 * AdminControls — compact widget shown in the header (admin only).
 *  - Public Access toggle (auto-off at 3:30 PM IST server-side)
 *  - Admin menu: Guest Directory, Change Password, Sign out
 *  - Auto logout after 420 minutes (also disables public access)
 */
export default function AdminControls() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/state");
      setState(data);
    } catch (_) {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Auto logout after 420 minutes
  useEffect(() => {
    if (!state?.is_admin) return;

    const logoutTimer = setTimeout(async () => {
      try {
        // Disable public access first
        await api.post("/auth/public-access", { open: false });
      } catch (_) {
        // ignore
      }

      try {
        await api.post("/auth/logout");
      } catch (_) {
        // ignore
      }

      localStorage.removeItem("oi_admin_token");
      toast.info("Admin session expired. Public access disabled.");
      window.location.reload();
    }, 420 * 60 * 1000); // 420 minutes

    return () => clearTimeout(logoutTimer);
  }, [state?.is_admin]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;

    const onDoc = (e) => {
      if (!e.target.closest?.("[data-admin-menu]")) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (!state?.is_admin) return null;

  const togglePublic = async () => {
    setBusy(true);

    try {
      const { data } = await api.post("/auth/public-access", {
        open: !state.public_access_open,
      });

      toast.success(
        data.open
          ? "Public access ON — expires at 3:30 PM IST"
          : "Public access OFF"
      );

      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      // Disable public access first
      await api.post("/auth/public-access", { open: false });
    } catch (_) {
      // ignore
    }

    try {
      await api.post("/auth/logout");
    } catch (_) {
      // ignore
    }

    localStorage.removeItem("oi_admin_token");
    toast.success("Signed out. Public access disabled.");
    window.location.reload();
  };

  return (
    <div
      className="flex items-center gap-2 pr-2 mr-1 border-r border-slate-200 dark:border-slate-700"
      data-testid="admin-controls"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <Users className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-slate-500">Public</span>

        <Switch
          data-testid="admin-public-toggle"
          checked={!!state.public_access_open}
          onCheckedChange={togglePublic}
          disabled={busy}
        />
      </div>

      <div className="relative" data-admin-menu>
        <Button
          data-testid="admin-menu-toggle"
          variant="ghost"
          size="sm"
          onClick={() => setMenuOpen((v) => !v)}
          className="h-7 px-2 text-slate-600 hover:text-slate-900"
          title="Admin menu"
        >
          Admin <ChevronDown className="w-3 h-3 ml-1" />
        </Button>

        {menuOpen && (
          <div
            data-testid="admin-menu"
            className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-sm shadow-md z-50 text-sm"
          >
            <button
              data-testid="admin-menu-guests"
              onClick={() => {
                setMenuOpen(false);
                setGuestsOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <Users className="w-3.5 h-3.5" />
              Guest Directory
            </button>

            <button
              data-testid="admin-menu-change-password"
              onClick={() => {
                setMenuOpen(false);
                setPwOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Change Password
            </button>

            <div className="border-t border-slate-100" />

            <button
              data-testid="admin-menu-logout"
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-rose-50 text-rose-700"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>

      <GuestDirectoryModal
        open={guestsOpen}
        onOpenChange={setGuestsOpen}
      />

      <ChangePasswordModal
        open={pwOpen}
        onOpenChange={setPwOpen}
      />
    </div>
  );
}