/**
 * Google Sheets CRM (Apps Script)
 *
 * This project creates and maintains a CRM workflow inside a spreadsheet with:
 * - CALL_SCREEN dashboard
 * - All_Customers overview
 * - TEMPLATE_CALLLOG template sheet
 * - One sheet per customer
 *
 * NOTE:
 * - Callback datetime prompt uses an HtmlService modal dialog.
 * - When callback dialog is cancelled, Result (column B) is reset to blank and callback datetime (column D) is cleared.
 */

// =========================
// Constants and Config
// =========================
const SYSTEM_SHEETS = ['CALL_SCREEN', 'All_Customers', 'TEMPLATE_CALLLOG'];
const RESULT_OPTIONS = ['No answer', 'Cant talk', 'Order', 'Call back'];
const DATA_START_ROW = 4;
const HEADER_ROW = 3;
const MAX_CALL_HISTORY = 20;

const CONFIG = {
  CALL_SCREEN: {
    NAME: 'CALL_SCREEN',
    CUSTOMER_LABEL_CELL: 'B3',
    CUSTOMER_PICKER_CELL: 'C3',
    INFO_RANGE: 'A1:F2',
    PENDING_TITLE_ROW: 6,
    PENDING_START_ROW: 7,
    UPCOMING_TITLE_ROW: 20,
    UPCOMING_START_ROW: 21,
    TABLE_HEADERS: ['Customer', 'Callback DateTime', 'Last Result', 'Last Comment', 'Link']
  },
  ALL_CUSTOMERS: {
    NAME: 'All_Customers'
  },
  TEMPLATE: {
    NAME: 'TEMPLATE_CALLLOG'
  },
  THROTTLE_SECONDS: 8,
  META: {
    LAST_REFRESH_KEY: 'LAST_REFRESH_EPOCH_MS',
    CALLBACK_TARGET_KEY: 'CALLBACK_TARGET_JSON'
  }
};

// =========================
// Entry Points / Menu
// =========================

/**
 * Installable onOpen trigger entry point.
 */
function onOpen() {
  buildMenu_();
}

/**
 * Installable onEdit trigger entry point.
 * Handles callback result edits and throttled dashboard refresh.
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (!isCustomerSheet_(sheet)) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < DATA_START_ROW) return;

  // Only single-cell edits get callback interaction.
  if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && col === 2) {
    handleResultEdit_(e);
  }

  // If Result/Comment/Callback changed, trigger throttled refresh.
  if (col >= 2 && col <= 4) {
    refreshDashboardsThrottled_();
  }
}

/**
 * Adds CRM menu.
 */
function buildMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('CRM')
    .addItem('Setup / Initialize CRM', 'setupCRM')
    .addItem('Open Customer (from CALL_SCREEN)', 'menuOpenCustomerFromCallScreen')
    .addItem('Refresh Dashboards', 'refreshDashboards')
    .addItem('Go to CALL_SCREEN', 'goToCallScreen')
    .addToUi();
}

// =========================
// Setup / Initialization
// =========================

/**
 * One-click setup: creates required sheets, formatting, validations, and triggers.
 */
function setupCRM() {
  const ss = SpreadsheetApp.getActive();
  ensureSystemSheets_(ss);

  const callScreen = ss.getSheetByName(CONFIG.CALL_SCREEN.NAME);
  const allCustomers = ss.getSheetByName(CONFIG.ALL_CUSTOMERS.NAME);
  const templateSheet = ss.getSheetByName(CONFIG.TEMPLATE.NAME);

  formatCallScreen_(callScreen);
  formatTemplateSheet_(templateSheet);
  formatAllCustomersSheet_(allCustomers);

  installTriggers();
  refreshDashboards();

  SpreadsheetApp.getUi().alert('CRM setup complete. Use CALL_SCREEN to open/create customer logs.');
}

/**
 * Creates required sheets if missing.
 */
function ensureSystemSheets_(ss) {
  SYSTEM_SHEETS.forEach(function(name) {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
    }
  });
}

/**
 * Ensures CALL_SCREEN layout is stable and user-friendly.
 */
