import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import AdminLogin from "@/pages/AdminLogin";
import AuthGate from "@/components/AuthGate";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          {/* Dedicated admin login page — bypasses guest flow entirely. */}
          <Route path="/admin" element={<AdminLogin />} />
          {/* Everything else goes through AuthGate + Dashboard. */}
          <Route
            path="/*"
            element={
              <AuthGate>
                <Dashboard />
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

export default App;
