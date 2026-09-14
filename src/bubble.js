const button = document.querySelector('#toggle');
let gesture = null;

window.api.onBubbleState(({ open }) => {
  button.classList.toggle('open', !!open);
  button.setAttribute('aria-expanded', String(!!open));
  button.setAttribute('aria-label', open ? '收起素材库，拖动可移动' : '展开素材库，拖动可移动');
  button.title = open ? '点击收起素材库 · 拖动可移动' : '点击展开素材库 · 拖动可移动';
});

button.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  button.classList.add('pointer-focus');
  gesture = { x: event.screenX, y: event.screenY, left: window.screenX, top: window.screenY, moved: false };
  button.setPointerCapture(event.pointerId);
});
button.addEventListener('keydown', () => button.classList.remove('pointer-focus'));
button.addEventListener('blur', () => button.classList.remove('pointer-focus'));
button.addEventListener('pointermove', event => {
  if (!gesture) return;
  const dx = event.screenX - gesture.x, dy = event.screenY - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
  gesture.moved = true;
  button.classList.add('dragging');
  window.api.moveBubble(gesture.left + dx, gesture.top + dy);
});
button.addEventListener('pointerup', () => {
  if (!gesture) return;
  const moved = gesture.moved; gesture = null;
  button.classList.remove('dragging');
  if (moved) window.api.saveBubblePosition();
  else window.api.toggleBubble();
  button.blur();
});
button.addEventListener('pointercancel', () => { gesture = null; button.classList.remove('dragging'); button.blur(); });
button.addEventListener('click', event => { if (event.detail === 0) window.api.toggleBubble(); });
