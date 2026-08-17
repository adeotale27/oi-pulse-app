/** CE / PE from the book, or from the Kite symbol when the title is truncated. */
export function optionSide(row) {
  const s = String(row?.side || "").toUpperCase();
  if (s === "CE" || s === "PE") return s;
  const blob = `${row?.tradingsymbol || ""} ${row?.display_name || ""}`.toUpperCase().replace(/\s+/g, "");
  if (/(?:^|\d)PE$/.test(blob)) return "PE";
  if (/(?:^|\d)CE$/.test(blob)) return "CE";
  return null;
}
