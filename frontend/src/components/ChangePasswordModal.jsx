import { useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function ChangePasswordModal({ open, onOpenChange }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setOldPw(""); setNewPw(""); setNewPw2(""); };

  const submit = async (e) => {
    e?.preventDefault();
    if (newPw !== newPw2) return toast.error("New passwords do not match.");
    if (newPw.length < 8)   return toast.error("New password must be at least 8 characters.");
    if (!oldPw)             return toast.error("Enter your current password.");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { old_password: oldPw, new_password: newPw });
      toast.success("Password changed. Other devices signed out.");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Change failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent data-testid="change-password-modal" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Change Password
          </DialogTitle>
          <DialogDescription>
            Your Login ID stays as <b>Adeotale</b>. Only the password changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-1">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Current Password</Label>
            <Input
              data-testid="cp-old"
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">New Password</Label>
            <Input
              data-testid="cp-new"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              placeholder="min 8 chars"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Confirm New Password</Label>
            <Input
              data-testid="cp-new2"
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm p-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
            Changing the password will sign out any other devices currently logged in as admin.
          </div>
          <Button
            data-testid="cp-submit"
            type="submit"
            disabled={busy}
            className="w-full rounded-sm bg-slate-900 hover:bg-slate-800"
          >
            {busy ? "Saving…" : "Change password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
