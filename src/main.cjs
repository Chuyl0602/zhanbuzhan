const { app, BrowserWindow, Tray, Menu, dialog, clipboard, ClipboardItem, nativeImage, globalShortcut, screen, ipcMain, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store.cjs');

const APP_NAME = '粘不粘';
app.setName(APP_NAME);
// Keep the existing local configuration when upgrading from Zhantie.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const existingUserData = path.join(app.getPath('appData'), 'zhantie');
  fs.mkdirSync(existingUserData, { recursive: true });
  app.setPath('userData', existingUserData);
}
const DEFAULT_SHORTCUTS = { collect: 'Control+Alt+S', toggle: 'Control+Alt+V' };
const MIME_PRIORITY = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
let panel, bubble, tray, store, settings, configFile, quitting = false, hideTimer = null, shortcutCaptureActive = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => showPanel());
function fatal(error) {
  const message = error?.stack || String(error);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'runtime.log'), `${new Date().toISOString()}\n${message}\n`); } catch {}
  dialog.showErrorBox(`${APP_NAME}启动失败`, message);
}
process.on('unhandledRejection', fatal);
process.on('uncaughtException', fatal);

function readConfig() {
  configFile = path.join(app.getPath('userData'), 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return { libraryPath: raw.libraryPath || '', shortcuts: {
      collect: typeof raw.shortcuts?.collect === 'string' ? raw.shortcuts.collect : DEFAULT_SHORTCUTS.collect,
      toggle: typeof raw.shortcuts?.toggle === 'string' ? raw.shortcuts.toggle : DEFAULT_SHORTCUTS.toggle
    }, launchAtLogin: !!raw.launchAtLogin, askedStartup: !!raw.askedStartup,
    bubblePosition: Array.isArray(raw.bubblePosition) && raw.bubblePosition.length === 2 ? raw.bubblePosition : null };
  } catch { return { libraryPath: '', shortcuts: { ...DEFAULT_SHORTCUTS }, launchAtLogin: false, askedStartup: false, bubblePosition: null }; }
}
function writeConfig() {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const tmp = configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, configFile);
}
function emitState() {
  panel?.webContents.send('library-changed');
  bubble?.webContents.send('bubble-state', { open: !!panel?.isVisible(), count: store?.activeCount() || 0 });
}
function notice(message) {
  panel?.webContents.send('toast', message);
  if (!panel?.isVisible() && Notification.isSupported()) new Notification({ title: APP_NAME, body: message }).show();
}
function status() {
  return { ready: !!store, version: app.getVersion(), totalCount: store?.activeCount() || 0, trashCount: store?.trashCount() || 0, libraryPath: settings.libraryPath, shortcuts: settings.shortcuts, launchAtLogin: settings.launchAtLogin,
    askedStartup: settings.askedStartup };
}
async function openLibrary(root) {
  const full = path.resolve(root);
  const next = await Store.open(full);
  if (store) store.close();
  store = next;
  settings.libraryPath = full;
  writeConfig();
  emitState();
  return status();
}
function requireStore() { if (!store) throw new Error('请先选择本机素材库文件夹'); return store; }

