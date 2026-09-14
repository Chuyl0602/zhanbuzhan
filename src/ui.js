const bridge = window.api;
const $ = selector => document.querySelector(selector);
const state = {
  tab: 'all', query: '', records: [], selected: [], status: null,
  thumbs: new Map(), visibleCount: 40, refreshToken: 0, menu: null,
  returnFocus: null, toastTimer: null
};
const labels = { all: '全部素材', text: '文字素材', image: '图片素材', favorite: '常用素材', trash: '回收站' };
let fieldNumber = 0;
let stopShortcutRecording = null;

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.setAttribute('aria-hidden', 'true'); svg.append(use);
  return svg;
}
function toast(message, actionLabel, action) {
  const node = $('#toast'); node.replaceChildren(el('span', '', String(message)));
  if (actionLabel && action) {
    const button = el('button', '', actionLabel);
    button.addEventListener('click', async () => { await run(action); node.classList.add('hidden'); });
    node.append(button);
  }
  node.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.add('hidden'), action ? 6500 : 4500);
}
async function run(action) {
  try { return await action(); }
  catch (error) { toast(error?.message || String(error)); return null; }
}
function dateLabel(time) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(time)); }
function closeMenu() {
  if (!state.menu) return;
  state.menu.button.setAttribute('aria-expanded', 'false');
  state.menu.node.remove(); state.menu = null;
}
function closeModal() {
  stopShortcutRecording?.(); stopShortcutRecording = null;
  $('#dialogBackdrop').classList.add('hidden');
  $('#modalBody').replaceChildren();
  state.returnFocus?.focus?.(); state.returnFocus = null;
}
function openModal(title, content, focusTarget) {
  closeMenu(); state.returnFocus = document.activeElement;
  $('#modalTitle').textContent = title;
  $('#modalBody').replaceChildren(content);
  $('#dialogBackdrop').classList.remove('hidden');
  setTimeout(() => (focusTarget || $('#modalBody').querySelector('input,textarea,button') || $('#closeModal')).focus(), 0);
}
function field(label, value = '', multi = false, placeholder = '') {
  const wrap = el('div', 'field'), control = document.createElement(multi ? 'textarea' : 'input');
  const name = `field-${++fieldNumber}`, labelNode = el('label', '', label), error = el('span', 'field-error');
  labelNode.htmlFor = name; control.id = name; control.name = name; control.autocomplete = 'off';
  control.value = value; control.placeholder = placeholder;
  control.addEventListener('input', () => { error.textContent = ''; control.removeAttribute('aria-invalid'); });
  wrap.append(labelNode, control, error);
  return { wrap, control, error };
}
function inlineError(field, message) {
  field.error.textContent = message; field.control.setAttribute('aria-invalid', 'true'); field.control.focus();
}
function actions(cancel, save, saveLabel = '保存') {
  const row = el('div', 'modal-actions'), cancelButton = el('button', 'plain-button', '取消');
  const saveButton = el('button', 'primary-button', saveLabel);
  cancelButton.addEventListener('click', cancel);
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try { await save(); } finally { saveButton.disabled = false; }
  });
  row.append(cancelButton, saveButton); return row;
}
function iconButton(name, label, action, className = '') {
  const button = el('button', className); button.type = 'button'; button.title = label;
  button.setAttribute('aria-label', label); button.append(icon(name));
  button.addEventListener('click', event => { event.stopPropagation(); run(action); });
  return button;
}

