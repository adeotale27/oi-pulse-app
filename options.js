/* global chrome */

function status(id, ok, text) {
  const el = document.getElementById(id);
  el.className = ok ? "ok" : "err";
  el.textContent = text;
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        resolve(JSON.parse(String(r.result || "")));
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsText(file);
  });
}

async function putAdmin(kind, doc) {
  const s = await chrome.storage.local.get(["adminFiles"]);
  const adminFiles = s.adminFiles || {};
  adminFiles[kind] = doc;
  adminFiles[`${kind}At`] = Date.now();
  await chrome.storage.local.set({ adminFiles });
}

function bindFile(inputId, kind, statusId, validate) {
  document.getElementById(inputId).addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const doc = await readJsonFile(file);
      const err = validate(doc);
      if (err) throw new Error(err);
      await putAdmin(kind, doc);
      status(statusId, true, `Stored ${file.name}`);
      chrome.runtime.sendMessage({ type: "refresh" });
    } catch (e) {
      status(statusId, false, String(e.message || e));
    }
  });
}

bindFile("file-holidays", "holidays", "st-holidays", (d) =>
  Array.isArray(d?.holidays) ? "" : 'Need { "holidays": [ { "date", "name" } ] }',
);
bindFile("file-econ", "econ", "st-econ", (d) =>
  Array.isArray(d?.events) ? "" : 'Need { "events": [ { "date", "name", "impact" } ] }',
);
for (const idx of ["NIFTY", "SENSEX", "BANKNIFTY"]) {
  bindFile(`file-${idx}`, `impact-${idx}`, `st-${idx}`, (d) =>
    Array.isArray(d?.events) ? "" : `Need { "index": "${idx}", "events": [ … ] }`,
  );
}

chrome.storage.local.get(["config"], (s) => {
  document.getElementById("remoteBase").value =
    s.config?.remoteBase || "https://raw.githubusercontent.com/adeotale27/Market_Events/main";
});

document.getElementById("saveRemote").onclick = async () => {
  const remoteBase = document.getElementById("remoteBase").value.trim();
  await chrome.storage.local.set({ config: { remoteBase } });
  status("st-remote", true, "Saved");
  chrome.runtime.sendMessage({ type: "refresh" });
};

document.getElementById("clearAdmin").onclick = async () => {
  await chrome.storage.local.remove("adminFiles");
  status("st-clear", true, "Cleared local uploads");
  chrome.runtime.sendMessage({ type: "refresh" });
};

document.getElementById("refresh").onclick = () => {
  chrome.runtime.sendMessage({ type: "refresh" }, () => status("st-clear", true, "Refresh sent"));
};