function formatCallScreen_(sheet) {
  sheet.clear();

  // Top instructions / action hints.
  const infoValues = [
    ['CRM Dashboard', 'Use CRM menu: Open Customer (from CALL_SCREEN)', '', 'Refresh via CRM menu', '', ''],
    ['Tip: Enter/select customer in C3', 'Then run Open Customer action', '', '', '', '']
  ];
  sheet.getRange(CONFIG.CALL_SCREEN.INFO_RANGE).setValues(infoValues).setFontWeight('bold');

  sheet.getRange(CONFIG.CALL_SCREEN.CUSTOMER_LABEL_CELL).setValue('Customer').setFontWeight('bold');
  sheet.getRange(CONFIG.CALL_SCREEN.CUSTOMER_PICKER_CELL).setValue('');

  // Pending block
  sheet.getRange(CONFIG.CALL_SCREEN.PENDING_TITLE_ROW, 1).setValue('Pending callbacks (Today)').setFontWeight('bold');
  sheet
    .getRange(CONFIG.CALL_SCREEN.PENDING_START_ROW, 1, 1, CONFIG.CALL_SCREEN.TABLE_HEADERS.length)
    .setValues([CONFIG.CALL_SCREEN.TABLE_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');

  // Upcoming block
  sheet.getRange(CONFIG.CALL_SCREEN.UPCOMING_TITLE_ROW, 1).setValue('Upcoming callbacks').setFontWeight('bold');
  sheet
    .getRange(CONFIG.CALL_SCREEN.UPCOMING_START_ROW, 1, 1, CONFIG.CALL_SCREEN.TABLE_HEADERS.length)
    .setValues([CONFIG.CALL_SCREEN.TABLE_HEADERS])
    .setFontWeight('bold')
    .setBackground('#cfe2f3');

  sheet.setFrozenRows(3);
  sheet.setColumnWidths(1, 1, 220); // Customer
  sheet.setColumnWidths(2, 1, 170); // Callback DateTime
  sheet.setColumnWidths(3, 1, 130); // Last Result
  sheet.setColumnWidths(4, 1, 320); // Last Comment
  sheet.setColumnWidths(5, 1, 240); // Link

  updateCallScreenDropdown_();
}

/**
 * Ensures TEMPLATE_CALLLOG has exact required headers and formatting.
 */
function formatTemplateSheet_(sheet) {
  sheet.clear();

  // Header row exact requirements
  sheet.getRange(HEADER_ROW, 1, 1, 4).setValues([
    ['Date/Time Opened', 'Result', 'Comment', 'Callback Date/Time']
  ]);

  styleCustomerSheet_(sheet);
}

/**
 * Ensures All_Customers exists and has header format.
 */
function formatAllCustomersSheet_(sheet) {
  sheet.clear();
  const headers = buildAllCustomersHeaders_();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f4cccc');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 1, 220);
  sheet.setColumnWidths(2, 1, 170);
  sheet.setColumnWidths(3, 1, 140);
  sheet.setColumnWidths(4, 1, 170);
}

/**
 * Installs onOpen/onEdit installable triggers once.
 */
function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  const triggers = ScriptApp.getProjectTriggers();

  const hasOnOpen = triggers.some(function(t) {
    return t.getHandlerFunction() === 'onOpen' && t.getEventType() === ScriptApp.EventType.ON_OPEN;
  });
  const hasOnEdit = triggers.some(function(t) {
    return t.getHandlerFunction() === 'onEdit' && t.getEventType() === ScriptApp.EventType.ON_EDIT;
  });

  if (!hasOnOpen) {
    ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  }
  if (!hasOnEdit) {
    ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();
  }
}

// =========================
// Menu Handlers
// =========================

/**
 * Reads customer name from CALL_SCREEN C3 and opens/creates customer.
 */
function menuOpenCustomerFromCallScreen() {
  const ss = SpreadsheetApp.getActive();
  const callScreen = ss.getSheetByName(CONFIG.CALL_SCREEN.NAME);
  if (!callScreen) {
    SpreadsheetApp.getUi().alert('CALL_SCREEN sheet missing. Run Setup / Initialize CRM first.');
    return;
  }

  const rawCustomer = String(callScreen.getRange(CONFIG.CALL_SCREEN.CUSTOMER_PICKER_CELL).getValue() || '').trim();
  if (!rawCustomer) {
    SpreadsheetApp.getUi().alert('Please enter/select a customer in CALL_SCREEN!C3.');
    return;
  }

  openOrCreateCustomer(rawCustomer);
}

/**
 * Navigates user back to CALL_SCREEN and refreshes dashboards.
 */
function goToCallScreen() {
  const ss = SpreadsheetApp.getActive();
  const callScreen = ss.getSheetByName(CONFIG.CALL_SCREEN.NAME);
  if (!callScreen) return;

  ss.setActiveSheet(callScreen);
  callScreen.setActiveSelection(CONFIG.CALL_SCREEN.CUSTOMER_PICKER_CELL);
  refreshDashboards();
}

// =========================
// Customer Operations
// =========================

/**
 * Opens existing customer sheet or creates from template, then appends a new call row.
 * @param {string} customerName Raw customer name from dashboard input.
 */
function openOrCreateCustomer(customerName) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActive();
    ensureTemplateExists_(ss);

    const finalSheet = getOrCreateCustomerSheet_(ss, customerName);
    appendCallRow(finalSheet);

    ss.setActiveSheet(finalSheet);
    finalSheet.setActiveSelection(DATA_START_ROW + ':' + DATA_START_ROW);

    refreshDashboardsThrottled_(true);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Appends a new call row at first empty row in A:D block, starting row DATA_START_ROW.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function appendCallRow(sheet) {
  const row = findFirstEmptyLogRow_(sheet);

  sheet.getRange(row, 1).setValue(new Date());
  sheet.getRange(row, 2, 1, 3).clearContent();

  applyResultValidation_(sheet, DATA_START_ROW, Math.max(sheet.getLastRow(), DATA_START_ROW + 300));
  styleCustomerSheet_(sheet);
}

/**
 * Handles edit in result column for callback UX.
 */
function handleResultEdit_(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const row = range.getRow();
  const newValue = String(range.getValue() || '').trim();

  if (newValue === 'Call back') {
    // Store target row/sheet for dialog callback submission.
    setPendingCallbackTarget_(sheet.getName(), row);
    showCallbackDialog_();
    return;
  }

  // If moved away from "Call back", clear callback datetime.
  sheet.getRange(row, 4).clearContent();
}

// =========================
// Callback Dialog Flow
// =========================

/**
 * Opens callback datetime picker dialog.
 */
function showCallbackDialog_() {
  const html = HtmlService.createHtmlOutputFromFile('CallbackDialog')
    .setWidth(360)
    .setHeight(230);
  SpreadsheetApp.getUi().showModalDialog(html, 'Set Callback Date/Time');
}

/**
 * Called by CallbackDialog.html on submit.
 * @param {string} isoLikeValue expected from <input type="datetime-local">
 */
function submitCallbackDateTime(isoLikeValue) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const target = getPendingCallbackTarget_();
    if (!target) throw new Error('Callback target not found. Please set Result to "Call back" again.');

    const dt = parseDatetimeLocal_(isoLikeValue);
    if (!dt) throw new Error('Invalid date/time. Please provide a valid value.');

    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(target.sheetName);
    if (!sheet) throw new Error('Customer sheet no longer exists.');

    const row = target.row;
    if (row < DATA_START_ROW) throw new Error('Invalid callback row.');

    // Write actual Date object.
    sheet.getRange(row, 4).setValue(dt);

    clearPendingCallbackTarget_();
    refreshDashboardsThrottled_(true);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Called by CallbackDialog.html on cancel.
 * Resets Result to blank and clears callback date for robustness.
 */
function cancelCallbackDateTime() {
  const target = getPendingCallbackTarget_();
  if (!target) return { ok: true };

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(target.sheetName);
  if (sheet && target.row >= DATA_START_ROW) {
    sheet.getRange(target.row, 2).clearContent();
    sheet.getRange(target.row, 4).clearContent();
  }

  clearPendingCallbackTarget_();
  refreshDashboardsThrottled_();
  return { ok: true };
}

// =========================
// Dashboard Refresh
// =========================

/**
 * Full refresh orchestrator.
 */
function refreshDashboards() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;

  try {
    updateCallScreenDropdown_();
    refreshCallScreen();
    refreshAllCustomers();
    PropertiesService.getDocumentProperties().setProperty(CONFIG.META.LAST_REFRESH_KEY, String(Date.now()));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Refresh with throttling to avoid too-frequent heavy updates.
 * @param {boolean=} force Set true to bypass throttle.
 */
function refreshDashboardsThrottled_(force) {
  if (force) {
    refreshDashboards();
    return;
  }

  const props = PropertiesService.getDocumentProperties();
  const last = Number(props.getProperty(CONFIG.META.LAST_REFRESH_KEY) || '0');
  const now = Date.now();

  if (now - last < CONFIG.THROTTLE_SECONDS * 1000) return;
  refreshDashboards();
}

/**
 * Renders pending/upcoming callbacks on CALL_SCREEN.
 */
function refreshCallScreen() {
  const ss = SpreadsheetApp.getActive();
  const callScreen = ss.getSheetByName(CONFIG.CALL_SCREEN.NAME);
  if (!callScreen) return;

  // Clear old table data only (keep headers/layout)
  clearTableData_(callScreen, CONFIG.CALL_SCREEN.PENDING_START_ROW + 1, CONFIG.CALL_SCREEN.UPCOMING_TITLE_ROW - 1, 5);
  clearTableData_(callScreen, CONFIG.CALL_SCREEN.UPCOMING_START_ROW + 1, Math.max(callScreen.getMaxRows(), CONFIG.CALL_SCREEN.UPCOMING_START_ROW + 500), 5);

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  const pending = [];
  const upcoming = [];

  getCustomerSheets_(ss).forEach(function(sheet) {
    const customer = sheet.getName();
    const log = readCustomerLog_(sheet);
    if (!log.length) return;

    const lastCall = getLatestCallRecord_(log);
    const lastResult = lastCall ? lastCall.result : '';
    const lastComment = lastCall ? lastCall.comment : '';

    log.forEach(function(r) {
      if (!(r.callback instanceof Date)) return;
      const dKey = Utilities.formatDate(r.callback, tz, 'yyyy-MM-dd');
      const row = [
        customer,
        r.callback,
        lastResult,
        lastComment,
        '=HYPERLINK("#gid=' + sheet.getSheetId() + '","Open")'
      ];

      if (dKey === todayKey) pending.push(row);
      else if (r.callback.getTime() > now.getTime()) upcoming.push(row);
    });
  });

  const dateAsc = function(a, b) {
    return a[1].getTime() - b[1].getTime();
  };
  pending.sort(dateAsc);
  upcoming.sort(dateAsc);

  if (pending.length) {
    callScreen
      .getRange(CONFIG.CALL_SCREEN.PENDING_START_ROW + 1, 1, pending.length, 5)
      .setValues(pending);
  }

  if (upcoming.length) {
    callScreen
      .getRange(CONFIG.CALL_SCREEN.UPCOMING_START_ROW + 1, 1, upcoming.length, 5)
      .setValues(upcoming);
  }

  // Date formatting for datetime columns in both sections.
  callScreen.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Builds All_Customers summary table.
 */
function refreshAllCustomers() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.ALL_CUSTOMERS.NAME);
  if (!sh) return;

  const headers = buildAllCustomersHeaders_();
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f4cccc');

  const now = new Date();
  const out = [];

  getCustomerSheets_(ss).forEach(function(sheet) {
    const log = readCustomerLog_(sheet);
    const callsDesc = log
      .filter(function(r) {
        return r.opened instanceof Date;
      })
      .sort(function(a, b) {
        return b.opened.getTime() - a.opened.getTime();
      });

    const latest = callsDesc.length ? callsDesc[0] : null;
    const nextCallback = findNearestFutureCallback_(log, now);

    const row = [
      sheet.getName(),
      latest ? latest.opened : '',
      latest ? latest.result : '',
      nextCallback || ''
    ];

    for (var i = 0; i < MAX_CALL_HISTORY; i++) {
      const call = callsDesc[i];
      row.push(call ? call.opened : '');
      row.push(call ? call.result : '');
    }

    out.push(row);
  });

  out.sort(function(a, b) {
    return String(a[0]).localeCompare(String(b[0]));
  });

  if (out.length) {
    sh.getRange(2, 1, out.length, headers.length).setValues(out);
  }

  sh.getRange(2, 2, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(2, 4, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // Apply date format to call history date columns.
  for (var c = 5; c < headers.length + 1; c += 2) {
    sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
}

// =========================
// Utilities
// =========================

/**
 * Returns customer sheets (all non-system sheets).
 */
function getCustomerSheets_(ss) {
  return ss.getSheets().filter(function(sheet) {
    return SYSTEM_SHEETS.indexOf(sheet.getName()) === -1;
  });
}

/**
 * Parses A:D log rows into objects.
 */
function readCustomerLog_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const numRows = lastRow - DATA_START_ROW + 1;
  const values = sheet.getRange(DATA_START_ROW, 1, numRows, 4).getValues();

  return values
    .map(function(r) {
      return {
        opened: r[0],
        result: r[1],
        comment: r[2],
        callback: r[3]
      };
    })
    .filter(function(item) {
      return item.opened || item.result || item.comment || item.callback;
    });
}

/**
 * Returns latest call by opened datetime.
 */
function getLatestCallRecord_(log) {
  const dated = log.filter(function(r) {
    return r.opened instanceof Date;
  });
  if (!dated.length) return null;
  dated.sort(function(a, b) {
    return b.opened.getTime() - a.opened.getTime();
  });
  return dated[0];
}

/**
 * Finds nearest future callback from log.
 */
function findNearestFutureCallback_(log, now) {
  const future = log
    .map(function(r) {
      return r.callback;
    })
    .filter(function(v) {
      return v instanceof Date && v.getTime() > now.getTime();
    })
    .sort(function(a, b) {
      return a.getTime() - b.getTime();
    });

  return future.length ? future[0] : null;
}

/**
 * Updates CALL_SCREEN customer dropdown from existing customer sheet names.
 */
function updateCallScreenDropdown_() {
  const ss = SpreadsheetApp.getActive();
  const callScreen = ss.getSheetByName(CONFIG.CALL_SCREEN.NAME);
  if (!callScreen) return;

  const names = getCustomerSheets_(ss)
    .map(function(s) {
      return s.getName();
    })
    .sort();

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(names.length ? names : [''], true)
    .setAllowInvalid(true)
    .build();

  callScreen.getRange(CONFIG.CALL_SCREEN.CUSTOMER_PICKER_CELL).setDataValidation(rule);
}

/**
 * Returns existing customer sheet or creates one from template copy.
 */
function getOrCreateCustomerSheet_(ss, rawName) {
  const cleanBase = sanitizeName_(rawName) || 'Unnamed Customer';

  // If exact sanitized sheet already exists, use it.
  let existing = ss.getSheetByName(cleanBase);
  if (existing && isCustomerSheet_(existing)) return existing;

  // If user typed exact existing customer sheet name, use it directly.
  const direct = ss.getSheetByName(rawName);
  if (direct && isCustomerSheet_(direct)) return direct;

  const template = ensureTemplateExists_(ss);
  const finalName = generateUniqueSheetName_(ss, cleanBase);

  const newSheet = template.copyTo(ss).setName(finalName);
  styleCustomerSheet_(newSheet);
  applyResultValidation_(newSheet, DATA_START_ROW, Math.max(DATA_START_ROW + 300, newSheet.getMaxRows()));

  return newSheet;
}

/**
 * Makes sure TEMPLATE_CALLLOG exists and is correctly formatted.
 */
function ensureTemplateExists_(ss) {
  let template = ss.getSheetByName(CONFIG.TEMPLATE.NAME);
  if (!template) template = ss.insertSheet(CONFIG.TEMPLATE.NAME);
  formatTemplateSheet_(template);
  return template;
}

/**
 * True only for customer sheets.
 */
function isCustomerSheet_(sheet) {
  return !!sheet && SYSTEM_SHEETS.indexOf(sheet.getName()) === -1;
}

/**
 * Sheet-name sanitizer: remove invalid chars []:*?/\, trim spaces, max 100 chars.
 */
function sanitizeName_(value) {
  return String(value || '')
    .replace(/[\[\]\:\*\?\/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/**
 * Generates unique sheet name with suffix " (2)", " (3)", ... if needed.
 */
function generateUniqueSheetName_(ss, baseName) {
  if (!ss.getSheetByName(baseName)) return baseName;

  let i = 2;
  while (i < 10000) {
    const suffix = ' (' + i + ')';
    const maxBaseLength = 100 - suffix.length;
    const candidate = baseName.substring(0, maxBaseLength) + suffix;
    if (!ss.getSheetByName(candidate)) return candidate;
    i++;
  }

  throw new Error('Could not generate a unique sheet name.');
}

/**
 * Finds first empty row in call log based on column A from DATA_START_ROW.
 */
function findFirstEmptyLogRow_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), DATA_START_ROW);
  const numRows = lastRow - DATA_START_ROW + 1;
  const values = sheet.getRange(DATA_START_ROW, 1, numRows, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) return DATA_START_ROW + i;
  }
  return lastRow + 1;
}

/**
 * Apply result dropdown validation to column B for a target row range.
 */
function applyResultValidation_(sheet, startRow, endRow) {
  const rowCount = Math.max(1, endRow - startRow + 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(RESULT_OPTIONS, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(startRow, 2, rowCount, 1).setDataValidation(rule);
}

/**
 * Common style for customer sheets + template.
 */
function styleCustomerSheet_(sheet) {
  sheet.setFrozenRows(3);
  sheet.getRange(HEADER_ROW, 1, 1, 4).setFontWeight('bold').setBackground('#fff2cc');
  sheet.setColumnWidths(1, 1, 170);
  sheet.setColumnWidths(2, 1, 150);
  sheet.setColumnWidths(3, 1, 340);
  sheet.setColumnWidths(4, 1, 180);
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('D:D').setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Clears table rows for A:width columns between two row bounds.
 */
function clearTableData_(sheet, startRow, endRow, width) {
  if (endRow < startRow) return;
  const rows = endRow - startRow + 1;
  sheet.getRange(startRow, 1, rows, width).clearContent();
}

/**
 * Build headers for All_Customers (CALL1 = most recent, descending by date).
 */
function buildAllCustomersHeaders_() {
  const headers = ['Customer', 'Last Contact', 'Last Result', 'Next Callback'];
  for (var i = 1; i <= MAX_CALL_HISTORY; i++) {
    headers.push('CALL' + i + '_Date');
    headers.push('CALL' + i + '_Result');
  }
  return headers;
}

/**
 * Parse datetime-local string (e.g. "2026-01-30T14:00") into Date.
 */
function parseDatetimeLocal_(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Store pending callback target for dialog submit/cancel.
 */
function setPendingCallbackTarget_(sheetName, row) {
  const payload = JSON.stringify({ sheetName: sheetName, row: row });
  PropertiesService.getDocumentProperties().setProperty(CONFIG.META.CALLBACK_TARGET_KEY, payload);
}

/**
 * Read pending callback target.
 */
function getPendingCallbackTarget_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(CONFIG.META.CALLBACK_TARGET_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.sheetName || !obj.row) return null;
    return obj;
  } catch (err) {
    return null;
  }
}

/**
 * Clear pending callback target.
 */
function clearPendingCallbackTarget_() {
  PropertiesService.getDocumentProperties().deleteProperty(CONFIG.META.CALLBACK_TARGET_KEY);
}
