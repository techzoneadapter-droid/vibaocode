const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibaocodeDesktop", {
  getInfo: () => ipcRenderer.invoke("vibaocode:get-info"),
  update: () => ipcRenderer.invoke("vibaocode:update"),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("vibaocode:update-status", handler);
    return () => ipcRenderer.removeListener("vibaocode:update-status", handler);
  },
});
