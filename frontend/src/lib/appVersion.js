/** Display name: repo-root `APP_NAME` (injected at build as REACT_APP_APP_NAME). Version: `VERSION`. */
export const APP_VERSION = "8.10";
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_NAME = (process.env.REACT_APP_APP_NAME || "StrikLenz").trim();
export const ABOUT_EVENT = "oi-open-about";

export function openAboutApp() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ABOUT_EVENT));
}
