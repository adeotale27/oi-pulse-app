export function isPositiveAdrThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export function getAdrPollFeedback(result) {
  if (result?.ok !== true) {
    return {
      tone: "error",
      message: `ADR poll failed: ${result?.reason || "unknown reason"}`,
    };
  }
  if (result.reason === "markets_closed") {
    return { tone: "message", message: "ADR poll skipped: US markets are closed." };
  }
  return {
    tone: "success",
    message: `ADR poll completed: ${Number(result.stored) || 0} stored, ${Number(result.failed) || 0} failed.`,
  };
}
