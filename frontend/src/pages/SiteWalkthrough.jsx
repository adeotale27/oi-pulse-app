import { useEffect, useState } from "react";
import Dashboard from "@/pages/Dashboard";
import DataLoadingState from "@/components/DataLoadingState";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { api } from "@/lib/api";

export default function SiteWalkthrough() {
  const [state, setState] = useState({ loading: true, enabled: false, error: "" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let checking = false;
    const checkAvailability = async (showLoading = false) => {
      if (checking) return;
      checking = true;
      if (showLoading) setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const { data } = await api.get("/auth/state", {
          skipSiteWalkthroughMock: true,
          params: { _: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        if (active) setState({
          loading: false,
          enabled: data?.sitewalkthrough_enabled === true && data?.maintenance_mode !== true,
          error: "",
        });
      } catch {
        if (active) setState({
          loading: false,
          enabled: false,
          error: "We could not check walkthrough availability. Please check with the StrikLenz administrator for updates.",
        });
      } finally {
        checking = false;
      }
    };
    checkAvailability(true);
    const interval = window.setInterval(() => checkAvailability(), 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkAvailability();
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [retryCount]);

  if (state.loading) return <DataLoadingState />;
  if (state.enabled) return <Dashboard demoMode />;

  return (
    <MaintenanceScreen
      walkthroughUnavailable
      notice={state.error || "StrikLenz is under maintenance. Please check with the administrator for updates."}
      onRetry={() => {
        setState((current) => ({ ...current, loading: true }));
        setRetryCount((count) => count + 1);
      }}
      retrying={state.loading}
    />
  );
}
