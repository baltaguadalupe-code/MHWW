// Guía del Cazador — app de escritorio para Windows 11 (Electron)
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function crearVentana() {
  const ventana = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: "Guía del Cazador",
    backgroundColor: "#14110e",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });

  // Los enlaces a videos y guías se abren en el navegador del sistema
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  ventana.loadFile(path.join(__dirname, "www", "index.html"));
}

app.whenReady().then(crearVentana);
app.on("window-all-closed", () => app.quit());
