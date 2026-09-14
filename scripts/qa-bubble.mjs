// Read-only smoke check for a running 0.2.0 Electron app with remote debugging enabled.
import fs from 'node:fs';

const port = Number(process.argv[2] || 9240);
const expectedVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
function connect(title) {
  const file = title === '粘不粘悬浮图标' ? 'bubble.html' : 'index.html';
  const page = pages.find(item => item.type === 'page' && (item.title === title || item.url.endsWith(`/src/${file}`)));
  if (!page) throw new Error(`缺少窗口：${title}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(), exceptions = [];
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result);
    }
  });
  return {
    socket, exceptions,
    ready: new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }),
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async eval(expression) {
      const value = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
      return value.result.value;
    },
    async shot(file) {
      const result = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    }
  };
}
const bubble = connect('粘不粘悬浮图标'), panel = connect('粘不粘');
await Promise.all([bubble.ready, panel.ready]);
await Promise.all([bubble.call('Runtime.enable'), panel.call('Runtime.enable')]);
async function pointerClick() {
  await bubble.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 41, y: 41, button: 'left', clickCount: 1 });
  await bubble.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 41, y: 41, button: 'left', clickCount: 1 });
}
try {
  if (await bubble.eval(`document.querySelector('#toggle').getAttribute('aria-expanded')`) === 'true') {
    await bubble.eval(`window.api.toggleBubble()`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const initial = await bubble.eval(`({ expanded: document.querySelector('#toggle').getAttribute('aria-expanded'), api: typeof window.api, closedImageLoaded: document.querySelector('.cat.closed')?.naturalWidth > 0, openImageLoaded: document.querySelector('.cat.opened')?.naturalWidth > 0 })`);
  initial.panelVisibility = await panel.eval(`document.visibilityState`);
  await panel.eval(`document.querySelector('#clearSelection')?.click()`);
  await bubble.shot('qa-bubble.png');
  await pointerClick();
  await new Promise(resolve => setTimeout(resolve, 650));
  const opened = await panel.eval(`({ expanded: document.querySelector('#appShell').classList.contains('expanded'), selectionBar: !!document.querySelector('#selectionBar'), queueBar: !!document.querySelector('#queueBar'), selectAll: !!document.querySelector('#selectAll'), trashAction: !!document.querySelector('#emptyTrash') })`);
  const bubbleOpen = await bubble.eval(`document.querySelector('#toggle').getAttribute('aria-expanded')`);
  const mouseOutline = await bubble.eval(`getComputedStyle(document.querySelector('#toggle')).outlineStyle`);
  await bubble.shot('qa-bubble-open.png');
  await panel.shot('qa-panel-02.png');
  const selected = await panel.eval(`(() => {
    if (document.querySelectorAll('.asset-row').length) document.querySelector('#selectAll')?.click();
    else document.querySelector('#selectionBar').classList.remove('hidden');
    return { count: document.querySelector('#selectionCount').textContent, bar: !document.querySelector('#selectionBar').classList.contains('hidden'), selected: document.querySelectorAll('.asset-row.selected').length, emptyLibrary: !document.querySelectorAll('.asset-row').length };
  })()`);
  await panel.shot('qa-selected-02.png');
  await panel.call('Emulation.setDeviceMetricsOverride', { width: 380, height: 500, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 120));
  const narrow = await panel.eval(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, actionsFit: [...document.querySelectorAll('#selectionBar button')].every(button => button.getBoundingClientRect().right <= innerWidth) })`);
  await panel.shot('qa-narrow-02.png');
  await panel.call('Emulation.clearDeviceMetricsOverride');
  await panel.eval(`document.querySelector('#clearSelection')?.click()`);
  await pointerClick();
  await new Promise(resolve => setTimeout(resolve, 650));
  const closed = await panel.eval(`!document.querySelector('#appShell').classList.contains('expanded')`);
  const bubbleClosed = await bubble.eval(`document.querySelector('#toggle').getAttribute('aria-expanded')`);
  const beforeDrag = await bubble.eval(`({ x: screenX, y: screenY })`);
  await bubble.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 41, y: 41, button: 'left', clickCount: 1 });
  await bubble.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 22, y: 44, button: 'left', buttons: 1 });
  await bubble.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 22, y: 44, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterDrag = await bubble.eval(`({ x: screenX, y: screenY })`);
  const dragged = beforeDrag.x !== afterDrag.x || beforeDrag.y !== afterDrag.y;
  await bubble.eval(`window.api.moveBubble(${beforeDrag.x}, ${beforeDrag.y}).then(() => window.api.saveBubblePosition())`);
  await bubble.eval(`document.querySelector('#toggle').blur()`);
  await bubble.call('Page.bringToFront');
  await bubble.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await bubble.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const keyboardFocus = await bubble.eval(`({ active: document.activeElement?.id, outline: getComputedStyle(document.querySelector('#toggle')).outlineStyle })`);
  await bubble.eval(`window.api.toggleBubble()`);
  await new Promise(resolve => setTimeout(resolve, 280));
  await panel.eval(`document.querySelector('#settingsButton').click()`);
  await new Promise(resolve => setTimeout(resolve, 280));
  const branding = await panel.eval(`(async () => { const status = await window.api.status(); return { title: document.title, header: document.querySelector('.brand')?.textContent, version: document.querySelector('.version-badge')?.textContent, collect: status.shortcuts.collect, askedStartup: status.askedStartup }; })()`);
  await panel.shot('qa-settings.png');
  console.log(JSON.stringify({ initial, opened, bubbleOpen, mouseOutline, selected, narrow, closed, bubbleClosed, dragged, keyboardFocus, branding, exceptions: [...bubble.exceptions, ...panel.exceptions] }, null, 2));
  if (initial.expanded !== 'false' || !initial.closedImageLoaded || !initial.openImageLoaded || !opened.expanded || opened.queueBar || !opened.selectionBar || !opened.selectAll || !opened.trashAction || bubbleOpen !== 'true' || mouseOutline !== 'none' || !selected.bar || narrow.overflow || !narrow.actionsFit || !closed || bubbleClosed !== 'false' || !dragged || keyboardFocus.active !== 'toggle' || keyboardFocus.outline !== 'solid' || branding.title !== '粘不粘' || branding.header !== '粘不粘' || branding.version !== `版本 ${expectedVersion}` || bubble.exceptions.length || panel.exceptions.length) process.exitCode = 1;
} finally {
  bubble.socket.close(); panel.socket.close();
}
