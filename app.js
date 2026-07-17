/* ============================================================
 * 灵感板 · 前端逻辑（零依赖原生 JS）
 * 模式：
 *  - github：公开仓库 JSON。读 = raw/API（无 Token 即可，满足公开访问）；
 *            写 = GitHub Contents API（需你自己的 Token，仅存本机浏览器）。
 *  - local ：自托管 Node 服务 /api/inspirations（公开读写）。
 *
 * 新增能力（2026-07-17）：
 *  1) 批量删除（多选 + 确认）           —— 见 toggleSelectMode / batchDelete
 *  2) 自适应润色（按内容粗糙度自动调力度）—— 见 evaluateRoughness / polishText
 *  3) 语音输入（Web Speech API）        —— 见 initVoice / toggleMic
 *  4) 自动凝练标题（按内容生成简洁标题）—— 见 genTitle
 *  5) 同步休眠保护（sync-guard）         —— 见 beginSyncLock / endSyncLock
 *     说明：写操作后禁用"写入类"按钮并显示倒计时横幅，等待远端同步完成。
 *     默认锁定时长 SYNC_LOCK_MS=8000（8 秒，已覆盖 GitHub API 写入 + CDN 刷新缓冲）。
 *     若确实想"休眠一分钟"，把下面常量改为 60000 即可。
 * ============================================================ */

