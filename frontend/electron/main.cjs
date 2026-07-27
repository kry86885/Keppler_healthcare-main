const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    return;
  }

  const argPort = process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1];
  const argUrl = process.argv.find((arg) => arg.startsWith("--url="))?.split("=")[1];
  const devServerUrl = argUrl || (argPort ? `http://localhost:${argPort}` : null) || process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
  mainWindow.loadURL(devServerUrl);
  mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
