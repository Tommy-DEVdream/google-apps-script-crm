var DbService = (function() {
  var SCHEMA = {
    CONFIG: ['key', 'value'],
    USERS: ['userId', 'username', 'passwordHash', 'passwordSalt', 'role', 'isActive', 'createdAt', 'lastLoginAt'],
    CUSTOMER_LISTS: ['listId', 'listName', 'createdAt'],
    CUSTOMERS: ['customerId', 'listId', 'customerName', 'phone', 'notes', 'isActive'],
    ASSIGNMENTS: ['assignmentId', 'userId', 'listId', 'createdAt'],
    CALL_LOGS: ['logId', 'customerId', 'userId', 'callAt', 'result', 'comment', 'callbackAt', 'createdAt'],
    SESSIONS: ['sessionId', 'userId', 'expiresAt', 'createdAt']
  };

  function getSpreadsheet() {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
    var id = PropertiesService.getScriptProperties().getProperty('DB_SPREADSHEET_ID');
    if (!id) {
      throw new Error('No active spreadsheet. Set ScriptProperty DB_SPREADSHEET_ID for standalone scripts.');
    }
    return SpreadsheetApp.openById(id);
  }

  function ensureSchema() {
    var ss = getSpreadsheet();
    Object.keys(SCHEMA).forEach(function(sheetName) {
      var headers = SCHEMA[sheetName];
      var sh = ss.getSheetByName(sheetName);
      if (!sh) {
        sh = ss.insertSheet(sheetName);
      }
      var existing = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
      headers.forEach(function(h, idx) {
        if (existing[idx] !== h) {
          sh.getRange(1, idx + 1).setValue(h);
        }
      });
      if (sh.getLastColumn() < headers.length) {
        sh.insertColumnsAfter(sh.getLastColumn() || 1, headers.length - sh.getLastColumn());
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    });
  }

  function getSheet(sheetName) {
    var sh = getSpreadsheet().getSheetByName(sheetName);
    if (!sh) {
      throw new Error('Missing sheet: ' + sheetName);
    }
    return sh;
  }

  function getHeaders(sheetName) {
    return SCHEMA[sheetName].slice();
  }

  function readAll(sheetName) {
    var sh = getSheet(sheetName);
    var headers = getHeaders(sheetName);
    var lastRow = sh.getLastRow();
    if (lastRow <= 1) return [];
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    return values.map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) {
        obj[h] = row[i];
      });
      return obj;
    });
  }

  function append(sheetName, obj) {
    var sh = getSheet(sheetName);
    var headers = getHeaders(sheetName);
    var row = headers.map(function(h) {
      return obj[h] !== undefined ? obj[h] : '';
    });
    sh.appendRow(row);
  }

  function updateById(sheetName, idColumn, idValue, patchObj) {
    var sh = getSheet(sheetName);
    var headers = getHeaders(sheetName);
    var idIdx = headers.indexOf(idColumn);
    if (idIdx === -1) throw new Error('Unknown id column: ' + idColumn);

    var lastRow = sh.getLastRow();
    if (lastRow <= 1) throw new Error('Record not found.');

    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var rowIndex = -1;
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][idIdx]) === String(idValue)) {
        rowIndex = i + 2;
        break;
      }
    }
    if (rowIndex === -1) throw new Error('Record not found.');

    Object.keys(patchObj).forEach(function(key) {
      var idx = headers.indexOf(key);
      if (idx !== -1) {
        sh.getRange(rowIndex, idx + 1).setValue(patchObj[key]);
      }
    });
  }

  function replaceAll(sheetName, objs) {
    var sh = getSheet(sheetName);
    var headers = getHeaders(sheetName);
    sh.clearContents();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (!objs || !objs.length) return;
    var rows = objs.map(function(obj) {
      return headers.map(function(h) {
        return obj[h] !== undefined ? obj[h] : '';
      });
    });
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  function generateId() {
    return Utilities.getUuid();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseDate(value) {
    if (!value) return null;
    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function normalizeBool(value) {
    return String(value).toLowerCase() === 'true';
  }

  return {
    SCHEMA: SCHEMA,
    ensureSchema: ensureSchema,
    getSpreadsheet: getSpreadsheet,
    readAll: readAll,
    append: append,
    updateById: updateById,
    replaceAll: replaceAll,
    generateId: generateId,
    nowIso: nowIso,
    parseDate: parseDate,
    normalizeBool: normalizeBool
  };
})();
