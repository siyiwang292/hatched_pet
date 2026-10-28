const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hatchedPet", {
  getDesktopState: () => ipcRenderer.invoke("desktop:get-state"),
  openApp: (appId) => ipcRenderer.invoke("desktop:open-app", appId),
  moveTo: (x, y) => ipcRenderer.send("desktop:move-to", { x, y }),
  setClickThrough: (enabled) => ipcRenderer.send("desktop:set-click-through", enabled),
  setRoaming: (enabled) => ipcRenderer.send("desktop:set-roaming", enabled),
  hide: () => ipcRenderer.send("desktop:hide"),
  quit: () => ipcRenderer.send("desktop:quit"),
  onRoamingChanged: (callback) => {
    const listener = (_event, enabled) => callback(enabled);
    ipcRenderer.on("pet:set-roaming", listener);
    return () => ipcRenderer.removeListener("pet:set-roaming", listener);
  },
  onPetAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("pet:action", listener);
    return () => ipcRenderer.removeListener("pet:action", listener);
  },
  onCalendarReminder: (callback) => {
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on("pet:calendar-reminder", listener);
    return () => ipcRenderer.removeListener("pet:calendar-reminder", listener);
  },
});
