export const BOOK_SLOT_KEY = "oiBookVerdictSlot";
export const BOOK_PLACE_KEY = "oiBookVerdictPlace";
export const BOOK_SLOTS = ["top", "after-live", "bottom"];

export function loadBookSlot() {
  try {
    const slot = localStorage.getItem(BOOK_SLOT_KEY);
    if (BOOK_SLOTS.includes(slot)) return slot;
    return localStorage.getItem(BOOK_PLACE_KEY) === "below" ? "bottom" : "top";
  } catch {
    return "top";
  }
}

export function saveBookSlot(slot) {
  const next = BOOK_SLOTS.includes(slot) ? slot : "top";
  try {
    localStorage.setItem(BOOK_SLOT_KEY, next);
    localStorage.setItem(BOOK_PLACE_KEY, next === "bottom" ? "below" : "above");
  } catch {
    /* noop */
  }
  return next;
}
