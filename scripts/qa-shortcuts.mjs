// Smoke-check shortcut recording and intentionally blank shortcuts in a running build.
const port = Number(process.argv[2] || 9253);
const verifyRestart = process.argv[3] === 'verify';
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find(item => item.type === 'page' && item.title === '粘不粘');
if (!page) throw new Error('未找到粘不粘操作面板');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let serial = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data), waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
});
function call(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
  return answer.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await call('Runtime.enable');
  if (verifyRestart) {
    const shortcuts = await evaluate(`window.api.status().then(status => status.shortcuts)`);
    console.log(JSON.stringify({ afterRestart: shortcuts }));
    if (shortcuts.collect !== '' || shortcuts.toggle !== '') process.exitCode = 1;
  } else {
    await evaluate(`document.querySelector('#settingsButton').click()`);
    await pause(250);
    await evaluate(`document.querySelector('#shortcut-collect').focus()`);
    await pause(100);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 3 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 3 });
    const recorded = await evaluate(`({ accelerator: document.querySelector('#shortcut-collect').dataset.accelerator, label: document.querySelector('#shortcut-collect').value })`);
    await evaluate(`document.querySelector('#shortcut-toggle').focus()`);
    await pause(80);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const cancelled = await evaluate(`({ accelerator: document.querySelector('#shortcut-toggle').dataset.accelerator, modalOpen: !document.querySelector('#dialogBackdrop').classList.contains('hidden') })`);
    await evaluate(`document.querySelector('[aria-label="清除收集快捷键"]').click(); document.querySelector('[aria-label="清除呼出快捷键"]').click(); document.querySelector('#modalBody .shortcut-grid').scrollIntoView()`);
    await evaluate(`document.querySelector('#saveShortcuts').click()`);
    await pause(200);
    const result = await evaluate(`(async () => ({ shortcuts: (await window.api.status()).shortcuts, fields: [...document.querySelectorAll('.shortcut-input')].map(node => node.value), error: document.querySelector('.settings-group .field-error')?.textContent }))()`);
    console.log(JSON.stringify({ recorded, cancelled, result }, null, 2));
    if (recorded.accelerator !== 'Control+Alt+Z' || !recorded.label.includes('Ctrl') || cancelled.accelerator !== 'Control+Alt+V' || !cancelled.modalOpen || result.shortcuts.collect !== '' || result.shortcuts.toggle !== '' || result.fields.some(value => value !== '未设置') || result.error) process.exitCode = 1;
  }
} finally { socket.close(); }
