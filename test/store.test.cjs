const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhantie-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: await Store.open(root) };
}

test('文字可保存、搜索、编辑，且收藏和置顶互不影响', async t => {
  const { root, store } = await fixture(t);
  const item = store.addText('温暖的陶瓷包装\n柔和自然光', '', ['包装', '灵感']);
  assert.equal(item.type, 'text');
  assert.equal(store.list({ query: '陶瓷' }).length, 1);
  store.update(item.id, { body: '蓝色包装', title: '蓝色灵感', tags: ['蓝色'], favorite: true, pinned: true });
  assert.equal(store.list({ tab: 'favorite', query: '蓝色' }).length, 1);
  assert.equal(store.get(item.id).pinned, true);
  store.close();
  const reopened = await Store.open(root);
  assert.equal(reopened.get(item.id).body, '蓝色包装');
  reopened.close();
});

test('图片独立复制进素材库，删除后可恢复，30 天后清理', async t => {
  const { root, store } = await fixture(t);
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const item = store.addImage(png, 'image/png', '参考.png');
  assert.deepEqual(fs.readFileSync(store.imagePath(item)), png);
  store.trash(item.id);
  assert.equal(store.list().length, 0);
  assert.equal(store.list({ trash: true }).length, 1);
  store.restore(item.id);
  assert.equal(store.list().length, 1);
  store.trash(item.id);
  assert.equal(store.purgeOld(Date.now() + 31 * 86400000), 1);
  assert.equal(store.get(item.id), null);
  assert.equal(fs.existsSync(path.join(root, 'images', item.filename)), false);
  store.close();
});

test('空白文字和不支持的图片格式被拒绝', async t => {
  const { store } = await fixture(t);
  assert.throws(() => store.addText('  '), /不能为空/);
  assert.throws(() => store.addImage(Buffer.from('x'), 'image/svg+xml'), /只支持/);
  store.close();
});

test('批量管理后列表即时更新，回收站可彻底删除并清空', async t => {
  const { root, store } = await fixture(t);
  const first = store.addText('第一条'), second = store.addText('第二条');
  const image = store.addImage(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png', '参考.png');
  assert.equal(store.favoriteMany([first.id, second.id], true), 2);
  assert.equal(store.list({ tab: 'favorite' }).length, 2);
  assert.equal(store.trashMany([first.id, image.id]), 2);
  assert.deepEqual(store.list().map(x => x.id), [second.id]);
  assert.equal(store.list({ trash: true }).length, 2);
  assert.equal(store.trashCount(), 2);
  store.deleteForever(image.id);
  assert.equal(store.get(image.id), null);
  assert.equal(fs.existsSync(path.join(root, 'images', image.filename)), false);
  assert.equal(store.emptyTrash(), 1);
  assert.equal(store.trashCount(), 0);
  assert.equal(store.list({ trash: true }).length, 0);
  assert.equal(store.list().length, 1);
  store.close();
  const reopened = await Store.open(root);
  assert.equal(reopened.get(first.id), null);
  assert.equal(reopened.get(image.id), null);
  assert.deepEqual(reopened.list().map(x => x.id), [second.id]);
  reopened.close();
});
