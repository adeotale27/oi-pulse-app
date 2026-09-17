/** SVG listing flags — emoji regional indicators render as “US” / “DE” on many fonts. */

export default function ListingFlag({ country = "US", title, className = "" }) {
  const code = String(country || "US").toUpperCase();
  const label = title || (code === "DE" ? "Germany" : code === "GB" ? "United Kingdom" : "United States");
  const box = `inline-block w-[1.15rem] h-[0.85rem] shrink-0 rounded-[2px] overflow-hidden align-middle shadow-[0_0_0_1px_rgba(15,23,42,0.12)] ${className}`;
  if (code === "DE") {
    return (
      <svg viewBox="0 0 5 3" className={box} role="img" aria-label={label}>
        <title>{label}</title>
        <rect width="5" height="1" y="0" fill="#000" />
        <rect width="5" height="1" y="1" fill="#D00" />
        <rect width="5" height="1" y="2" fill="#FFCE00" />
      </svg>
    );
  }
  if (code === "GB") {
    return (
      <svg viewBox="0 0 60 30" className={box} role="img" aria-label={label}>
        <title>{label}</title>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 19 10" className={box} role="img" aria-label={label}>
      <title>{label}</title>
      <rect width="19" height="10" fill="#BF0A30" />
      <rect y="0.77" width="19" height="0.77" fill="#fff" />
      <rect y="2.31" width="19" height="0.77" fill="#fff" />
      <rect y="3.85" width="19" height="0.77" fill="#fff" />
      <rect y="5.38" width="19" height="0.77" fill="#fff" />
      <rect y="6.92" width="19" height="0.77" fill="#fff" />
      <rect y="8.46" width="19" height="0.77" fill="#fff" />
      <rect width="7.6" height="5.38" fill="#002868" />
    </svg>
  );
}
