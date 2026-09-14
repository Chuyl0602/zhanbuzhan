const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');

const DAY = 24 * 60 * 60 * 1000;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' };

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function atomicWrite(file, bytes) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}
function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}
function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 20);
}

class Store {
  static async open(root) {
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    ensureDir(root);
    ensureDir(path.join(root, 'images'));
    const dbFile = path.join(root, 'library.sqlite');
    const db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
      filename TEXT, original_name TEXT, mime TEXT, tags TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    )`);
    const store = new Store(root, db);
    store.save();
    store.purgeOld();
    return store;
  }
  constructor(root, db) { this.root = root; this.db = db; }
  save() { atomicWrite(path.join(this.root, 'library.sqlite'), Buffer.from(this.db.export())); }
  all() { return rows(this.db, 'SELECT * FROM items').map(this.decode); }
  activeCount() { return this.db.exec('SELECT COUNT(*) FROM items WHERE deleted_at IS NULL')[0].values[0][0]; }
  trashCount() { return this.db.exec('SELECT COUNT(*) FROM items WHERE deleted_at IS NOT NULL')[0].values[0][0]; }
  decode(row) { return { ...row, tags: JSON.parse(row.tags || '[]'), favorite: !!row.favorite, pinned: !!row.pinned }; }
  get(id) {
    const found = rows(this.db, 'SELECT * FROM items WHERE id = ?', [id])[0];
    return found ? this.decode(found) : null;
  }
  list({ tab = 'all', query = '', trash = false } = {}) {
    const term = String(query).trim().toLocaleLowerCase();
    return this.all().filter(x => trash ? x.deleted_at != null : x.deleted_at == null)
      .filter(x => tab === 'all' || (tab === 'favorite' ? x.favorite : x.type === tab))
      .filter(x => !term || [x.title, x.body || '', ...x.tags].some(y => String(y).toLocaleLowerCase().includes(term)))
      .sort((a, b) => trash ? b.deleted_at - a.deleted_at : (Number(b.pinned) - Number(a.pinned) || b.created_at - a.created_at));
  }
  addText(body, title = '', tags = []) {
    body = String(body ?? '');
    if (!body.trim()) throw new Error('文字内容不能为空');
    if (body.length > 200000) throw new Error('文字内容超过 20 万字');
    const now = Date.now(), id = crypto.randomUUID();
    title = String(title).trim().slice(0, 120) || body.trim().split(/\r?\n/)[0].slice(0, 48);
    this.db.run('INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, 'text', title, body, null, null, null, JSON.stringify(normalizeTags(tags)), 0, 0, now, now, null]);
    this.save();
    return this.get(id);
  }
  addImage(bytes, mime, originalName = '', title = '', tags = []) {
    if (!IMAGE_MIMES.has(mime)) throw new Error('只支持 PNG、JPG、WEBP、GIF、BMP 图片');
    bytes = Buffer.from(bytes);
    if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('图片必须小于 50 MB');
    const id = crypto.randomUUID(), filename = id + EXT[mime], now = Date.now();
    const target = path.join(this.root, 'images', filename);
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    try {
      title = String(title).trim().slice(0, 120) || path.parse(String(originalName)).name.slice(0, 80) || `图片 ${new Date(now).toLocaleString('zh-CN')}`;
      this.db.run('INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, 'image', title, null, filename, String(originalName).slice(0, 255), mime, JSON.stringify(normalizeTags(tags)), 0, 0, now, now, null]);
      this.save();
      return this.get(id);
    } catch (error) { fs.rmSync(target, { force: true }); throw error; }
  }
  update(id, patch) {
    const item = this.get(id);
    if (!item || item.deleted_at != null) throw new Error('素材不存在');
    const title = patch.title === undefined ? item.title : String(patch.title).trim().slice(0, 120);
    if (!title) throw new Error('名称不能为空');
    const body = item.type === 'text' && patch.body !== undefined ? String(patch.body) : item.body;
    if (item.type === 'text' && (!body.trim() || body.length > 200000)) throw new Error('文字内容不能为空且不能超过 20 万字');
    const tags = patch.tags === undefined ? item.tags : normalizeTags(patch.tags);
    const favorite = patch.favorite === undefined ? item.favorite : !!patch.favorite;
    const pinned = patch.pinned === undefined ? item.pinned : !!patch.pinned;
    this.db.run('UPDATE items SET title=?, body=?, tags=?, favorite=?, pinned=?, updated_at=? WHERE id=?', [title, body, JSON.stringify(tags), Number(favorite), Number(pinned), Date.now(), id]);
    this.save();
    return this.get(id);
  }
  trash(id) {
    const item = this.get(id);
    if (!item || item.deleted_at != null) throw new Error('素材不存在或已在回收站');
    this.db.run('UPDATE items SET deleted_at=? WHERE id=?', [Date.now(), id]); this.save();
  }
  trashMany(ids) {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.some(id => !this.get(id) || this.get(id).deleted_at != null)) throw new Error('所选素材中有不可删除的内容');
    const now = Date.now();
    for (const id of unique) this.db.run('UPDATE items SET deleted_at=? WHERE id=?', [now, id]);
    this.save(); return unique.length;
  }
  restore(id) {
    const item = this.get(id);
    if (!item || item.deleted_at == null) throw new Error('回收站中没有这条素材');
    this.db.run('UPDATE items SET deleted_at=NULL WHERE id=?', [id]); this.save();
  }
  restoreMany(ids) {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.some(id => !this.get(id) || this.get(id).deleted_at == null)) throw new Error('所选素材不在回收站中');
    for (const id of unique) this.db.run('UPDATE items SET deleted_at=NULL WHERE id=?', [id]);
    this.save(); return unique.length;
  }
  favoriteMany(ids, favorite = true) {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.some(id => !this.get(id) || this.get(id).deleted_at != null)) throw new Error('所选素材中有不可用的内容');
    for (const id of unique) this.db.run('UPDATE items SET favorite=?, updated_at=? WHERE id=?', [Number(!!favorite), Date.now(), id]);
    this.save(); return unique.length;
  }
  deleteForever(id) {
    const item = this.get(id);
    if (!item || item.deleted_at == null) throw new Error('请先把素材移到回收站');
    if (item.filename) fs.rmSync(path.join(this.root, 'images', path.basename(item.filename)), { force: true });
    this.db.run('DELETE FROM items WHERE id=?', [id]); this.save();
  }
  emptyTrash() {
    const deleted = this.list({ trash: true });
    for (const item of deleted) {
      if (item.filename) fs.rmSync(path.join(this.root, 'images', path.basename(item.filename)), { force: true });
      this.db.run('DELETE FROM items WHERE id=?', [item.id]);
    }
    if (deleted.length) this.save();
    return deleted.length;
  }
  purgeOld(now = Date.now()) {
    const expired = this.all().filter(x => x.deleted_at != null && now - x.deleted_at >= 30 * DAY);
    for (const item of expired) {
      if (item.filename) fs.rmSync(path.join(this.root, 'images', item.filename), { force: true });
      this.db.run('DELETE FROM items WHERE id=?', [item.id]);
    }
    if (expired.length) this.save();
    return expired.length;
  }
  imagePath(item, includeTrash = false) {
    if (!item || item.type !== 'image' || !item.filename || (!includeTrash && item.deleted_at != null)) throw new Error('图片不可用');
    return path.join(this.root, 'images', path.basename(item.filename));
  }
  close() { this.save(); this.db.close(); }
}

module.exports = { Store, IMAGE_MIMES, normalizeTags };
