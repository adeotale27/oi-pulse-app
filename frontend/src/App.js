import "@/App.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AuthGate from "@/components/AuthGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import MobileAlertTray from "@/components/MobileAlertTray";
import DesktopAlertInbox from "@/components/DesktopAlertInbox";
import PwaNotifyPrompt from "@/components/PwaNotifyPrompt";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import DataLoadingState from "@/components/DataLoadingState";
import { installDeskErrorLog } from "@/lib/errorLog";
import { api } from "@/lib/api";
import { isSiteWalkthroughPath } from "@/lib/siteWalkthroughApi";

const Landing = lazy(() => import("@/pages/Landing"));
const SiteWalkthrough = lazy(() => import("@/pages/SiteWalkthrough"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminSettings = lazy(() => import("@/pages/AdminSettings"));
const KiteCallback = lazy(() => import("@/pages/KiteCallback"));
const AboutAppModal = lazy(() => import("@/components/AboutAppModal"));

function BootFallback() {
  return <DataLoadingState />;
}

function PublicEntry() {
  const [showLanding, setShowLanding] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [walkthroughEnabled, setWalkthroughEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadState = useCallback(() => {
    setLoading(true);
    return api.get("/auth/state")
      .then(({ data }) => {
        setShowLanding(!!data?.public_landing_enabled);
        setMaintenanceMode(!!data?.maintenance_mode);
        setIsAdmin(!!data?.is_admin);
        setWalkthroughEnabled(data?.sitewalkthrough_enabled !== false);
      })
      .catch(() => {
        setShowLanding(false);
        setMaintenanceMode(false);
        setIsAdmin(false);
        setWalkthroughEnabled(false);
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
  return showLanding ? <Landing walkthroughEnabled={walkthroughEnabled} /> : <AdminLogin />;
}

function AppRoutes({ isAdminHost }) {
  const location = useLocation();
  const isWalkthrough = isSiteWalkthroughPath();

  useEffect(() => {
    if (!isWalkthrough) installDeskErrorLog();
  }, [isWalkthrough]);

  return (
    <>
      <Suspense fallback={<BootFallback />}>
        <Routes>
          {isAdminHost ? (
            <>
              <Route path="/sitewalkthrough" element={<SiteWalkthrough />} />
              <Route path="/" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route
                path="/dashboard/*"
                element={
                  <AuthGate>
                    <Dashboard />
                  </AuthGate>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/sitewalkthrough" element={<SiteWalkthrough />} />
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
      {!isWalkthrough ? (
        <>
          <Suspense fallback={null}>
            <AboutAppModal />
          </Suspense>
          <Toaster />
          <MobileAlertTray />
          <DesktopAlertInbox />
          <PwaNotifyPrompt />
        </>
      ) : null}
    </>
  );
}

function App() {
  const isAdminHost =
    window.location.hostname === "admin.striklenz.com";

  return (
    <div className="App">
      <ErrorBoundary>
        <BrowserRouter>
          <AppRoutes isAdminHost={isAdminHost} />
        </BrowserRouter>
      </ErrorBoundary>
    </div>
  );
}

export default App;