async function refresh() {
  const token = ++state.refreshToken;
  const current = await bridge.status();
  if (token !== state.refreshToken) return;
  state.status = current;
  $('#onboarding').classList.toggle('hidden', current.ready);
  $('#workspace').classList.toggle('hidden', !current.ready);
  if (!current.ready) return;
  const records = await bridge.list({ tab: state.tab === 'trash' ? 'all' : state.tab, query: state.query, trash: state.tab === 'trash' });
  if (token !== state.refreshToken) return;
  state.records = records;
  if (state.tab === 'all' && !state.query) state.selected = state.selected.filter(id => records.some(item => item.id === id));
  $('#headCount').textContent = `${current.totalCount ?? records.length} 条已保存`;
  render();
}
function toggleSelected(item, checkbox, row) {
  if (checkbox.checked) {
    if (!state.selected.includes(item.id)) state.selected.push(item.id);
  } else state.selected = state.selected.filter(id => id !== item.id);
  row.classList.toggle('selected', checkbox.checked); renderSelection();
}
function thumbFor(item, img) {
  if (state.thumbs.has(item.id)) { img.src = state.thumbs.get(item.id); return; }
  bridge.thumb(item.id).then(url => {
    state.thumbs.set(item.id, url);
    if (img.isConnected) img.src = url;
  }).catch(() => { img.alt = '图片预览暂不可用'; });
}
function menuItem(name, label, action, dangerous = false) {
  const button = el('button', dangerous ? 'danger' : '', label);
  button.prepend(icon(name));
  button.addEventListener('click', event => { event.stopPropagation(); const trigger = state.menu?.button; closeMenu(); trigger?.focus(); run(action); });
  return button;
}
function openMenu(button, item) {
  if (state.menu?.button === button) { closeMenu(); return; }
  closeMenu();
  const menu = el('div', 'more-menu');
  menu.append(menuItem('pin', item.pinned ? '取消置顶' : '置顶', () => bridge.update(item.id, { pinned: !item.pinned })));
  menu.append(menuItem('text', '编辑信息', () => editItem(item)));
  menu.append(menuItem('trash', '移到回收站', async () => {
    state.selected = state.selected.filter(id => id !== item.id);
    await bridge.trash(item.id);
    await refresh();
    toast('已移到回收站', '撤销', () => bridge.restore(item.id));
  }, true));
  document.body.append(menu);
  const rect = button.getBoundingClientRect(), width = 128, height = 110;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.style.top = `${rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`;
  state.menu = { node: menu, button }; button.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
}
function viewImage(item) {
  const content = el('div');
  const image = el('img', 'preview-image'); image.alt = item.title;
  if (state.thumbs.has(item.id)) image.src = state.thumbs.get(item.id);
  bridge.preview(item.id).then(url => { if (image.isConnected) image.src = url; }).catch(() => {
    if (!image.src) image.alt = '图片预览暂不可用';
  });
  content.append(image);
  const row = el('div', 'modal-actions');
  const close = el('button', 'plain-button', '关闭'); close.addEventListener('click', closeModal);
  const copy = el('button', 'primary-button', '复制图片');
  copy.addEventListener('click', () => run(async () => { await bridge.copy(item.id); toast('图片已复制，可按 Ctrl+V 粘贴'); closeModal(); }));
  row.append(close); if (state.tab !== 'trash') row.append(copy); content.append(row);
  openModal(item.title, content, close);
}
function renderCard(item) {
  const row = el('article', `asset-row ${item.type} ${state.tab === 'trash' ? 'trashed' : ''}`);
  if (state.selected.includes(item.id)) row.classList.add('selected');
  const selectCell = el('div', 'select-cell');
  if (state.tab !== 'trash') {
    const checkbox = el('input', 'select-box'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.includes(item.id);
    checkbox.setAttribute('aria-label', `选中 ${item.title}`);
    checkbox.addEventListener('change', () => toggleSelected(item, checkbox, row));
    selectCell.append(checkbox);
    row.addEventListener('click', event => {
      if (event.target.closest('button,input')) return;
      checkbox.checked = !checkbox.checked; toggleSelected(item, checkbox, row);
    });
  }
  row.append(selectCell);
  if (item.type === 'image') {
    const thumb = el('button', 'asset-thumb'); thumb.type = 'button'; thumb.setAttribute('aria-label', `查看图片 ${item.title}`);
    const image = el('img'); image.alt = ''; image.width = 80; image.height = 82; image.loading = 'lazy';
    thumbFor(item, image); thumb.append(image);
    thumb.addEventListener('click', () => viewImage(item)); row.append(thumb);
  }
  const content = el('div', 'asset-content'), titleline = el('div', 'asset-titleline');
  titleline.append(el('span', `kind-label ${item.type}`, item.type === 'image' ? '图片' : '文字'));
  const title = el('strong', 'asset-title', item.title); title.title = item.title; titleline.append(title);
  if (item.pinned && state.tab !== 'trash') titleline.append(el('span', 'pin-label', '置顶'));
  content.append(titleline);
  const previewText = item.type === 'text' ? item.body : item.original_name && item.original_name !== item.title ? item.original_name : '点击图片查看大图';
  content.append(el('p', 'asset-preview', previewText));
  const meta = el('div', 'asset-meta');
  for (const tag of item.tags.slice(0, 2)) { const chip = el('span', 'tag', `#${tag}`); chip.title = tag; meta.append(chip); }
  if (item.tags.length > 2) meta.append(el('span', 'tag', `+${item.tags.length - 2}`));
  meta.append(el('span', 'asset-date', dateLabel(item.created_at))); content.append(meta);
  const rowActions = el('div', 'row-actions'); rowActions.append(el('span', 'spacer'));
  if (state.tab === 'trash') {
    const restore = el('button', 'row-restore', '恢复素材'); restore.prepend(icon('restore'));
    restore.addEventListener('click', event => { event.stopPropagation(); run(async () => { await bridge.restore(item.id); await refresh(); toast('素材已恢复'); }); });
    const remove = el('button', 'row-delete', '彻底删除'); remove.prepend(icon('trash'));
    remove.addEventListener('click', event => { event.stopPropagation(); confirmDelete('彻底删除这条素材？', '删除后无法从回收站恢复，图片文件也会从本机素材库移除。', async () => {
      await bridge.deleteForever(item.id); await refresh(); toast('素材已彻底删除');
    }); });
    rowActions.append(restore, remove);
  } else {
    const favorite = iconButton('star', item.favorite ? '移出常用' : '加入常用', () => bridge.update(item.id, { favorite: !item.favorite }), `row-icon favorite ${item.favorite ? 'active' : ''}`);
    favorite.setAttribute('aria-pressed', String(item.favorite)); rowActions.append(favorite);
    const more = el('button', 'row-icon'); more.type = 'button'; more.title = '更多操作'; more.setAttribute('aria-label', `更多操作：${item.title}`);
    more.setAttribute('aria-expanded', 'false'); more.append(icon('more'));
    more.addEventListener('click', event => { event.stopPropagation(); openMenu(more, item); }); rowActions.append(more);
    const copy = el('button', 'row-copy', '复制'); copy.prepend(icon('copy'));
    copy.addEventListener('click', event => { event.stopPropagation(); run(async () => { await bridge.copy(item.id); toast('已复制，可按 Ctrl+V 粘贴'); }); });
    rowActions.append(copy);
  }
  content.append(rowActions); row.append(content);
  return row;
}
function appendMore() {
  const container = $('#items'), next = Math.min(state.visibleCount + 40, state.records.length);
  for (let i = state.visibleCount; i < next; i++) container.append(renderCard(state.records[i]));
  state.visibleCount = next;
}
function fillListViewport() {
  const container = $('#items');
  while (container.scrollHeight <= container.clientHeight && state.visibleCount < state.records.length) appendMore();
}
function render() {
  closeMenu();
  document.querySelectorAll('.tabs button').forEach(button => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('#listLabel').textContent = labels[state.tab];
  $('#itemCount').textContent = `${state.records.length} 条`;
  const container = $('#items'); container.replaceChildren();
  if (!state.records.length) {
    const empty = el('div', 'empty-state'), symbol = el('div', 'empty-symbol');
    symbol.append(icon(state.tab === 'trash' ? 'restore' : state.query ? 'search' : 'clipboard'));
    empty.append(symbol);
    empty.append(el('strong', '', state.query ? '没有找到相关素材' : state.tab === 'trash' ? '回收站是空的' : '还没有素材'));
    empty.append(el('p', '', state.query ? '试试缩短关键词，或切换到其他分类。' : state.tab === 'trash' ? '删除的素材会在这里保留 30 天。' : '复制一张参考图或一段文字，然后保存剪贴板。'));
    if (!state.query && state.tab !== 'trash') {
      const button = el('button', 'secondary-button', '写第一条文字');
      button.addEventListener('click', () => editItem()); empty.append(button);
    }
    container.append(empty);
  } else {
    const count = Math.min(state.visibleCount, state.records.length);
    for (let i = 0; i < count; i++) container.append(renderCard(state.records[i]));
  }
  renderSelection();
  if (state.records.length) requestAnimationFrame(fillListViewport);
}
function renderSelection() {
  const active = state.tab !== 'trash';
  $('#selectAll').classList.toggle('hidden', !active);
  $('#selectAll').disabled = !state.records.length;
  const allSelected = !!state.records.length && state.records.every(item => state.selected.includes(item.id));
  $('#selectAll').textContent = allSelected ? '取消全选' : '全选';
  $('#emptyTrash').classList.toggle('hidden', active || !state.status?.trashCount);
  $('#selectionBar').classList.toggle('hidden', !active || !state.selected.length);
  $('#selectionCount').textContent = `已选 ${state.selected.length} 条`;
}
function confirmDelete(title, message, onConfirm) {
  const content = el('div');
  content.append(el('p', 'help', message));
  const row = el('div', 'modal-actions'), cancel = el('button', 'plain-button', '取消');
  const remove = el('button', 'danger-button confirm-button', '彻底删除');
  cancel.addEventListener('click', closeModal);
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try { await onConfirm(); closeModal(); }
    catch (error) { toast(error.message); remove.disabled = false; }
  });
  row.append(cancel, remove); content.append(row);
  openModal(title, content, cancel);
}
function editItem(item = null) {
  const isNew = !item, content = el('div');
  const title = field(isNew ? '名称（可留空）' : '名称', item?.title || '', false, '例如：秋季茶盒配色…');
  const body = item?.type === 'image' ? null : field('文字内容', item?.body || '', true, '输入常用提示词、文案或灵感…');
  const tags = field('标签', item?.tags.join('，') || '', false, '例如：包装，国潮，配色…');
  content.append(title.wrap); if (body) content.append(body.wrap); content.append(tags.wrap);
  content.append(el('p', 'help', '多个标签用逗号分隔；图片文件不会被修改。'));
  content.append(actions(closeModal, async () => {
    if (!isNew && !title.control.value.trim()) { inlineError(title, '请填写名称。'); return; }
    if (body && !body.control.value.trim()) { inlineError(body, '请填写文字内容。'); return; }
    const data = { title: title.control.value, tags: tags.control.value.split(/[,，]/).map(x => x.trim()).filter(Boolean) };
    if (body) data.body = body.control.value;
    const result = await run(() => isNew ? bridge.addText(data) : bridge.update(item.id, data));
    if (result) { closeModal(); toast(isNew ? '文字已保存' : '修改已保存'); }
  }, isNew ? '保存文字' : '保存修改'));
  openModal(isNew ? '写一条文字' : '编辑素材', content, isNew ? body.control : title.control);
}
function startupPrompt() {
  const content = el('div');
  content.append(el('p', 'help', '开机启动后，素材库常驻系统托盘，快捷键随时可用。之后可在设置中更改。'));
  content.append(actions(async () => { await run(() => bridge.setStartup(false)); closeModal(); }, async () => {
    await run(() => bridge.setStartup(true)); closeModal(); toast('已开启开机启动');
  }, '开机启动'));
  openModal('随 Windows 开机启动？', content);
}
function shortcutLabel(accelerator) {
  if (!accelerator) return '未设置';
  const names = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win', Return: 'Enter', Up: '↑', Down: '↓', Left: '←', Right: '→' };
  return accelerator.split('+').map(part => names[part] || part).join(' + ');
}
function shortcutKey(event) {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return { Space: 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[code] || null;
}
async function settingsModal() {
  const current = await bridge.status(), content = el('div');
  const location = el('section', 'settings-group'); location.append(el('h3', '', '本机素材库'));
  location.append(el('div', 'path-box', current.libraryPath));
  const migrate = el('button', 'soft-button', '迁移到新文件夹'); migrate.style.marginTop = '10px';
  migrate.addEventListener('click', () => run(async () => { const result = await bridge.migrate(); if (result) { closeModal(); toast('迁移完成，原文件夹未删除'); } }));
  location.append(migrate); content.append(location);
  const shortcutGroup = el('section', 'settings-group'); shortcutGroup.append(el('h3', '', '全局快捷键'));
  const grid = el('div', 'shortcut-grid'), inputs = {};
  const keyError = el('p', 'field-error');
  let recording = null, captureActive = false;
  const stopRecording = () => {
    if (recording) { recording.classList.remove('is-recording'); recording.value = shortcutLabel(recording.dataset.accelerator); recording = null; }
    if (!captureActive) return Promise.resolve();
    captureActive = false;
    return bridge.endShortcutCapture().catch(error => { keyError.textContent = error.message; });
  };
  stopShortcutRecording = stopRecording;
  for (const [key, label] of [['collect', '收集'], ['toggle', '呼出']]) {
    const input = el('input', 'shortcut-input'); input.id = `shortcut-${key}`; input.name = input.id; input.readOnly = true; input.autocomplete = 'off';
    input.dataset.accelerator = current.shortcuts[key] || ''; input.value = shortcutLabel(input.dataset.accelerator);
    input.title = '点击后按下组合键'; input.setAttribute('aria-describedby', 'shortcut-help');
    input.addEventListener('focus', () => {
      if (!captureActive) {
        captureActive = true;
        bridge.beginShortcutCapture().catch(error => { keyError.textContent = error.message; stopRecording(); });
      }
      recording?.classList.remove('is-recording'); recording = input;
      input.classList.add('is-recording'); input.value = '请按组合键…'; keyError.textContent = '';
    });
    input.addEventListener('blur', () => {
      input.classList.remove('is-recording'); input.value = shortcutLabel(input.dataset.accelerator);
      setTimeout(() => { if (!Object.values(inputs).includes(document.activeElement)) stopRecording(); }, 0);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.blur(); return; }
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
      const keyName = shortcutKey(event);
      if (!keyName) {
        input.value = modifiers.length ? `${shortcutLabel(modifiers.join('+'))} + …` : '请按组合键…';
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) keyError.textContent = '暂不支持这个按键，请用字母、数字或功能键';
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(keyName)) {
        keyError.textContent = '请至少按住 Ctrl、Alt 或 Win，或使用功能键'; return;
      }
      const accelerator = [...modifiers, keyName].join('+');
      if (Object.entries(inputs).some(([other, node]) => other !== key && node.dataset.accelerator === accelerator)) {
        keyError.textContent = '收集和呼出不能使用同一个快捷键'; return;
      }
      input.dataset.accelerator = accelerator; input.value = shortcutLabel(accelerator); keyError.textContent = ''; input.blur();
    });
    const labelNode = el('label', '', label); labelNode.htmlFor = input.id; inputs[key] = input;
    const clear = el('button', 'soft-button shortcut-clear', '清除'); clear.type = 'button'; clear.setAttribute('aria-label', `清除${label}快捷键`);
    clear.addEventListener('click', () => { input.dataset.accelerator = ''; input.value = shortcutLabel(''); keyError.textContent = ''; });
    grid.append(labelNode, input, clear);
  }
  shortcutGroup.append(grid);
  shortcutGroup.append(el('p', 'help', '点击输入框后直接按组合键；按 Esc 取消。也可清除后留空保存。'));
  shortcutGroup.lastChild.id = 'shortcut-help';
  shortcutGroup.append(keyError);
  const saveKeys = el('button', 'soft-button', '保存快捷键'); saveKeys.id = 'saveShortcuts'; saveKeys.style.marginTop = '7px';
  saveKeys.addEventListener('click', async () => {
    keyError.textContent = ''; saveKeys.disabled = true;
    try { await stopRecording(); await bridge.setShortcuts(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.dataset.accelerator]))); toast('快捷键已更新'); }
    catch (error) { keyError.textContent = error.message; }
    finally { saveKeys.disabled = false; }
  });
  shortcutGroup.append(saveKeys); content.append(shortcutGroup);
  const startupGroup = el('section', 'settings-group setting-row');
  const startupLabel = el('label', '', '随 Windows 开机启动'), checkbox = el('input');
  checkbox.id = 'startup-checkbox'; startupLabel.htmlFor = checkbox.id; checkbox.type = 'checkbox'; checkbox.checked = current.launchAtLogin;
  checkbox.addEventListener('change', async () => {
    try { await bridge.setStartup(checkbox.checked); }
    catch (error) { checkbox.checked = !checkbox.checked; toast(error.message); }
  });
  startupGroup.append(startupLabel, checkbox); content.append(startupGroup);
  const about = el('section', 'settings-group setting-row');
  about.append(el('span', '', '粘不粘'), el('strong', 'version-badge', `版本 ${current.version}`));
  content.append(about);
  const closeRow = el('div', 'modal-actions'), done = el('button', 'primary-button', '完成');
  done.addEventListener('click', closeModal); closeRow.append(done); content.append(closeRow);
  openModal('设置', content, $('#closeModal'));
}
async function importFiles(files) {
  let count = 0, rejected = 0;
  const allowed = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
  for (const file of files) {
    const extension = file.name.split('.').pop().toLowerCase(), mime = allowed[extension];
    if (!mime) { rejected++; continue; }
    try { await bridge.addImage({ bytes: new Uint8Array(await file.arrayBuffer()), mime, name: file.name }); count++; }
    catch { rejected++; }
  }
  toast(count ? `已导入 ${count} 张图片${rejected ? `，${rejected} 张未导入` : ''}` : '未导入图片。请选择 PNG、JPG、WEBP、GIF 或 BMP 文件。');
}