function placeNearBubble() {
  const anchor = bubble?.getBounds();
  const cursor = anchor ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint();
  const bounds = screen.getDisplayNearestPoint(cursor).workArea;
  const [w, h] = panel.getSize();
  const right = anchor && anchor.x + anchor.width + w + 12 <= bounds.x + bounds.width;
  const x = anchor ? right ? anchor.x + anchor.width + 12 : anchor.x - w - 12 : cursor.x + 12;
  const y = anchor ? anchor.y + anchor.height / 2 - 48 : cursor.y + 12;
  panel.setPosition(Math.min(Math.max(Math.round(x), bounds.x), bounds.x + bounds.width - w),
    Math.min(Math.max(Math.round(y), bounds.y), bounds.y + bounds.height - h));
  panel.webContents.send('panel-anchor', right ? 'left' : 'right');
}
function showPanel() {
  if (!panel) return;
  clearTimeout(hideTimer); hideTimer = null;
  placeNearBubble(); panel.show(); panel.focus();
  panel.webContents.send('panel-expanded', true);
  bubble?.webContents.send('bubble-state', { open: true, count: store?.activeCount() || 0 });
}
function hidePanel() {
  if (!panel?.isVisible()) return;
  resumeShortcuts();
  panel.webContents.send('panel-expanded', false);
  bubble?.webContents.send('bubble-state', { open: false, count: store?.activeCount() || 0 });
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { panel.hide(); hideTimer = null; }, 200);
}
function togglePanel() { if (hideTimer) showPanel(); else if (panel?.isVisible()) hidePanel(); else showPanel(); }
function moveBubble(x, y) {
  if (!bubble || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const bounds = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const [w, h] = bubble.getSize();
  const next = [Math.max(bounds.x, Math.min(Math.round(x), bounds.x + bounds.width - w)),
    Math.max(bounds.y, Math.min(Math.round(y), bounds.y + bounds.height - h))];
  bubble.setPosition(...next);
  settings.bubblePosition = next;
  if (panel?.isVisible()) placeNearBubble();
}

async function collectClipboard() {
  const lib = requireStore();
  const items = await clipboard.read();
  for (const item of items) {
    const mime = MIME_PRIORITY.find(x => item.types.includes(x));
    if (mime) {
      const blob = await item.getType(mime);
      const added = lib.addImage(Buffer.from(await blob.arrayBuffer()), mime, '剪贴板图片');
      emitState(); notice('图片已收入素材库'); return added;
    }
  }
  for (const item of items) {
    if (item.types.includes('text/uri-list')) {
      const blob = await item.getType('text/uri-list');
      const urls = (await blob.text()).split(/\r?\n/).filter(Boolean);
      let last = null;
      for (const url of urls) {
        try {
          const file = require('node:url').fileURLToPath(url);
          const mime = IMAGE_EXT[path.extname(file).toLowerCase()];
          if (mime && fs.statSync(file).size <= 50 * 1024 * 1024) last = lib.addImage(fs.readFileSync(file), mime, path.basename(file));
        } catch { /* Ignore unavailable or unsupported copied files. */ }
      }
      if (last) { emitState(); notice('图片文件已收入素材库'); return last; }
    }
  }
  const content = await clipboard.readText();
  if (!content.trim()) throw new Error('剪贴板中没有可保存的文字或图片');
  const added = lib.addText(content);
  emitState(); notice('文字已收入素材库'); return added;
}
async function copyItem(id) {
  const lib = requireStore(), item = lib.get(id);
  if (!item || item.deleted_at != null) throw new Error('素材不存在');
  if (item.type === 'text') await clipboard.writeText(item.body);
  else {
    const bytes = fs.readFileSync(lib.imagePath(item));
    const payload = new Blob([bytes], { type: item.mime });
    await clipboard.write([new ClipboardItem({ [item.mime]: payload })]);
  }
  return item;
}
function shortcutCallbacks() {
  return {
    collect: () => collectClipboard().catch(e => notice(e.message)),
    toggle: () => togglePanel()
  };
}
function suspendShortcuts() {
  if (shortcutCaptureActive) return;
  shortcutCaptureActive = true;
  globalShortcut.unregisterAll();
}
function resumeShortcuts() {
  if (!shortcutCaptureActive) return;
  shortcutCaptureActive = false;
  const callbacks = shortcutCallbacks();
  for (const [key, accelerator] of Object.entries(settings.shortcuts)) {
    if (accelerator && !globalShortcut.register(accelerator, callbacks[key])) notice(`${key === 'collect' ? '收集' : '呼出'}快捷键 ${accelerator} 已被占用，请重新设置`);
  }
}
function registerShortcuts(next) {
  const previous = settings.shortcuts;
  shortcutCaptureActive = false;
  globalShortcut.unregisterAll();
  const registered = [];
  const callbacks = shortcutCallbacks();
  try {
    for (const [key, accelerator] of Object.entries(next)) {
      if (!accelerator) continue;
      if (!globalShortcut.register(accelerator, callbacks[key])) throw new Error(`${key === 'collect' ? '收集' : '呼出'}快捷键 ${accelerator} 已被占用或无效`);
      registered.push(accelerator);
    }
    settings.shortcuts = next;
    writeConfig();
  } catch (error) {
    registered.forEach(x => globalShortcut.unregister(x));
    settings.shortcuts = previous;
    for (const [key, accelerator] of Object.entries(previous)) if (accelerator) globalShortcut.register(accelerator, callbacks[key]);
    throw error;
  }
}
function createWindow() {
  panel = new BrowserWindow({ width: 450, height: 690, minWidth: 380, minHeight: 500, frame: false, show: false,
    resizable: true, skipTaskbar: true, alwaysOnTop: true, transparent: true, backgroundColor: '#00000000', webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true
    } });
  panel.loadFile(path.join(__dirname, 'index.html'));
  panel.webContents.on('did-finish-load', () => { if (panel.isVisible()) panel.webContents.send('panel-expanded', true); });
  panel.on('blur', () => resumeShortcuts());
  panel.on('close', event => { if (!quitting) { event.preventDefault(); hidePanel(); } });
}
function createBubble() {
  bubble = new BrowserWindow({ width: 82, height: 82, frame: false, show: false, resizable: false,
    transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const saved = settings.bubblePosition;
  moveBubble(saved ? Number(saved[0]) : bounds.x + bounds.width - 100,
    saved ? Number(saved[1]) : bounds.y + Math.round(bounds.height * .42));
  bubble.loadFile(path.join(__dirname, 'bubble.html'));
  bubble.webContents.on('did-finish-load', () => {
    bubble.show(); bubble.webContents.send('bubble-state', { open: false, count: store?.activeCount() || 0 });
  });
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `打开${APP_NAME}`, click: showPanel },
    { label: '收集当前剪贴板', click: () => collectClipboard().catch(e => notice(e.message)) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showPanel);
}
function handle(name, fn) { ipcMain.handle(name, async (_event, ...args) => fn(...args)); }
function installHandlers() {
  handle('status', () => status());
  handle('choose-library', async () => {
    const result = await dialog.showOpenDialog(panel, { properties: ['openDirectory', 'createDirectory'], title: '选择素材库文件夹' });
    if (result.canceled) return null;
    const root = result.filePaths[0];
    if (settings.libraryPath) throw new Error('请使用设置中的迁移功能更换素材库文件夹');
    return openLibrary(root);
  });
  handle('list', opts => requireStore().list(opts));
  handle('add-text', ({ body, title, tags }) => { const x = requireStore().addText(body, title, tags); emitState(); return x; });
  handle('add-image', ({ bytes, mime, name }) => { const x = requireStore().addImage(bytes, mime, name); emitState(); return x; });
  handle('collect', () => collectClipboard());
  handle('update', (id, patch) => { const x = requireStore().update(id, patch); emitState(); return x; });
  handle('trash', id => { requireStore().trash(id); emitState(); });
  handle('trash-many', ids => { const count = requireStore().trashMany(ids); emitState(); return count; });
  handle('restore', id => { requireStore().restore(id); emitState(); });
  handle('restore-many', ids => { const count = requireStore().restoreMany(ids); emitState(); return count; });
  handle('favorite-many', (ids, value) => { const count = requireStore().favoriteMany(ids, value); emitState(); return count; });
  handle('delete-forever', id => { requireStore().deleteForever(id); emitState(); });
  handle('empty-trash', () => { const count = requireStore().emptyTrash(); emitState(); return count; });
  handle('copy', id => copyItem(id));
  function imageData(id, maxWidth) {
    const item = requireStore().get(id);
    const full = requireStore().imagePath(item, true);
    const image = nativeImage.createFromPath(full);
    if (image.isEmpty()) return `data:${item.mime};base64,${fs.readFileSync(full).toString('base64')}`;
    const sized = image.getSize().width > maxWidth ? image.resize({ width: maxWidth }) : image;
    return `data:image/png;base64,${sized.toPNG().toString('base64')}`;
  }
  handle('thumb', id => imageData(id, 320));
  handle('preview', id => imageData(id, 1200));
  handle('hide', () => hidePanel());
  handle('begin-shortcut-capture', () => suspendShortcuts());
  handle('end-shortcut-capture', () => resumeShortcuts());
  handle('bubble-toggle', () => togglePanel());
  handle('bubble-move', (x, y) => moveBubble(Number(x), Number(y)));
  handle('bubble-save-position', () => { writeConfig(); return settings.bubblePosition; });
  handle('set-shortcuts', value => {
    const next = { collect: String(value.collect), toggle: String(value.toggle) };
    registerShortcuts(next); emitState(); return status();
  });
  handle('set-startup', enabled => {
    settings.askedStartup = true; settings.launchAtLogin = !!enabled;
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!enabled });
    writeConfig(); emitState(); return status();
  });
  handle('migrate', async () => {
    const old = requireStore();
    const result = await dialog.showOpenDialog(panel, { properties: ['openDirectory', 'createDirectory'], title: '选择新的空文件夹' });
    if (result.canceled) return null;
    const target = path.resolve(result.filePaths[0]);
    if (target.toLowerCase() === old.root.toLowerCase()) return status();
    const relative = path.relative(old.root, target);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('新位置不能位于当前素材库内部');
    if (fs.readdirSync(target).length) throw new Error('新位置必须是空文件夹');
    old.purgeOld();
    const sourceItems = old.all();
    old.save();
    fs.cpSync(path.join(old.root, 'library.sqlite'), path.join(target, 'library.sqlite'));
    fs.cpSync(path.join(old.root, 'images'), path.join(target, 'images'), { recursive: true });
    let verify;
    try {
      const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (digest(path.join(target, 'library.sqlite')) !== digest(path.join(old.root, 'library.sqlite')) ||
        sourceItems.some(x => x.filename && (!fs.existsSync(path.join(target, 'images', x.filename)) || digest(path.join(target, 'images', x.filename)) !== digest(path.join(old.root, 'images', x.filename)))))
        throw new Error('迁移校验失败，原素材库仍然可用');
      verify = await Store.open(target);
      const destinationItems = verify.all();
      if (destinationItems.length !== sourceItems.length)
        throw new Error('迁移校验失败，原素材库仍然可用');
      verify.close();
      return await openLibrary(target);
    } catch (error) { verify?.close(); throw error; }
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  settings = readConfig();
  if (settings.libraryPath) {
    try {
      if (!fs.existsSync(path.join(settings.libraryPath, 'library.sqlite'))) throw new Error('找不到原素材库数据库');
      store = await Store.open(settings.libraryPath);
    }
    catch (error) { settings.libraryPath = ''; writeConfig(); dialog.showErrorBox('素材库打开失败', `${error.message}\n请重新选择素材库文件夹。`); }
  }
  createWindow(); createBubble(); createTray(); installHandlers();
  try { registerShortcuts(settings.shortcuts); } catch (error) { notice(error.message); }
  setInterval(() => { if (store?.purgeOld()) emitState(); }, 24 * 60 * 60 * 1000).unref();
}).catch(fatal);
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); store?.close(); });
app.on('window-all-closed', () => { /* Keep running in the tray. */ });
