/* ============================================================
 * 灵感板 · 前端逻辑（零依赖原生 JS）
 * 模式：
 *  - github：公开仓库 JSON。读 = raw/API（无 Token 即可，满足公开访问）；
 *            写 = GitHub Contents API（需你自己的 Token，仅存本机浏览器）。
 *  - local ：自托管 Node 服务 /api/inspirations（公开读写）。
 * ============================================================ */

const STORE_KEY = 'insp_config';
const DEFAULTS = {
  mode: 'github',
  owner: 'JohnnyDengANU',
  repo: 'inspiration-board',
  branch: 'main',
  token: '',
  apiBase: '/api/inspirations'
};

function cfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) {}
  const c = Object.assign({}, DEFAULTS, saved);
  // 本地预览（localhost）自动用 local 模式，直连 /api/inspirations；
  // 真实部署到 *.github.io 时则用 github 模式（公开读取 + Token 写入）。
  if (!localStorage.getItem(STORE_KEY) && /localhost|127\.0\.0\.1/.test(location.hostname)) {
    c.mode = 'local';
  }
  return c;
}
function saveCfg(c) { localStorage.setItem(STORE_KEY, JSON.stringify(c)); }

/* ---------- 工具 ---------- */
function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') n.className = props[k];
    else if (k === 'text') n.textContent = props[k];
    else if (k === 'html') n.innerHTML = props[k];
    else if (k.startsWith('on') && typeof props[k] === 'function') n.addEventListener(k.slice(2), props[k]);
    else if (k === 'dataset') Object.assign(n.dataset, props[k]);
    else n.setAttribute(k, props[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function b64encodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/* ---------- 数据读写 ---------- */
async function loadData() {
  const c = cfg();
  if (c.mode === 'local') {
    const r = await fetch(c.apiBase, { cache: 'no-store' });
    if (!r.ok) throw new Error('本地 API 读取失败：' + r.status);
    return await r.json();
  }
  // github 模式
  if (!c.owner || !c.repo) throw new Error('请在 ⚙ 设置中填写 GitHub 用户名与仓库名');
  if (c.token) {
    // 已登录：走 Contents API（实时、权威）
    const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/inspirations.json?ref=${c.branch}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('GitHub 读取失败：' + r.status);
    const j = await r.json();
    return JSON.parse(b64decodeUtf8(j.content));
  }
  // 公开只读：raw 链接，无需 Token（满足公开访问）
  const url = `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/inspirations.json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('GitHub 公开读取失败：' + r.status);
  return await r.json();
}

async function saveAll(items) {
  const c = cfg();
  if (c.mode === 'local') {
    const r = await fetch(c.apiBase, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    });
    if (!r.ok) throw new Error('本地保存失败：' + r.status);
    return;
  }
  if (!c.token) throw new Error('需要 GitHub Token 才能写入（设置中填写）');
  const content = b64encodeUtf8(JSON.stringify(items, null, 2));
  const sha = await getSha(c);
  const body = { message: `灵感更新 · 共 ${items.length} 条`, content, branch: c.branch };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/inspirations.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status === 409) {            // 并发冲突：重新取 sha 重试
    return saveAll(items);
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error('GitHub 保存失败：' + r.status + (e.message ? ' ' + e.message : ''));
  }
}
async function getSha(c) {
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/inspirations.json?ref=${c.branch}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('获取 sha 失败：' + r.status);
  return (await r.json()).sha;
}

/* ---------- 状态 ---------- */
let DATA = [];
let editingId = null;
let formImages = [];
let activeTag = null;

/* ---------- 渲染 ---------- */
function categories() {
  return [...new Set(DATA.map(d => (d.category || '').trim()).filter(Boolean))];
}
function allTags() {
  const s = new Set();
  DATA.forEach(d => (d.tags || []).forEach(t => s.add(t.trim())));
  return [...s].filter(Boolean).sort();
}
function applyFilters() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const cat = document.getElementById('categoryFilter').value;
  return DATA.filter(d => {
    if (cat && (d.category || '') !== cat) return false;
    if (activeTag && !(d.tags || []).includes(activeTag)) return false;
    if (q) {
      const hay = [d.title, d.content, d.author, (d.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function render() {
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  list.innerHTML = '';

  // 分类下拉
  const catSel = document.getElementById('categoryFilter');
  const cur = catSel.value;
  catSel.innerHTML = '<option value="">全部分类</option>' + categories().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = cur;

  // 标签 chips
  const tagBox = document.getElementById('tagFilter');
  tagBox.innerHTML = '';
  allTags().forEach(t => {
    tagBox.appendChild(el('span', {
      class: 'chip' + (activeTag === t ? ' active' : ''),
      text: '#' + t,
      onclick: () => { activeTag = activeTag === t ? null : t; render(); }
    }));
  });

  const filtered = applyFilters();
  empty.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((d, i) => {
    const imgs = el('div', { class: 'imgs' }, (d.images || []).map(src =>
      el('img', { src, alt: '灵感图片', loading: 'lazy' })
    ));
    const meta = el('div', { class: 'meta' }, [
      d.category ? el('span', { class: 'cat', text: d.category }) : null,
      ...(d.tags || []).map(t => el('span', { class: 'tag', text: '#' + t, onclick: () => { activeTag = t; render(); } }))
    ]);
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'no' }, [
        el('span', { text: 'No.' + (i + 1) }),
        el('span', { class: 'id', text: '#' + d.id })
      ]),
      el('h3', { text: d.title || '（无标题）' }),
      d.content ? el('div', { class: 'content', text: d.content }) : null,
      (d.images && d.images.length) ? imgs : null,
      meta,
      el('div', { class: 'foot' }, [
        el('span', { text: (d.author || '匿名') + ' · ' + fmtTime(d.updated_at || d.created_at) }),
        el('div', { class: 'ops' }, [
          el('button', { class: 'mini', text: '编辑', onclick: () => openForm(d.id) }),
          el('button', { class: 'mini danger', text: '删除', onclick: () => removeInsp(d.id) })
        ])
      ])
    ]);
    list.appendChild(card);
  });
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

/* ---------- 写入 Token 临时弹窗（删/改/增时若未填则一键补） ---------- */
let pendingTokenResolve = null;
function openTokenModal(actionLabel) {
  document.getElementById('tokenActionLabel').textContent = actionLabel || '写入';
  const inp = document.getElementById('t-token');
  inp.value = '';
  document.getElementById('tokenModal').classList.remove('hidden');
  inp.focus();
}
function closeTokenModal() {
  document.getElementById('tokenModal').classList.add('hidden');
}
// 返回 Promise<boolean>：已具备写入条件（或无需 token）则立即 true；否则弹窗等用户输入。
function ensureToken(actionLabel) {
  const c = cfg();
  if (c.mode !== 'github') return Promise.resolve(true);
  if (c.token && c.owner && c.repo) return Promise.resolve(true);
  return new Promise((resolve) => {
    pendingTokenResolve = resolve;
    openTokenModal(actionLabel);
  });
}
function bindTokenModal() {
  const finish = (ok) => {
    closeTokenModal();
    const r = pendingTokenResolve; pendingTokenResolve = null;
    if (r) r(!!ok);
  };
  document.getElementById('tokenSave').onclick = () => {
    const t = document.getElementById('t-token').value.trim();
    if (!t) { toast('请填写 Token', 'err'); return; }
    const c = cfg();
    c.token = t;
    saveCfg(c);
    finish(true);
  };
  document.getElementById('tokenCancel').onclick = () => finish(false);
  document.getElementById('tokenClose').onclick = () => finish(false);
  document.getElementById('tokenToSettings').onclick = () => { finish(false); openSettings(); };
  document.getElementById('tokenModal').onclick = (e) => {
    if (e.target.id === 'tokenModal') finish(false);
  };
}

/* ---------- 弹窗表单 ---------- */
function openForm(id) {
  editingId = id || null;
  const d = id ? DATA.find(x => x.id === id) : null;
  document.getElementById('modalTitle').textContent = id ? '编辑灵感' : '新建灵感';
  document.getElementById('f-title').value = d ? (d.title || '') : '';
  document.getElementById('f-content').value = d ? (d.content || '') : '';
  document.getElementById('f-tags').value = d ? (d.tags || []).join(', ') : '';
  document.getElementById('f-category').value = d ? (d.category || '') : '';
  document.getElementById('f-author').value = d ? (d.author || '匿名') : '匿名';
  formImages = d ? [...(d.images || [])] : [];
  renderImgList();
  document.getElementById('modal').classList.remove('hidden');
}
function closeForm() { document.getElementById('modal').classList.add('hidden'); editingId = null; }

function renderImgList() {
  const box = document.getElementById('imgList');
  box.innerHTML = '';
  formImages.forEach((src, idx) => {
    box.appendChild(el('div', { class: 'thumb' }, [
      el('img', { src, alt: '缩略图' }),
      el('button', { class: 'rm', text: '×', onclick: () => { formImages.splice(idx, 1); renderImgList(); } })
    ]));
  });
}

async function submitForm(e) {
  e.preventDefault();
  if (!(await ensureToken(editingId ? '更新' : '创建'))) return;
  const now = new Date().toISOString();
  const title = document.getElementById('f-title').value.trim();
  if (!title) { toast('标题不能为空', 'err'); return; }
  const entry = {
    id: editingId || String(Date.now()),
    title,
    content: document.getElementById('f-content').value.trim(),
    images: [...formImages],
    tags: document.getElementById('f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    category: document.getElementById('f-category').value.trim(),
    author: document.getElementById('f-author').value.trim() || '匿名',
    created_at: editingId ? (DATA.find(x => x.id === editingId) || {}).created_at || now : now,
    updated_at: now
  };
  if (editingId) {
    const i = DATA.findIndex(x => x.id === editingId);
    if (i >= 0) DATA[i] = entry; else DATA.unshift(entry);
  } else {
    DATA.unshift(entry);
  }
  try {
    await saveAll(DATA);
    toast(editingId ? '已更新' : '已创建', 'ok');
    closeForm();
    DATA = await loadData();
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function removeInsp(id) {
  if (!confirm('确定删除这条灵感？此操作公开且不可恢复。')) return;
  if (!(await ensureToken('删除'))) return;
  DATA = DATA.filter(x => x.id !== id);
  try {
    await saveAll(DATA);
    toast('已删除', 'ok');
    DATA = await loadData();
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------- 设置抽屉 ---------- */
function openSettings() {
  const c = cfg();
  document.getElementById('s-mode').value = c.mode;
  document.getElementById('s-owner').value = c.owner;
  document.getElementById('s-repo').value = c.repo;
  document.getElementById('s-branch').value = c.branch;
  document.getElementById('s-token').value = c.token;
  document.getElementById('s-apibase').value = c.apiBase;
  toggleSettingFields();
  document.getElementById('settings').classList.remove('hidden');
}
function closeSettings() { document.getElementById('settings').classList.add('hidden'); }
function toggleSettingFields() {
  const mode = document.getElementById('s-mode').value;
  document.getElementById('githubFields').classList.toggle('hidden', mode !== 'github');
  document.getElementById('localFields').classList.toggle('hidden', mode !== 'local');
}
function saveSettings() {
  const c = {
    mode: document.getElementById('s-mode').value,
    owner: document.getElementById('s-owner').value.trim(),
    repo: document.getElementById('s-repo').value.trim(),
    branch: document.getElementById('s-branch').value.trim() || 'main',
    token: document.getElementById('s-token').value.trim(),
    apiBase: document.getElementById('s-apibase').value.trim() || '/api/inspirations'
  };
  saveCfg(c);
  closeSettings();
  init();
}

/* ---------- 初始化 ---------- */
async function init() {
  const c = cfg();
  document.getElementById('readonlyBanner').classList.toggle('hidden', !(c.mode === 'github' && !c.token));
  try {
    DATA = await loadData();
  } catch (err) {
    DATA = [];
    toast(err.message, 'err');
  }
  render();
}

/* ---------- 事件绑定 ---------- */
document.getElementById('btnNew').onclick = () => openForm(null);
document.getElementById('btnSettings').onclick = openSettings;
bindTokenModal();
document.getElementById('modalClose').onclick = closeForm;
document.getElementById('formCancel').onclick = closeForm;
document.getElementById('form').onsubmit = submitForm;
document.getElementById('settingsClose').onclick = closeSettings;
document.getElementById('settingsSave').onclick = saveSettings;
document.getElementById('settingsReset').onclick = () => { localStorage.removeItem(STORE_KEY); toast('已恢复默认', 'ok'); openSettings(); };
document.getElementById('s-mode').onchange = toggleSettingFields;
document.getElementById('search').oninput = render;
document.getElementById('categoryFilter').onchange = render;
document.getElementById('addUrl').onclick = () => {
  const v = document.getElementById('f-img-url').value.trim();
  if (v) { formImages.push(v); document.getElementById('f-img-url').value = ''; renderImgList(); }
};
document.getElementById('f-img-file').onchange = (e) => {
  const files = [...e.target.files];
  files.forEach(f => {
    if (f.size > 3 * 1024 * 1024) { toast('图片过大（>3MB），已跳过：' + f.name, 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => { formImages.push(rd.result); renderImgList(); };
    rd.readAsDataURL(f);
  });
  e.target.value = '';
};
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') closeForm(); };
document.getElementById('settings').onclick = (e) => { if (e.target.id === 'settings') closeSettings(); };

init();