$('#chooseFolder').addEventListener('click', () => run(async () => {
  const result = await bridge.chooseLibrary(); if (result) { await refresh(); if (!result.askedStartup) startupPrompt(); }
}));
$('#collectButton').addEventListener('click', async event => {
  const button = event.currentTarget, label = button.querySelector('span');
  button.disabled = true; label.textContent = '正在保存…';
  try { await bridge.collect(); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; label.textContent = '保存剪贴板'; }
});
$('#newText').addEventListener('click', () => editItem());
$('#importImages').addEventListener('click', () => $('#imageFiles').click());
$('#imageFiles').addEventListener('change', event => {
  const files = [...event.target.files]; event.target.value = '';
  if (files.length) run(() => importFiles(files));
});
$('#settingsButton').addEventListener('click', () => run(settingsModal));
$('#hideButton').addEventListener('click', () => bridge.hide());
$('#closeModal').addEventListener('click', closeModal);
$('#dialogBackdrop').addEventListener('click', event => { if (event.target.id === 'dialogBackdrop') closeModal(); });
let searchTimer;
$('#search').addEventListener('input', event => {
  state.query = event.target.value; state.visibleCount = 40;
  clearTimeout(searchTimer); searchTimer = setTimeout(() => run(refresh), 90);
});
document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
  state.tab = button.dataset.tab; state.visibleCount = 40; $('#items').scrollTop = 0; run(refresh);
}));
$('#items').addEventListener('scroll', event => {
  const node = event.currentTarget;
  if (node.scrollTop + node.clientHeight >= node.scrollHeight - 160 && state.visibleCount < state.records.length) appendMore();
  closeMenu();
});
$('#selectAll').addEventListener('click', () => {
  const ids = state.records.map(item => item.id), allSelected = ids.every(id => state.selected.includes(id));
  state.selected = allSelected ? state.selected.filter(id => !ids.includes(id)) : [...state.selected, ...ids.filter(id => !state.selected.includes(id))];
  render();
});
$('#clearSelection').addEventListener('click', () => { state.selected = []; render(); });
$('#favoriteSelected').addEventListener('click', () => run(async () => {
  const ids = [...state.selected];
  await bridge.favoriteMany(ids, true); state.selected = []; await refresh(); toast(`已将 ${ids.length} 条素材加入常用`);
}));
$('#trashSelected').addEventListener('click', () => run(async () => {
  const ids = [...state.selected];
  await bridge.trashMany(ids); state.selected = []; await refresh();
  toast(`已将 ${ids.length} 条素材移到回收站`, '撤销', () => bridge.restoreMany(ids));
}));
$('#emptyTrash').addEventListener('click', () => confirmDelete('清空回收站？', `回收站中的 ${state.status.trashCount} 条素材及图片文件将被彻底删除，无法恢复。`, async () => {
  const count = await bridge.emptyTrash(); await refresh(); toast(`已彻底删除 ${count} 条素材`);
}));
document.addEventListener('pointerdown', event => {
  if (state.menu && !state.menu.node.contains(event.target) && !state.menu.button.contains(event.target)) closeMenu();
});
window.addEventListener('blur', () => {
  if (document.activeElement?.classList?.contains('shortcut-input')) document.activeElement.blur();
  stopShortcutRecording?.();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (state.menu) { const trigger = state.menu.button; closeMenu(); trigger.focus(); }
    else if (!$('#dialogBackdrop').classList.contains('hidden')) closeModal();
    else bridge.hide();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); }
  if (event.key === 'Tab' && !$('#dialogBackdrop').classList.contains('hidden')) {
    const focusables = [...$('#dialogBackdrop').querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
let dragDepth = 0, dropOverlay;
document.addEventListener('dragenter', event => {
  if (!state.status?.ready || !event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault(); dragDepth++;
  if (!dropOverlay) { dropOverlay = el('div', 'drop-overlay', '松开鼠标，导入图片'); document.body.append(dropOverlay); }
});
document.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) { dragDepth = 0; dropOverlay?.remove(); dropOverlay = null; } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; dropOverlay?.remove(); dropOverlay = null;
  if (state.status?.ready) run(() => importFiles([...event.dataTransfer.files]));
});
bridge.onChange(() => run(refresh));
bridge.onToast(message => toast(message));
bridge.onPanelExpanded(expanded => $('#appShell').classList.toggle('expanded', !!expanded));
bridge.onPanelAnchor(side => $('#appShell').classList.toggle('anchor-left', side === 'left'));
(async () => {
  await refresh();
})().catch(error => toast(error.message));
