import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthGate from "@/components/AuthGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import MobileAlertTray from "@/components/MobileAlertTray";
import DesktopAlertInbox from "@/components/DesktopAlertInbox";
import PwaNotifyPrompt from "@/components/PwaNotifyPrompt";
import { installDeskErrorLog } from "@/lib/errorLog";

const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const KiteCallback = lazy(() => import("@/pages/KiteCallback"));
const AboutAppModal = lazy(() => import("@/components/AboutAppModal"));

function BootFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f9fc]">
      <div className="text-sm text-slate-500">Loading…</div>
    </div>
  );
}

function App() {
  useEffect(() => {
    installDeskErrorLog();
  }, []);
  return (
    <div className="App">
      <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<BootFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/kite-callback" element={<KiteCallback />} />
          <Route
            path="/terminal/*"
            element={
              <AuthGate>
                <Dashboard />
              </AuthGate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
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
