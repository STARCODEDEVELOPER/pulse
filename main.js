const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0b0a0d',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : false,
    icon: process.platform === 'win32' ? path.join(__dirname, 'build', 'pulse.ico') : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Раскомментируй для отладки:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

const LOCAL_AUDIO_EXTENSIONS = new Set(['.mp3','.wav','.m4a','.flac','.ogg','.oga','.aac','.opus','.webm']);
const LOCAL_MUSIC_ROOTS = ['Music', 'Downloads', 'Desktop'];
const LOCAL_SCAN_MAX_DEPTH = 3;

async function scanAudioFolder(root, depth = 0, result = []){
  if(depth > LOCAL_SCAN_MAX_DEPTH || result.length >= 500) return result;
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch { return result; }
  for(const entry of entries){
    if(result.length >= 500) break;
    if(entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
    const fullPath = path.join(root, entry.name);
    if(entry.isDirectory()){
      await scanAudioFolder(fullPath, depth + 1, result);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if(!LOCAL_AUDIO_EXTENSIONS.has(ext)) continue;
    const stat = await fs.stat(fullPath).catch(() => null);
    if(!stat || !stat.isFile()) continue;
    result.push({
      id: `local:${fullPath}`,
      title: path.basename(entry.name, ext),
      artist: 'Локальная музыка',
      album: path.basename(path.dirname(fullPath)),
      duration: 0,
      cover: null,
      preview: pathToFileURL(fullPath).href,
      local: true,
      path: fullPath,
      size: stat.size,
      modified: stat.mtimeMs,
      extension: ext.slice(1).toUpperCase(),
    });
  }
  return result;
}

ipcMain.handle('local-music:scan', async () => {
  const home = app.getPath('home');
  const roots = LOCAL_MUSIC_ROOTS.map(folder => path.join(home, folder));
  const tracks = [];
  for(const root of roots){ await scanAudioFolder(root, 0, tracks); }
  return tracks.sort((a,b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
});

const PULSE_RELEASES_URL = 'https://raw.githubusercontent.com/STARCODEDEVELOPER/pulse/main';
const TRUSTED_RELEASE_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'githubusercontent.com', 'raw.githubusercontent.com']);

function normalizeVersion(value){
  return String(value || '0.0.0').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0).slice(0, 3).concat([0,0,0]).slice(0,3);
}
function isNewerVersion(remote, local){
  const a = normalizeVersion(remote), b = normalizeVersion(local);
  for(let i = 0; i < 3; i++) if(a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function isAllowedReleaseUrl(value){
  try{
    const url = new URL(value);
    return url.protocol === 'https:' && [...TRUSTED_RELEASE_HOSTS].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  }catch{return false;}
}

ipcMain.handle('update:check', async () => {
  if(process.platform !== 'win32') return { supported:false, currentVersion:app.getVersion() };
  try{
    const response = await fetch(`${PULSE_RELEASES_URL}/latest.json?ts=${Date.now()}`, { headers:{ 'Cache-Control':'no-cache' } });
    if(!response.ok) return { supported:true, available:false, currentVersion:app.getVersion(), error:`HTTP ${response.status}` };
    const manifest = await response.json();
    const release = manifest.windows;
    if(!release || !isAllowedReleaseUrl(release.url)) return { supported:true, available:false, currentVersion:app.getVersion(), error:'Некорректный манифест релиза' };
    return {
      supported:true,
      available:isNewerVersion(manifest.version, app.getVersion()),
      currentVersion:app.getVersion(),
      version:String(manifest.version || ''),
      notes:String(manifest.notes || ''),
      url:release.url,
      sha256:release.sha256 || null,
      size:release.size || null,
    };
  }catch(error){
    return { supported:true, available:false, currentVersion:app.getVersion(), error:error.message || 'Не удалось проверить обновления' };
  }
});

ipcMain.handle('update:download', async (_event, payload = {}) => {
  if(process.platform !== 'win32') return { ok:false, error:'Обновления доступны только для Windows-сборки.' };
  const url = payload.url;
  if(!isAllowedReleaseUrl(url)) return { ok:false, error:'Источник обновления не разрешён.' };
  try{
    const response = await fetch(url);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if(payload.sha256){
      const actual = crypto.createHash('sha256').update(buffer).digest('hex');
      if(actual.toLowerCase() !== String(payload.sha256).toLowerCase()) throw new Error('Проверка целостности обновления не прошла.');
    }
    const filePath = path.join(app.getPath('temp'), `Pulse-Setup-${payload.version || 'latest'}.exe`);
    await fs.writeFile(filePath, buffer);
    return { ok:true, filePath };
  }catch(error){
    return { ok:false, error:error.message || 'Не удалось скачать обновление' };
  }
});

ipcMain.handle('update:install', async (_event, filePath) => {
  if(process.platform !== 'win32' || typeof filePath !== 'string') return { ok:false, error:'Установка обновления недоступна.' };
  const expected = path.join(app.getPath('temp'), path.basename(filePath));
  if(path.resolve(filePath) !== path.resolve(expected) || path.extname(filePath).toLowerCase() !== '.exe') return { ok:false, error:'Недопустимый файл установщика.' };
  try{
    const error = await shell.openPath(expected);
    if(error) return { ok:false, error };
    setTimeout(() => app.quit(), 250);
    return { ok:true };
  }catch(error){ return { ok:false, error:error.message || 'Не удалось запустить установщик.' }; }
});

/* =========================================================
   DEEZER API PROXY
   ---------------------------------------------------------
   Deezer отдаёт бесплатные, не требующие ключа JSON-эндпоинты
   (поиск, чарты, артисты, альбомы, плейлисты) и 30-секундные
   mp3-превью треков — этого достаточно, чтобы в приложении
   были настоящие исполнители, включая русских и СНГ.
   Запрос делаем здесь, в главном процессе (Node), а не в
   рендерере — так не упираемся в CORS-политику Deezer и не
   открываем renderer наружу.
   ========================================================= */
const DEEZER_BASE = 'https://api.deezer.com';

ipcMain.handle('deezer:request', async (_event, path) => {
  try {
    const url = DEEZER_BASE + path;
    const res = await fetch(url, { headers: { 'User-Agent': 'Pulse-Desktop/1.0' } });
    if (!res.ok) return { error: true, message: `HTTP ${res.status}` };
    const json = await res.json();
    if (json && json.error) return { error: true, message: json.error.message || 'Deezer API error' };
    return json;
  } catch (err) {
    return { error: true, message: err.message || 'Network error' };
  }
});
