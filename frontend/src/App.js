import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AuthGate from "@/components/AuthGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import PwaNotifyPrompt from "@/components/PwaNotifyPrompt";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const KiteCallback = lazy(() => import("@/pages/KiteCallback"));
const AboutAppModal = lazy(() => import("@/components/AboutAppModal"));

function BootFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--oi-shell,#f3f8fb)]">
      <div className="text-sm text-slate-500">Loading desk…</div>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<BootFallback />}>
        <Routes>
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/kite-callback" element={<KiteCallback />} />
          <Route
            path="/*"
            element={
              <AuthGate>
                <Dashboard />
              </AuthGate>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
      <Suspense fallback={null}>
        <AboutAppModal />
      </Suspense>
      <Toaster />
      <PwaNotifyPrompt />
    </div>
  );
}

export default App;
