import { Component } from "react";
import { APP_NAME } from "@/lib/appVersion";

/** Keep the desk usable if a view throws — avoid a blank white screen. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err) {
    try {
      console.error(`[${APP_NAME}] UI error`, err);
    } catch {
      /* noop */
    }
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div
        className="min-h-[40vh] flex flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="app-error-boundary"
      >
        <div className="text-sm font-semibold text-slate-800">The desk hit a display error.</div>
        <div className="text-[12px] text-slate-500 max-w-md">
          Your session is still here. Reload to continue — OI alerts keep running on the server.
        </div>
        <button
          type="button"
          className="h-9 px-4 rounded-full bg-emerald-600 text-white text-[13px] font-semibold"
          onClick={() => {
            this.setState({ err: null });
            window.location.reload();
          }}
        >
          Reload desk
        </button>
      </div>
    );
  }
}
