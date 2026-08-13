/** Resolve the day document for a journal save click.

React passes the click event as the first argument when `onClick={save}`.
That event is truthy, so treating it as an override would skip the PUT
(`event.date` is undefined). Only a real YYYY-MM-DD day doc is an override.
*/
export function resolveJournalSaveDoc(override, current) {
  if (override && typeof override === "object" && typeof override.date === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(override.date)) return override;
  }
  return current && typeof current === "object" ? current : null;
}

export function journalSavePayload(doc) {
  if (!doc?.date || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) return null;
  return {
    day: doc.date,
    body: {
      went_well: doc.went_well ?? "",
      went_wrong: doc.went_wrong ?? "",
      notes: doc.notes ?? "",
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      rating: doc.rating ?? null,
      followed_plan: doc.followed_plan ?? null,
    },
  };
}
