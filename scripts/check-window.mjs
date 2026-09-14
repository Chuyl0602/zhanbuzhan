import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 9237);
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find(item => item.type === 'page' && item.title === '粘不粘');
if (!page) throw new Error('应用窗口未出现');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let serial = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  const entry = pending.get(message.id);
  if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
});
function call(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
await call('Runtime.enable');
await call('Page.enable');
await call('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 700));
const result = await call('Runtime.evaluate', { expression: "({title:document.title, api:typeof window.api, scripts:[...document.scripts].map(x=>x.src), onboarding:!document.querySelector('#onboarding').classList.contains('hidden'), workspace:!document.querySelector('#workspace').classList.contains('hidden'), toast:document.querySelector('#toast').textContent, text:document.body.innerText.slice(0,300)})", returnByValue: true });
console.log(JSON.stringify(result.result.value, null, 2));
console.log('exceptions', exceptions);
const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const output = path.resolve('qa-onboarding.png');
fs.writeFileSync(output, Buffer.from(capture.data, 'base64'));
console.log(output);
socket.close();