// —— 同步休眠时长（毫秒）。如需严格 60 秒，改为 60000 ——
const SYNC_LOCK_MS = 8000;

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
    else if (props[k] != null) n.setAttribute(k, props[k]);
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
  if (!c.owner || !c.repo) throw new Error('请在 ⚙ 设置中填写 GitHub 用户名与仓库名');
  if (c.token) {
    const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/inspirations.json?ref=${c.branch}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('GitHub 读取失败：' + r.status);
    const j = await r.json();
    return JSON.parse(b64decodeUtf8(j.content));
  }
  const url = `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/inspirations.json?t=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('GitHub 公开读取失败：' + r.status);
  return await r.json();
}

async function saveAll(items, depth = 0) {
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
  if (r.status === 409) {
    if (depth >= 3) throw new Error('并发冲突，请稍后重试');
    return saveAll(items, depth + 1);
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

async function pushMerged(mergeFn) {
  const latest = await loadData();
  const next = mergeFn(latest);
  await saveAll(next);
  return next;
}

/* ---------- 状态 ---------- */
let DATA = [];
let editingId = null;
let formImages = [];
let activeTag = null;
let selectMode = false;
let selectedIds = new Set();

/* ---------- 同步休眠保护（sync-guard） ---------- */
let syncing = false;
let syncTimer = null;
let syncTick = null;
let syncEndAt = 0;
function updateSyncBanner() {
  const b = document.getElementById('syncBanner');
  if (!b) return;
  const left = Math.max(0, Math.ceil((syncEndAt - Date.now()) / 1000));
  b.textContent = `同步中，请稍候（约 ${left} 秒）…`;
  if (left <= 0 && syncTick) { clearInterval(syncTick); syncTick = null; }
}
function refreshSyncUI() {
  document.body.classList.toggle('syncing', syncing);
  const banner = document.getElementById('syncBanner');
  if (banner) banner.classList.toggle('hidden', !syncing);
  const setDis = (id, on) => { const e = document.getElementById(id); if (e) e.disabled = on; };
  setDis('btnNew', syncing);
  setDis('btnBatch', syncing);
  setDis('btnSettings', syncing);
  setDis('batchAll', syncing);
  setDis('batchDelete', syncing || selectedIds.size === 0);
  setDis('batchCancel', syncing);
  const submit = document.querySelector('#form button[type=submit]');
  if (submit) submit.disabled = syncing;
  if (syncing && syncTick) updateSyncBanner();
}
function beginSyncLock() {
  syncing = true;
  if (syncTimer) clearTimeout(syncTimer);
  if (syncTick) clearInterval(syncTick);
  syncEndAt = Date.now() + SYNC_LOCK_MS;
  syncTick = setInterval(updateSyncBanner, 400);
  updateSyncBanner();
  refreshSyncUI();
  render(); // 让已有卡片的编辑/删除按钮反映禁用态
}
function endSyncLock() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncing = false;
    if (syncTick) { clearInterval(syncTick); syncTick = null; }
    refreshSyncUI();
    render();
  }, SYNC_LOCK_MS);
}

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

  const catSel = document.getElementById('categoryFilter');
  const cur = catSel.value;
  catSel.innerHTML = '<option value="">全部分类</option>' + categories().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = cur;

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

    const kids = [
      el('div', { class: 'no' }, [
        el('span', { text: 'No.' + (i + 1) }),
        el('span', { class: 'id', text: '#' + d.id })
      ]),
      el('h3', { text: d.title || '（无标题）' }),
      d.content ? el('div', { class: 'content', text: d.content }) : null,
      (d.images && d.images.length) ? imgs : null,
      meta
    ];

    if (selectMode) {
      const cb = el('input', { type: 'checkbox', class: 'pickbox' });
      cb.checked = selectedIds.has(d.id);
      cb.addEventListener('change', (e) => toggleSelect(d.id, e.target.checked));
      kids.unshift(el('label', { class: 'pick' }, [cb]));
      kids.push(el('div', { class: 'foot' }, [
        el('span', { text: (d.author || '匿名') + ' · ' + fmtTime(d.updated_at || d.created_at) })
      ]));
    } else {
      const editBtn = el('button', { class: 'mini', text: '编辑', onclick: () => openForm(d.id) });
      const delBtn = el('button', { class: 'mini danger', text: '删除', onclick: () => removeInsp(d.id) });
      if (syncing) { editBtn.disabled = true; delBtn.disabled = true; }
      kids.push(el('div', { class: 'foot' }, [
        el('span', { text: (d.author || '匿名') + ' · ' + fmtTime(d.updated_at || d.created_at) }),
        el('div', { class: 'ops' }, [editBtn, delBtn])
      ]));
    }

    const card = el('div', { class: 'card' + (selectMode ? ' selecting' : '') }, kids);
    list.appendChild(card);
  });

  updateBatchCount();
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}
function updateBatchCount() {
  const c = document.getElementById('batchCount');
  if (c) c.textContent = `已选 ${selectedIds.size} 项`;
  const bd = document.getElementById('batchDelete');
  if (bd) bd.disabled = selectedIds.size === 0 || syncing;
}

/* ---------- 写入 Token 临时弹窗 ---------- */
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
  const ap = document.getElementById('f-autopolish');
  if (ap) ap.checked = false;
  formImages = d ? [...(d.images || [])] : [];
  renderImgList();
  document.getElementById('modal').classList.remove('hidden');
}
function closeForm() {
  document.getElementById('modal').classList.add('hidden');
  editingId = null;
  if (recog && micOn) { try { recog.stop(); } catch (e) {} }
}

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
  if (syncing) { toast('同步中，请稍候', 'err'); return; }
  if (!(await ensureToken(editingId ? '更新' : '创建'))) return;

  // 保存时自动润色（若勾选）
  const ta = document.getElementById('f-content');
  const ap = document.getElementById('f-autopolish');
  if (ap && ap.checked) {
    const r = polishText(ta.value);
    ta.value = r.text;
  }

  let title = document.getElementById('f-title').value.trim();
  if (!title) {                              // 标题为空 → 自动凝练标题（语音直录场景）
    title = genTitle(ta.value);
    if (!title) { toast('标题不能为空', 'err'); return; }
    toast('已根据内容自动生成标题', 'ok');
  }
  const now = new Date().toISOString();
  const entry = {
    id: editingId || String(Date.now()),
    title,
    content: ta.value.trim(),
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
  closeForm();
  render();
  toast(editingId ? '已更新' : '已创建', 'ok');
  beginSyncLock();
  try {
    await pushMerged(latest => {
      const i = latest.findIndex(x => x.id === entry.id);
      if (i >= 0) latest[i] = entry; else latest.unshift(entry);
      return latest;
    });
  } catch (err) {
    toast(err.message, 'err');
  }
  endSyncLock();
}

async function removeInsp(id) {
  if (!confirm('确定删除这条灵感？此操作公开且不可恢复。')) return;
  if (!(await ensureToken('删除'))) return;
  const backup = DATA;
  DATA = DATA.filter(x => x.id !== id);
  render();
  toast('已删除', 'ok');
  beginSyncLock();
  try {
    await pushMerged(latest => latest.filter(x => x.id !== id));
  } catch (err) {
    DATA = backup; render();
    toast(err.message, 'err');
  }
  endSyncLock();
}

/* ---------- 批量删除 ---------- */
function toggleSelectMode() {
  selectMode = !selectMode;
  if (!selectMode) selectedIds.clear();
  document.getElementById('btnBatch').classList.toggle('active', selectMode);
  document.getElementById('batchBar').classList.toggle('hidden', !selectMode);
  const ball = document.getElementById('batchAll');
  if (ball) ball.checked = false;
  render();
}
function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id); else selectedIds.delete(id);
  updateBatchCount();
}
async function batchDelete() {
  if (syncing) { toast('同步中，请稍候', 'err'); return; }
  if (selectedIds.size === 0) { toast('未选择任何灵感', 'err'); return; }
  if (!confirm(`确定删除选中的 ${selectedIds.size} 条灵感？此操作公开且不可恢复。`)) return;
  if (!(await ensureToken('批量删除'))) return;
  const ids = new Set(selectedIds);
  const backup = DATA;
  DATA = DATA.filter(x => !ids.has(x.id));
  selectedIds.clear();
  render();
  toast('已删除选中', 'ok');
  beginSyncLock();
  try {
    await pushMerged(latest => latest.filter(x => !ids.has(x.id)));
  } catch (err) {
    DATA = backup; render();
    toast(err.message, 'err');
  }
  endSyncLock();
}

/* ---------- 自适应润色 ---------- */
function evaluateRoughness(t) {
  let score = 0;
  if (/[ \t]{2,}/.test(t)) score += 1;          // 多空格
  if (/[，。！？!?]{2,}/.test(t)) score += 1;     // 重复标点
  if (/[，。！？]\s*[，。！？]/ .test(t)) score += 1; // 中英文标点混排
  if (/(.)\1{3,}/.test(t)) score += 1;          // 重复字符
  if (t.length > 120) score += 1;               // 长文本
  if (/\n{3,}/.test(t)) score += 1;             // 多余空行
  if (/[a-zA-Z],[a-zA-Z]/.test(t)) score += 1;  // 英文逗号后无空格（粗糙）
  return score;
}
// 返回 {text, level:'light'|'medium'|'strong'}
function polishText(raw) {
  let t = (raw || '').replace(/\r\n/g, '\n').trim();
  const score = evaluateRoughness(t);
  const level = score <= 1 ? 'light' : score <= 3 ? 'medium' : 'strong';
  // 轻度：规整空白
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
  if (level !== 'light') {
    // 中度：中文语境下的 ASCII 标点转中文标点（避开小数 3.14）
    t = t.replace(/([一-鿿]),/g, '$1，')
         .replace(/([一-鿿])\.(?!\d|\.)/g, '$1。')
         .replace(/([一-鿿])\!(?!\=)/g, '$1！')
         .replace(/([一-鿿])\?(?!\=)/g, '$1？')
         .replace(/([一-鿿])\:/g, '$1：')
         .replace(/([一-鿿])\;/g, '$1；');
  }
  if (level === 'strong') {
    // 深度：折叠重复句末标点、去除连续重复行
    t = t.replace(/([。！？!?]){2,}/g, '$1');
    t = t.replace(/(.{2,})\n\1(\n|$)/g, '$1$2');
  }
  return { text: t, level };
}
function doPolish() {
  const ta = document.getElementById('f-content');
  const { text, level } = polishText(ta.value);
  ta.value = text;
  const name = { light: '轻度', medium: '中度', strong: '深度' }[level];
  toast('已润色（' + name + '）', 'ok');
}

/* ---------- 自动凝练标题 ---------- */
function genTitle(content) {
  const c = (content || '').trim();
  if (!c) return '';
  const m = c.match(/^(标题|主题|题目)\s*[:：]\s*(.+)$/m);
  if (m) return m[2].trim().slice(0, 40);
  const first = c.split(/[。！？!?\n]/)[0].trim();
  let title = first.length > 24 ? first.slice(0, 24) + '…' : first;
  if (!title) title = c.slice(0, 24);
  return title;
}
function genTitleFromContent() {
  const c = document.getElementById('f-content').value;
  const t = genTitle(c);
  if (!t) { toast('请先输入内容', 'err'); return; }
  document.getElementById('f-title').value = t;
  toast('已生成标题', 'ok');
}

/* ---------- 语音输入（Web Speech API） ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, micOn = false, voiceFinal = '';
function initVoice() {
  const mic = document.getElementById('btnMic');
  if (!mic) return;
  if (!SR) { mic.style.display = 'none'; return; }
  recog = new SR();
  recog.lang = 'zh-CN';
  recog.continuous = true;
  recog.interimResults = true;
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) voiceFinal += r[0].transcript; else interim += r[0].transcript;
    }
    const ta = document.getElementById('f-content');
    if (ta) ta.value = voiceFinal + interim;
  };
  recog.onend = () => { micOn = false; mic.classList.remove('rec'); };
  recog.onerror = (e) => {
    micOn = false; mic.classList.remove('rec');
    toast('语音识别：' + (e.error || '失败'), 'err');
  };
}
function toggleMic() {
  const mic = document.getElementById('btnMic');
  if (!recog) return;
  const ta = document.getElementById('f-content');
  if (micOn) { try { recog.stop(); } catch (x) {} return; }
  voiceFinal = ta ? ta.value : '';
  try { recog.start(); micOn = true; mic.classList.add('rec'); }
  catch (x) { toast('无法启动语音识别', 'err'); }
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
    const cached = JSON.parse(localStorage.getItem('insp_cache') || 'null');
    if (Array.isArray(cached)) { DATA = cached; render(); }
  } catch (e) {}
  try {
    DATA = await loadData();
    try { localStorage.setItem('insp_cache', JSON.stringify(DATA)); } catch (e) {}
    render();
  } catch (err) {
    if (!DATA.length) toast(err.message, 'err');
  }
}

/* ---------- 事件绑定 ---------- */
document.getElementById('btnNew').onclick = () => openForm(null);
document.getElementById('btnSettings').onclick = openSettings;
document.getElementById('btnBatch').onclick = toggleSelectMode;
document.getElementById('batchDelete').onclick = batchDelete;
document.getElementById('batchCancel').onclick = toggleSelectMode;
document.getElementById('batchAll').onchange = (e) => {
  const checked = e.target.checked;
  applyFilters().forEach(d => { if (checked) selectedIds.add(d.id); else selectedIds.delete(d.id); });
  render();
  const ball = document.getElementById('batchAll');
  if (ball) ball.checked = checked;
};
document.getElementById('btnMic').onclick = toggleMic;
document.getElementById('btnPolish').onclick = doPolish;
document.getElementById('btnGenTitle').onclick = genTitleFromContent;
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

initVoice();
init();
