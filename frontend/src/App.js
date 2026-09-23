import "@/App.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthGate from "@/components/AuthGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import MobileAlertTray from "@/components/MobileAlertTray";
import DesktopAlertInbox from "@/components/DesktopAlertInbox";
import PwaNotifyPrompt from "@/components/PwaNotifyPrompt";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { installDeskErrorLog } from "@/lib/errorLog";
import { api } from "@/lib/api";

const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminSettings = lazy(() => import("@/pages/AdminSettings"));
const KiteCallback = lazy(() => import("@/pages/KiteCallback"));
const AboutAppModal = lazy(() => import("@/components/AboutAppModal"));

function BootFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f9fc]">
      <div className="text-sm text-slate-500">Loading…</div>
    </div>
  );
}

function PublicEntry() {
  const [showLanding, setShowLanding] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadState = useCallback(() => {
    setLoading(true);
    return api.get("/auth/state")
      .then(({ data }) => {
        setShowLanding(!!data?.public_landing_enabled);
        setMaintenanceMode(!!data?.maintenance_mode);
        setIsAdmin(!!data?.is_admin);
      })
      .catch(() => {
        setShowLanding(false);
        setMaintenanceMode(false);
        setIsAdmin(false);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  if (loading) return <BootFallback />;
  if (maintenanceMode && !isAdmin) {
    return <MaintenanceScreen retrying={loading} onRetry={loadState} />;
  }
  return showLanding ? <Landing /> : <AdminLogin />;
}

function App() {
  const isAdminHost =
    window.location.hostname === "admin.striklenz.com";

  useEffect(() => {
    installDeskErrorLog();
  }, []);
  return (
    <div className="App">
      <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<BootFallback />}>
        <Routes>
          {isAdminHost ? (
            <Route path="*" element={<AdminLogin />} />
          ) : (
            <>
              <Route path="/" element={<PublicEntry />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/kite-callback" element={<KiteCallback />} />
              <Route
                path="/dashboard/*"
                element={
                  <AuthGate>
                    <Dashboard />
                  </AuthGate>
                }
              />
              <Route path="/terminal/*" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
      <Suspense fallback={null}>
        <AboutAppModal />
      </Suspense>
      <Toaster />
      <MobileAlertTray />
      <DesktopAlertInbox />
      <PwaNotifyPrompt />
    </div>
  );
}

export default App;
