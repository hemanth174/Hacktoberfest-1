const backend = document.getElementById("backendUrl");
const autoScan = document.getElementById("autoScan");
const saved = document.getElementById("saved");

chrome.storage.sync.get({ backendUrl: "http://localhost:8000", autoScan: true }, (settings) => {
  backend.value = settings.backendUrl;
  autoScan.checked = settings.autoScan;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.sync.set({ backendUrl: backend.value.trim() || "http://localhost:8000", autoScan: autoScan.checked }, () => {
    saved.textContent = "Saved";
    setTimeout(() => { saved.textContent = ""; }, 1600);
  });
});
