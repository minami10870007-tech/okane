/**
 * 借入金・貸付金 かんたん管理（Google Apps Script）
 *
 * 種別は4つだけ:
 *   貸した / 返してもらった / 借りた / 返した
 * 相手ごとの残高 = (貸した - 返してもらった) - (借りた - 返した)
 *   プラス → 相手から返してもらう額（貸付残高）
 *   マイナス → 相手に返す額（借入残高）
 */

const SHEET_NAME = '取引';
const HEADERS = ['ID', '日付', '相手', '種別', '金額', 'メモ', '登録日時'];
const TYPES = ['貸した', '返してもらった', '借りた', '返した'];

/** スプレッドシートを開いたときにメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💰 お金管理')
    .addItem('アプリを開く', 'showSidebar')
    .addItem('シートを初期化', 'setup')
    .addToUi();
}

/** サイドバーで表示 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Index').setTitle('借入・貸付 管理');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** ウェブアプリとして公開したときの入口 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('借入・貸付 管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 取引シートを用意（なければ作成） */
function setup() {
  getSheet_();
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('E:E').setNumberFormat('#,##0');
    sheet.getRange('G:G').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  return sheet;
}

/** 全取引を取得（新しい順） */
function getRecords_() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      date: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1]),
      person: String(r[2]),
      type: String(r[3]),
      amount: Number(r[4]) || 0,
      memo: String(r[5]),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 相手ごとの残高 */
function summarize_(records) {
  const map = {};
  records.forEach(r => {
    const s = (map[r.person] = map[r.person] || { person: r.person, lent: 0, borrowed: 0 });
    if (r.type === '貸した') s.lent += r.amount;
    if (r.type === '返してもらった') s.lent -= r.amount;
    if (r.type === '借りた') s.borrowed += r.amount;
    if (r.type === '返した') s.borrowed -= r.amount;
  });
  return Object.values(map)
    .map(s => Object.assign(s, { balance: s.lent - s.borrowed }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/** 画面表示用のデータをまとめて返す */
function getData() {
  const records = getRecords_();
  const summary = summarize_(records);
  return {
    records: records,
    summary: summary,
    totalLent: summary.reduce((t, s) => t + s.lent, 0),
    totalBorrowed: summary.reduce((t, s) => t + s.borrowed, 0),
    types: TYPES,
  };
}

/** 取引を追加 */
function addRecord(form) {
  const person = String(form.person || '').trim();
  const amount = Number(form.amount);
  if (!person) throw new Error('相手を入力してください');
  if (TYPES.indexOf(form.type) < 0) throw new Error('種別が不正です');
  if (!(amount > 0)) throw new Error('金額は1以上で入力してください');

  const date = form.date ? new Date(form.date + 'T00:00:00') : new Date();
  getSheet_().appendRow([
    Utilities.getUuid().slice(0, 8),
    date,
    person,
    form.type,
    amount,
    String(form.memo || ''),
    new Date(),
  ]);
  return getData();
}

/** 取引を削除 */
function deleteRecord(id) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last >= 2) {
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(id)) {
        sheet.deleteRow(i + 2);
        break;
      }
    }
  }
  return getData();
}
