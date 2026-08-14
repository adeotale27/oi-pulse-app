/* global chrome */
chrome.storage.sync.get("pulseApi", (s) => {
  document.getElementById("pulseApi").value = s.pulseApi || "";
});
document.getElementById("save").onclick = async () => {
  const pulseApi = document.getElementById("pulseApi").value.trim().replace(/\/$/, "");
  await chrome.storage.sync.set({ pulseApi });
  if (pulseApi) {
    const origin = new URL(pulseApi).origin + "/*";
    await chrome.permissions.request({ origins: [origin] });
  }
  document.getElementById("ok").textContent = "Saved";
};
