'use strict';

/* ===== 設定の保存（この端末のブラウザだけに保存） ===== */
const STORE_KEY = 'okane.config.v1';
const TYPES = ['貸した', '返してもらった', '借りた', '返した'];
const OUT_TYPES = ['貸した', '返した']; // 手元からお金が出ていく種別
const PAGE = 30;

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
function saveConfig(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* プライベートモード等 */ }
}

let config = loadConfig();
let data = null;
let filterPerson = null;
let shown = PAGE;
let showSettled = false;

/* ===== ユーティリティ ===== */
const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${+m[2]}月${+m[3]}日(${'日月火水木金土'[d.getDay()]})`;
}
function fmtMonth(s) {
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${m[1]}年${+m[2]}月` : 'その他';
}

let toastTimer;
function toast(msg, isError) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4500 : 2400);
}

/* ===== API ===== */
async function callApi(action, payload, cfg = config) {
  if (cfg.demo) return demoApi(action, payload);
  const ctrl = new AbortController();
  // GAS は初回（コールドスタート）に数十秒かかることがあるので長めに待つ
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      // text/plain にすることで CORS のプリフライトを回避（GAS は OPTIONS に応答できない）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: cfg.token }, payload)),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`通信エラー（${res.status}）`);
    let json;
    try { json = await res.json(); } catch (e) {
      throw new Error('APIから正しい応答がありません。URLとデプロイ設定（アクセス: 全員）を確認してください');
    }
    if (!json.ok) throw new Error(json.error || 'エラーが発生しました');
    return json.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました。API URL をブラウザで直接開いて応答を確認してください');
    if (e instanceof TypeError) throw new Error('接続できませんでした。URLとネットワークを確認してください');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ===== デモ（ブラウザ内だけで動く） ===== */
const demo = (() => {
  const d = (offset) => { const t = new Date(); t.setDate(t.getDate() - offset); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  let n = 0;
  const r = (off, person, type, amount, memo = '') => ({ id: 'demo' + (++n), date: d(off), person, type, amount, memo });
  return [
    r(1, '田中さん', '貸した', 3000, 'ランチ代'),
    r(3, '佐藤さん', '借りた', 12000, '旅行の立替'),
    r(6, '田中さん', '返してもらった', 2000),
    r(9, '鈴木さん', '貸した', 5000, '飲み会'),
    r(15, '佐藤さん', '返した', 4000),
    r(24, '母', '借りた', 30000, 'PC購入'),
    r(33, '鈴木さん', '返してもらった', 5000),
    r(40, '田中さん', '貸した', 8000, 'チケット'),
  ];
})();

function buildData(records) {
  const sorted = records.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const map = {};
  sorted.forEach((r) => {
    const s = (map[r.person] = map[r.person] || { person: r.person, lent: 0, borrowed: 0 });
    if (r.type === '貸した') s.lent += r.amount;
    if (r.type === '返してもらった') s.lent -= r.amount;
    if (r.type === '借りた') s.borrowed += r.amount;
    if (r.type === '返した') s.borrowed -= r.amount;
  });
  const summary = Object.values(map)
    .map((s) => Object.assign(s, { balance: s.lent - s.borrowed }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return {
    records: sorted,
    summary,
    totalLent: summary.reduce((t, s) => t + s.lent, 0),
    totalBorrowed: summary.reduce((t, s) => t + s.borrowed, 0),
    types: TYPES,
  };
}

async function demoApi(action, payload) {
  if (action !== 'list') await new Promise((r) => setTimeout(r, 250)); // 書き込み時だけ通信っぽい待ち時間
  if (action === 'add') {
    const rec = payload.record;
    demo.push({ id: 'demo' + Date.now(), date: rec.date, person: rec.person.trim(), type: rec.type, amount: Number(rec.amount), memo: rec.memo || '' });
  }
  if (action === 'delete') {
    const i = demo.findIndex((r) => r.id === payload.id);
    if (i >= 0) demo.splice(i, 1);
  }
  return buildData(demo);
}

/* ===== 描画 ===== */
const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7L7 17M7 9v8h8"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

function render() {
  if (!data) return;
  renderHero();
  renderPeople();
  renderHistory();
}

function renderHero() {
  const net = data.totalLent - data.totalBorrowed;
  const el = $('netAmount');
  el.className = 'hero-amount' + (net > 0 ? ' is-pos' : net < 0 ? ' is-neg' : '');
  el.innerHTML = `<span class="sign">${net > 0 ? '+' : net < 0 ? '−' : ''}</span>${yen(net)}`;
  $('netCaption').textContent =
    net > 0 ? 'トータルで受け取る側です' : net < 0 ? 'トータルで返す側です' : data.records.length ? 'すべて精算済みです' : 'まだ記録がありません';
  $('totalLent').textContent = yen(Math.max(0, data.totalLent));
  $('totalBorrowed').textContent = yen(Math.max(0, data.totalBorrowed));
}

function renderPeople() {
  const list = $('summary');
  list.removeAttribute('aria-busy');
  const open = data.summary.filter((s) => s.balance !== 0);
  const settled = data.summary.filter((s) => s.balance === 0);
  $('peopleMeta').textContent = data.summary.length ? `${open.length}人と貸し借り中` : '';

  // 入力補助（datalist と最近の相手チップ）
  const names = [];
  data.records.forEach((r) => { if (!names.includes(r.person)) names.push(r.person); });
  $('people').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
  renderChips(names.slice(0, 8));

  if (!data.summary.length) {
    list.innerHTML = `<li class="empty"><div class="empty-icon" aria-hidden="true">👥</div>まだ相手がいません<br>左のフォームから記録してみましょう</li>`;
    return;
  }
  const row = (s) => {
    const cls = s.balance > 0 ? 'pos' : s.balance < 0 ? 'neg' : 'zero';
    const tag = s.balance > 0 ? '返してもらう' : s.balance < 0 ? '返す' : '精算済み';
    const pressed = filterPerson === s.person;
    return `<li><button class="person" type="button" data-person="${esc(s.person)}" aria-pressed="${pressed}">
      <span class="avatar" data-h="${hue(s.person)}" aria-hidden="true">${esc([...s.person][0] || '?')}</span>
      <span class="person-main">
        <span class="person-name">${esc(s.person)}</span>
        <span class="person-sub">${pressed ? '絞り込み中' : '履歴を見る'}</span>
      </span>
      <span class="person-amt">
        <span class="amt amt-${cls}">${yen(s.balance)}</span><br>
        <span class="tag tag-${cls}">${tag}</span>
      </span>
    </button></li>`;
  };
  let html = open.map(row).join('');
  if (!open.length) html = `<li class="empty"><div class="empty-icon" aria-hidden="true">🎉</div>貸し借りはすべて精算済みです</li>`;
  if (settled.length) {
    html += `<li><button class="settled-toggle" type="button" id="settledToggle" aria-expanded="${showSettled}">精算済み ${settled.length}人 ${showSettled ? 'を隠す ▲' : 'を表示 ▼'}</button></li>`;
    if (showSettled) html += settled.map(row).join('');
  }
  list.innerHTML = html;
  // CSP（style-src 'self'）でインライン style 属性は使えないので CSSOM で設定
  list.querySelectorAll('.avatar').forEach((a) => a.style.setProperty('--h', a.dataset.h));
}

function renderChips(names) {
  const current = $('person').value.trim();
  $('personChips').hidden = !names.length;
  $('personChips').innerHTML = names
    .map((n) => `<button class="chip" type="button" data-name="${esc(n)}" aria-pressed="${n === current}">${esc(n)}</button>`)
    .join('');
}

function renderHistory() {
  const box = $('records');
  box.removeAttribute('aria-busy');
  const recs = filterPerson ? data.records.filter((r) => r.person === filterPerson) : data.records;
  $('filterChip').hidden = !filterPerson;
  $('filterName').textContent = filterPerson || '';

  if (!recs.length) {
    box.innerHTML = `<div class="empty"><div class="empty-icon" aria-hidden="true">📝</div>まだ記録がありません</div>`;
    $('moreBtn').hidden = true;
    return;
  }
  let html = '';
  let month = '';
  recs.slice(0, shown).forEach((r) => {
    const m = fmtMonth(r.date);
    if (m !== month) { html += `<h3 class="month">${m}</h3>`; month = m; }
    const out = OUT_TYPES.includes(r.type);
    html += `<div class="rec" data-id="${esc(r.id)}">
      <span class="rec-icon ${out ? 'out' : 'in'}">${out ? ICON_OUT : ICON_IN}</span>
      <div class="rec-main">
        <div class="rec-person">${esc(r.person)}</div>
        <div class="rec-sub"><span class="rec-type">${esc(r.type)}</span><span class="rec-date">${esc(fmtDate(r.date))}</span>${r.memo ? '・' + esc(r.memo) : ''}</div>
      </div>
      <div class="rec-right">
        <span class="amt ${out ? 'amt-neg' : 'amt-pos'}">${out ? '−' : '+'}${yen(r.amount)}</span>
        <button class="del-btn" type="button" data-del="${esc(r.id)}" aria-label="${esc(r.person)}の${esc(r.type)} ${yen(r.amount)}を削除">${ICON_TRASH}</button>
      </div>
    </div>`;
  });
  box.innerHTML = html;
  const rest = recs.length - shown;
  $('moreBtn').hidden = rest <= 0;
  $('moreBtn').textContent = `もっと見る（残り${rest}件）`;
}

function setMode() {
  const connected = !!(config.demo || (config.url && config.token));
  $('onboarding').hidden = connected;
  $('appLeft').hidden = !connected;
  $('appRight').hidden = !connected;
  $('modeBadge').hidden = !config.demo;
  $('refreshBtn').hidden = !connected;
  $('disconnectBtn').hidden = !connected || !!config.demo;
  $('demoToggle').textContent = config.demo ? 'デモを終了' : 'デモで試す';
}

/* ===== 読み込み ===== */
let loading = false;
async function load(silent) {
  if (loading || !(config.demo || (config.url && config.token))) return;
  loading = true;
  $('refreshBtn').classList.add('spinning');
  try {
    data = await callApi('list', {});
    render();
    if (!silent) toast('最新の情報に更新しました');
  } catch (e) {
    toast(e.message, true);
    if (!data) {
      $('records').innerHTML = `<div class="empty"><div class="empty-icon" aria-hidden="true">⚠️</div>${esc(e.message)}</div>`;
      $('summary').innerHTML = '';
    }
  } finally {
    loading = false;
    $('refreshBtn').classList.remove('spinning');
  }
}

/* ===== フォーム ===== */
function amountValue() { return Number($('amount').value.replace(/[^\d]/g, '')); }

function showFormError(msg, field) {
  const el = $('formError');
  el.textContent = msg;
  el.hidden = !msg;
  ['amount', 'person', 'date'].forEach((id) => $(id).removeAttribute('aria-invalid'));
  if (field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
}

async function onSubmit(ev) {
  ev.preventDefault();
  const type = document.querySelector('input[name="type"]:checked').value;
  const amount = amountValue();
  const person = $('person').value.trim();
  const date = $('date').value || today();
  if (!(amount > 0)) return showFormError('金額を入力してください', 'amount');
  if (!person) return showFormError('相手を入力してください', 'person');
  showFormError('');

  const btn = $('submitBtn');
  btn.classList.add('loading');
  try {
    data = await callApi('add', { record: { type, person, amount, date, memo: $('memo').value.trim() } });
    shown = PAGE;
    render();
    $('amount').value = '';
    $('memo').value = '';
    toast(`${person}「${type}」${yen(amount)} を記録しました`);
  } catch (e) {
    showFormError(e.message);
  } finally {
    btn.classList.remove('loading');
  }
}

async function onDelete(id) {
  const r = data.records.find((x) => x.id === id);
  if (!r || !confirm(`${r.person}「${r.type}」${yen(r.amount)}（${fmtDate(r.date)}）を削除しますか？`)) return;
  const row = document.querySelector(`.rec[data-id="${CSS.escape(id)}"]`);
  if (row) row.classList.add('removing');
  try {
    data = await callApi('delete', { id });
    if (filterPerson && !data.records.some((x) => x.person === filterPerson)) filterPerson = null;
    render();
    toast('削除しました');
  } catch (e) {
    if (row) row.classList.remove('removing');
    toast(e.message, true);
  }
}

/* ===== 設定 ===== */
function openSettings() {
  $('apiUrl').value = config.url || '';
  $('apiToken').value = config.token || '';
  $('settingsError').hidden = true;
  $('settingsDialog').showModal();
}

async function onSettingsClose(ev) {
  const submitter = ev.submitter;
  if (!submitter || submitter.value !== 'save') return; // キャンセル
  ev.preventDefault();
  const url = $('apiUrl').value.trim();
  const token = $('apiToken').value.trim();
  const err = $('settingsError');
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)) {
    err.textContent = 'URLは https://script.google.com/macros/s/…/exec の形式で入力してください';
    err.hidden = false;
    $('apiUrl').focus();
    return;
  }
  if (!token) {
    err.textContent = 'APIトークンを入力してください';
    err.hidden = false;
    $('apiToken').focus();
    return;
  }
  const cfg = { url, token };
  const btn = $('settingsSave');
  btn.classList.add('loading');
  err.hidden = true;
  try {
    data = await callApi('list', {}, cfg);
    config = cfg;
    saveConfig(config);
    $('settingsDialog').close();
    setMode();
    resetView();
    render();
    toast('スプレッドシートに接続しました');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.classList.remove('loading');
  }
}

function resetView() { filterPerson = null; shown = PAGE; showSettled = false; }

function startDemo() {
  config = { demo: true };
  saveConfig(config);
  data = null;
  resetView();
  setMode();
  load(true);
  toast('デモモードです。データはこの画面の中だけで動きます');
}

/* ===== イベント ===== */
document.addEventListener('DOMContentLoaded', () => {
  $('date').value = today();
  // ?demo 付きで開いたら、未接続の場合だけデモを開始
  if (/[?&]demo\b/.test(location.search) && !config.url) config = { demo: true };
  setMode();
  load(true);

  $('recordForm').addEventListener('submit', onSubmit);
  $('refreshBtn').addEventListener('click', () => load(false));
  $('settingsBtn').addEventListener('click', openSettings);
  $('onboardConnect').addEventListener('click', openSettings);
  $('onboardDemo').addEventListener('click', startDemo);
  $('settingsForm').addEventListener('submit', onSettingsClose);

  $('demoToggle').addEventListener('click', () => {
    $('settingsDialog').close();
    if (config.demo) {
      config = {};
      saveConfig(config);
      data = null;
      setMode();
      toast('デモを終了しました');
    } else {
      startDemo();
    }
  });
  $('disconnectBtn').addEventListener('click', () => {
    if (!confirm('この端末から接続設定を削除しますか？（スプレッドシートのデータは消えません）')) return;
    config = {};
    saveConfig(config);
    data = null;
    $('settingsDialog').close();
    setMode();
    toast('接続を解除しました');
  });

  // ダイアログの外側タップで閉じる
  $('settingsDialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // 金額：数字以外を除去して3桁区切り
  $('amount').addEventListener('input', (e) => {
    const digits = e.target.value.replace(/[^\d０-９]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/^0+/, '').slice(0, 10);
    e.target.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
    e.target.removeAttribute('aria-invalid');
  });
  $('person').addEventListener('input', () => {
    $('person').removeAttribute('aria-invalid');
    document.querySelectorAll('#personChips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.name === $('person').value.trim())));
  });

  $('personChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('person').value = chip.dataset.name;
    $('person').dispatchEvent(new Event('input'));
  });

  $('summary').addEventListener('click', (e) => {
    if (e.target.closest('#settledToggle')) { showSettled = !showSettled; renderPeople(); return; }
    const btn = e.target.closest('.person');
    if (!btn) return;
    filterPerson = filterPerson === btn.dataset.person ? null : btn.dataset.person;
    shown = PAGE;
    renderPeople();
    renderHistory();
    if (filterPerson && window.matchMedia('(max-width: 899px)').matches) {
      $('historyTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('filterChip').addEventListener('click', () => { filterPerson = null; shown = PAGE; renderPeople(); renderHistory(); });
  $('records').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) onDelete(del.dataset.del);
  });
  $('moreBtn').addEventListener('click', () => { shown += PAGE; renderHistory(); });

  // スクロールでトップバーに境界線
  const bar = document.querySelector('.topbar');
  const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  // 画面に戻ってきたら最新化
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data) load(true); });
});
