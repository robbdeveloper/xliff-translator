import path from 'node:path';
import type { Server } from 'node:http';

const { app, BrowserWindow } = require('electron') as typeof import('electron');

const DESKTOP_PORT = Number(process.env.PORT ?? 39487);

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let httpServer: { port: number; host: string; server: Server } | null = null;

function getStaticDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web');
  }
  return path.resolve(app.getAppPath(), '../web/dist');
}

async function createWindow(): Promise<void> {
  const { createServerApp, startServer } = await import('@xliff-translator/server/app');

  const staticDir = getStaticDir();
  const expressApp = createServerApp({ staticDir });
  httpServer = await startServer(expressApp, { port: DESKTOP_PORT, host: '127.0.0.1' });

  const url = `http://${httpServer.host}:${httpServer.port}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'XLIFF Translator',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  await mainWindow.loadURL(url);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function shutdownServer(): void {
  if (httpServer) {
    httpServer.server.close();
    httpServer = null;
  }
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error('Failed to start desktop app:', error);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  shutdownServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error('Failed to recreate desktop window:', error);
      app.quit();
    });
  }
});

app.on('before-quit', () => {
  shutdownServer();
});
