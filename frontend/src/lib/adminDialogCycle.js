export const ADMIN_DIALOGS = [
  { id: "upload", label: "Upload" },
  { id: "telegram", label: "Telegram preferences" },
  { id: "journal", label: "Trade journal" },
  { id: "error-log", label: "Error log" },
  { id: "api-configuration", label: "API configuration" },
  { id: "admin-configs", label: "Admin configuration" },
  { id: "index-management", label: "Index management" },
  { id: "desk-ai-keys", label: "Desk AI keys" },
  { id: "market-intel", label: "Market Intel settings" },
  { id: "global-markets", label: "Global Markets" },
  { id: "access-control", label: "Access Control" },
  { id: "change-password", label: "Change password" },
];

export function getNextAdminDialog(currentId, direction) {
  const currentIndex = ADMIN_DIALOGS.findIndex(({ id }) => id === currentId);
  if (currentIndex < 0) return null;
  const step = direction < 0 ? -1 : 1;
  const nextIndex = (currentIndex + step + ADMIN_DIALOGS.length) % ADMIN_DIALOGS.length;
  return ADMIN_DIALOGS[nextIndex].id;
}

export function getAdminDialogKeyDirection(event) {
  if (
    !event
    || event.defaultPrevented
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
  ) {
    return null;
  }

  const target = event.target;
  if (
    target?.isContentEditable
    || target?.closest?.(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='slider'], [role='spinbutton'], [role='tree'], [role='grid'], [role='menu'], [role='tablist']",
    )
  ) {
    return null;
  }

  return event.key === "ArrowLeft" ? -1 : 1;
}
