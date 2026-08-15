/** Keep in lockstep with repo-root VERSION and backend/app_version.py */
export const APP_VERSION = "6.19";
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_NAME = "OI Pulse";
export const ABOUT_EVENT = "oi-open-about";

export function openAboutApp() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ABOUT_EVENT));
}
