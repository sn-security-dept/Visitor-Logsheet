/**
 * SN SECURITY DEPARTMENT — VISITORS LOGSHEET (Staff Entrance)
 * API backend. The frontend lives on GitHub Pages and calls this over fetch.
 *
 * FLOW (approval gate)
 *   Visitor registers          -> row saved as PENDING with a 4-char reference code.
 *   Security personnel approve -> badge issued, TIME IN stamped, STATUS = APPROVED.
 *   Security personnel deny    -> STATUS = DENIED, reason recorded, no badge, no time in.
 *   Visitor signs out          -> badge is the exit key, TIME OUT stamped, STATUS = CLOSED.
 *
 * FIRST TIME
 *   1. Run setup() from the editor.
 *   2. Set the security console PIN: see setSecurityPin(). It is stored in
 *      Script Properties, never in this file. Security actions fail until
 *      it is set.
 *   3. Deploy > New deployment > Web app > Execute as: Me > Access: Anyone.
 *   4. Paste the /exec URL into API_URL in index.html and security-console.html.
 *
 * UPGRADING FROM THE PRE-APPROVAL VERSION
 *   The sheet gained STATUS, SUBMITTED AT, APPROVED BY, DENIED REASON and
 *   REF CODE columns, and VERIFIED BY was replaced by APPROVED BY. Run
 *   rebuildSheet() once — it renames the old tab to "VISITOR LOG (old ...)"
 *   and builds a fresh one with the new layout. Old rows are NOT migrated.
 *
 * AFTER ANY CODE EDIT
 *   Deploy > Manage deployments > pencil > Version: New version > Deploy.
 *   Saving the file alone does NOT update the live URL.
 */

var CONFIG = {
  SHEET_NAME: 'VISITOR LOG',
  BADGE_SHEET: 'VALID BADGES',
  SIG_FOLDER: 'Visitor Signatures',
  TZ: 'Asia/Manila',
  BADGE_LENGTH: 4,                // badge numbers are padded to this many digits
  ENFORCE_BADGE_WHITELIST: false, // true = only numbers listed in VALID BADGES may be issued

  // ── Security console PIN ────────────────────────────────────────────────
  // LEAVE THIS EMPTY. It is a signpost only — nothing reads it, and a value
  // typed here would be published to the public repo, not applied.
  // The real PIN lives in Project Settings > Script Properties under the key
  // SECURITY_PIN. Set it once with setSecurityPin('....'); see that function.
  SECURITY_PIN: '',

  BRAND: '#DF6A2E',
  REF_LENGTH: 4,
  // No 0/O, 1/I/L, B/8, S/5, Z/2 confusion when read aloud or off a phone screen.
  REF_ALPHABET: 'ACDEFGHJKMNPQRTUVWXY23456789'
};

var ID_TYPES = [
  "Driver's License", 'UMID / SSS', 'PhilID / National ID', 'Passport',
  'PRC ID', 'Company ID', 'School ID', 'Postal ID', 'Voter’s ID', 'Other'
];

var PURPOSES = [
  'Job application', 'Interview', 'Meeting / appointment', 'Delivery',
  'Maintenance / contractor work', 'Training / seminar', 'Official business',
  'Document submission', 'Follow-up', 'Other'
];

var VISITOR_TYPES = ['Visitor', 'Contractor', 'Vendor / Supplier', 'Other'];

/** STATUS is a plain string so a state can be added later without a schema change. */
var STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', DENIED: 'DENIED', CLOSED: 'CLOSED' };

var COL = {
  BADGE: 1, ID_PRESENTED: 2, ID_NO: 3, DATE: 4, NAME: 5, VISITOR_TYPE: 6, COMPANY: 7,
  CONTACT_NO: 8, ADDRESS: 9, DEPT: 10, CONTACT: 11, PURPOSE: 12, STATUS: 13,
  SUBMITTED_AT: 14, TIME_IN: 15, SIG_IN: 16, TIME_OUT: 17, SIG_OUT: 18, REMARKS: 19,
  APPROVED_BY: 20, DENIED_REASON: 21, REF_CODE: 22, ENTRY_ID: 23
};
var LAST_COL = 23;

var HEADERS = [
  'SOLAIRE BADGE NUMBER', 'ID PRESENTED', 'ID NO.', 'DATE',
  'NAME (Last, First, MI)', 'VISITOR TYPE', 'COMPANY', 'CONTACT NO.', 'ADDRESS',
  'DEPARTMENT', 'CONTACT PERSON', 'PURPOSE OF VISIT', 'STATUS', 'SUBMITTED AT',
  'TIME IN', 'SIGNATURE (IN)', 'TIME OUT', 'SIGNATURE (OUT)', 'REMARKS',
  'APPROVED BY', 'DENIED REASON', 'REF CODE', 'ENTRY ID'
];

// ─── SETUP ─────────────────────────────────────────────────────────────────
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CONFIG.TZ);

  var sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  if (sh.getLastRow() === 0) writeHeaders_(sh);
  forceTextColumns_(sh);

  var bs = ss.getSheetByName(CONFIG.BADGE_SHEET) || ss.insertSheet(CONFIG.BADGE_SHEET);
  if (bs.getLastRow() === 0) {
    bs.getRange(1, 1, 1, 2).setValues([['BADGE NO.', 'STATUS']]).setFontWeight('bold');
    var seed = [];
    for (var i = 1; i <= 60; i++) seed.push([pad_(i), 'ACTIVE']);
    bs.getRange(2, 1, seed.length, 2).setValues(seed);
    bs.getRange(2, 1, seed.length, 1).setNumberFormat('@');
  }

  var it = DriveApp.getFoldersByName(CONFIG.SIG_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.SIG_FOLDER);
  PropertiesService.getScriptProperties().setProperty('SIG_FOLDER_ID', folder.getId());

  SpreadsheetApp.getUi().alert(
    'Setup complete.\n\nNext: Deploy > New deployment > Web app.\n' +
    'Then paste the /exec URL into index.html and security-console.html.'
  );
}

/** Run once when upgrading — archives the old tab and builds the new layout. */
function rebuildSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (old) old.setName(CONFIG.SHEET_NAME + ' (old ' + fmt_(new Date(), 'MMdd-HHmm') + ')');
  var sh = ss.insertSheet(CONFIG.SHEET_NAME);
  writeHeaders_(sh);
  forceTextColumns_(sh);
  SpreadsheetApp.getUi().alert('New sheet created. The old one was kept and renamed.');
}

function writeHeaders_(sh) {
  sh.getRange(1, 1, 1, LAST_COL).setValues([HEADERS])
    .setFontWeight('bold').setBackground(CONFIG.BRAND).setFontColor('#FFFFFF')
    .setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setColumnWidth(COL.BADGE, 160);
  sh.setColumnWidth(COL.NAME, 220);
  sh.setColumnWidth(COL.VISITOR_TYPE, 140);
  sh.setColumnWidth(COL.COMPANY, 170);
  sh.setColumnWidth(COL.CONTACT_NO, 130);
  sh.setColumnWidth(COL.ADDRESS, 260);
  sh.setColumnWidth(COL.CONTACT, 170);
  sh.setColumnWidth(COL.PURPOSE, 190);
  sh.setColumnWidth(COL.DENIED_REASON, 190);
  sh.hideColumns(COL.ENTRY_ID);
}

/**
 * Badge, date, ref-code and contact-number columns must be plain text. If
 * Sheets is allowed to parse them, 0010 becomes the number 10, 09-10-26
 * becomes a Date object, a ref code like 4E23 can be read as scientific
 * notation, and 09171234567 loses its leading zero — none of which match or
 * read correctly on the way out.
 */
function forceTextColumns_(sh) {
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, COL.BADGE, rows, 1).setNumberFormat('@');
  sh.getRange(2, COL.DATE, rows, 1).setNumberFormat('@');
  sh.getRange(2, COL.REF_CODE, rows, 1).setNumberFormat('@');
  sh.getRange(2, COL.CONTACT_NO, rows, 1).setNumberFormat('@');
}

// ─── HTTP ENTRY POINTS ─────────────────────────────────────────────────────
/**
 * The frontend POSTs a plain-text JSON string. Sending it as text/plain keeps
 * it a "simple request" so the browser skips the CORS preflight, which Apps
 * Script cannot answer. Never set a Content-Type header on the client.
 */
function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'config':   res = { ok: true, idTypes: ID_TYPES, purposes: PURPOSES,
                               visitorTypes: VISITOR_TYPES,
                               badgeLength: CONFIG.BADGE_LENGTH }; break;
      case 'register': res = register(req); break;
      case 'lookup':   res = lookupBadge(req.badgeNo); break;
      case 'checkout': res = checkOut(req); break;
      case 'today':    res = securityToday(req); break;
      case 'approve':  res = securityApprove(req); break;
      case 'deny':     res = securityDeny(req); break;
      case 'force':    res = securityForceOut(req); break;
      default:         res = { ok: false, message: 'Unknown action.' };
    }
  } catch (err) {
    console.error(err.stack || err);
    res = { ok: false, message: 'Server error. Please tell security personnel.' };
  }
  return json_(res);
}

function doGet() {
  return json_({ ok: true, service: 'Visitor Log API', time: fmt_(new Date(), 'yyyy-MM-dd HH:mm') });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── REGISTER (visitor, no badge yet) ──────────────────────────────────────
function register(d) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, message: 'System busy. Tap again.' };
  try {
    var v = validateRegistration_(d);
    if (!v.ok) return v;

    var now = new Date();
    var sh = logSheet_();
    var refCode = newRefCode_(sh);
    var sig = saveSig_(d.signature, refCode, 'IN');

    var row = new Array(LAST_COL).fill('');
    row[COL.ID_PRESENTED - 1] = d.idPresented;
    row[COL.ID_NO - 1]        = String(d.idNo || '').trim().toUpperCase();
    row[COL.DATE - 1]         = today_();
    row[COL.NAME - 1]         = name_(d.lastName, d.firstName, d.mi);
    row[COL.VISITOR_TYPE - 1] = otherOr_(d.visitorType, d.visitorTypeOther);
    row[COL.COMPANY - 1]      = String(d.company || '').trim().toUpperCase();
    row[COL.CONTACT_NO - 1]   = normPhone_(d.contactNo);
    row[COL.ADDRESS - 1]      = String(d.address || '').replace(/\s+/g, ' ').trim();
    row[COL.DEPT - 1]         = String(d.dept || '').trim().toUpperCase();
    row[COL.CONTACT - 1]      = String(d.contact || '').trim();
    row[COL.PURPOSE - 1]      = purpose_(d.purpose, d.purposeOther);
    row[COL.STATUS - 1]       = STATUS.PENDING;
    row[COL.SUBMITTED_AT - 1] = fmt_(now, 'h:mm a');
    row[COL.REMARKS - 1]      = String(d.remarks || '').trim();
    row[COL.REF_CODE - 1]     = refCode;
    row[COL.ENTRY_ID - 1]     = Utilities.getUuid().slice(0, 8).toUpperCase();

    sh.appendRow(row);
    var r = sh.getLastRow();

    // appendRow can let Sheets re-parse these. Force them back to text.
    sh.getRange(r, COL.BADGE).setNumberFormat('@');
    sh.getRange(r, COL.DATE).setNumberFormat('@').setValue(today_());
    sh.getRange(r, COL.REF_CODE).setNumberFormat('@').setValue(refCode);
    sh.getRange(r, COL.CONTACT_NO).setNumberFormat('@').setValue(row[COL.CONTACT_NO - 1]);
    if (sig) sh.getRange(r, COL.SIG_IN).setFormula(link_(sig));

    return { ok: true, refCode: refCode, name: row[COL.NAME - 1],
             submittedAt: row[COL.SUBMITTED_AT - 1] };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, message: 'Could not save. Please tell security personnel.' };
  } finally {
    lock.releaseLock();
  }
}

/** Random code from the unambiguous alphabet, e.g. "K7MX". Retries if today already has it. */
function newRefCode_(sh) {
  var used = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    var n = last - 1, t = today_();
    var dates = sh.getRange(2, COL.DATE, n, 1).getValues();
    var codes = sh.getRange(2, COL.REF_CODE, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (dateKey_(dates[i][0]) === t) used[String(codes[i][0]).toUpperCase()] = true;
    }
  }
  for (var tries = 0; tries < 50; tries++) {
    var code = '';
    for (var k = 0; k < CONFIG.REF_LENGTH; k++) {
      code += CONFIG.REF_ALPHABET.charAt(Math.floor(Math.random() * CONFIG.REF_ALPHABET.length));
    }
    if (!used[code]) return code;
  }
  throw new Error('Could not generate a unique reference code.');
}

// ─── LOOKUP (sign-out step 1) ──────────────────────────────────────────────
/**
 * The badge is the exit key only. Finds today's APPROVED row for that badge.
 * States: INVALID (bad input), NONE (no approved visit today), OPEN, CLOSED.
 */
function lookupBadge(raw) {
  var badgeNo = normBadge_(raw);
  if (!badgeNo) return { ok: true, state: 'INVALID', message: 'Enter your badge number.' };

  var hit = findOpenOrLast_(badgeNo);
  if (!hit) {
    return { ok: true, state: 'NONE', badgeNo: badgeNo,
             message: 'No approved visit found for badge ' + badgeNo + ' today. Please see security personnel.' };
  }
  if (hit.timeOut) {
    return { ok: true, state: 'CLOSED', badgeNo: badgeNo, name: hit.name, timeOut: hit.timeOut };
  }
  return { ok: true, state: 'OPEN', badgeNo: badgeNo, name: hit.name, dept: hit.dept,
           contact: hit.contact, purpose: hit.purpose, timeIn: hit.timeIn };
}

// ─── CHECK OUT (sign-out step 2) ───────────────────────────────────────────
function checkOut(d) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, message: 'System busy. Tap again.' };
  try {
    var badgeNo = normBadge_(d.badgeNo);
    if (!badgeNo) return { ok: false, message: 'Enter your badge number.' };
    if (!isPngDataUrl_(d.signature)) return { ok: false, message: 'Please sign before confirming.' };

    var hit = findOpenOrLast_(badgeNo);
    if (!hit) return { ok: false, message: 'No approved visit found for badge ' + badgeNo + ' today.' };
    if (hit.timeOut) return { ok: false, message: 'Badge ' + badgeNo + ' was timed out at ' + hit.timeOut + '.' };

    var now = new Date();
    var sh = logSheet_();
    var timeOut = fmt_(now, 'h:mm a');
    sh.getRange(hit.row, COL.TIME_OUT).setValue(timeOut);
    sh.getRange(hit.row, COL.SIG_OUT).setFormula(link_(saveSig_(d.signature, badgeNo, 'OUT')));
    sh.getRange(hit.row, COL.STATUS).setValue(STATUS.CLOSED);

    return { ok: true, badgeNo: badgeNo, name: hit.name, timeIn: hit.timeIn, timeOut: timeOut };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, message: 'Could not save. Please tell security personnel.' };
  } finally {
    lock.releaseLock();
  }
}

// ─── SECURITY PERSONNEL CONSOLE ────────────────────────────────────────────
/**
 * The PIN is read from Script Properties, never from code, so the public repo
 * holds no secret. If the property is missing or blank every security
 * console action is refused — fail closed, no default.
 */
function securityAuth_(d) {
  // CONFIG.SECURITY_PIN is never consulted. If someone typed a PIN there,
  // say so in the log — otherwise the console just says "Wrong PIN" forever.
  if (String(CONFIG.SECURITY_PIN || '').trim()) {
    console.warn('CONFIG.SECURITY_PIN is set but is never read. Clear it and ' +
                 'run setSecurityPin() instead — the PIN belongs in Script Properties.');
  }
  var stored = PropertiesService.getScriptProperties().getProperty('SECURITY_PIN');
  if (!stored || !String(stored).trim()) return false;
  return String(d && d.pin || '') === String(stored).trim();
}

/**
 * One-time operator step. From the Apps Script editor, add a temporary line
 * such as  function setPinOnce() { setSecurityPin('123456'); }  run it, then
 * delete that line so the value is not left in the source.
 */
function setSecurityPin(pin) {
  pin = String(pin == null ? '' : pin).trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4 to 8 digits.');
  PropertiesService.getScriptProperties().setProperty('SECURITY_PIN', pin);
  console.log('SECURITY_PIN stored in Script Properties.');
}

function securityName_(d) {
  return String(d && d.personnelName || 'SECURITY').trim().toUpperCase().slice(0, 40) || 'SECURITY';
}

/**
 * Today's rows split by status. pending is oldest-first (it is a queue);
 * inside, done and denied are newest-first. Any row whose STATUS is not one
 * of the four known values lands in unknown[] with its raw status, so a
 * hand-edited or future-state row is surfaced, never hidden.
 */
function securityToday(d) {
  if (!securityAuth_(d)) return { ok: false, message: 'Wrong PIN.' };

  var sh = logSheet_();
  var last = sh.getLastRow();
  var t = today_();
  if (last < 2) {
    return { ok: true, pending: [], inside: [], done: [], denied: [], unknown: [], today: t };
  }

  var vals = sh.getRange(2, 1, last - 1, LAST_COL).getValues();
  var pending = [], inside = [], done = [], denied = [], unknown = [];

  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (dateKey_(r[COL.DATE - 1]) !== t) continue;
    var item = {
      row: i + 2,
      status: status_(r[COL.STATUS - 1]),
      rawStatus: String(r[COL.STATUS - 1] == null ? '' : r[COL.STATUS - 1]),
      refCode: String(r[COL.REF_CODE - 1] || '').trim().toUpperCase(),
      badgeNo: normBadge_(r[COL.BADGE - 1]),
      name: r[COL.NAME - 1],
      visitorType: r[COL.VISITOR_TYPE - 1],
      company: r[COL.COMPANY - 1],
      contactNo: String(r[COL.CONTACT_NO - 1] == null ? '' : r[COL.CONTACT_NO - 1]),
      address: r[COL.ADDRESS - 1],
      idPresented: r[COL.ID_PRESENTED - 1],
      idNo: r[COL.ID_NO - 1],
      dept: r[COL.DEPT - 1],
      contact: r[COL.CONTACT - 1],
      purpose: r[COL.PURPOSE - 1],
      submittedAt: r[COL.SUBMITTED_AT - 1],
      timeIn: r[COL.TIME_IN - 1],
      timeOut: String(r[COL.TIME_OUT - 1] || '').trim(),
      remarks: r[COL.REMARKS - 1],
      approvedBy: r[COL.APPROVED_BY - 1],
      deniedReason: r[COL.DENIED_REASON - 1]
    };
    switch (item.status) {
      case STATUS.PENDING:  pending.push(item); break;
      case STATUS.APPROVED: (item.timeOut ? done : inside).push(item); break;
      case STATUS.CLOSED:   done.push(item); break;
      case STATUS.DENIED:   denied.push(item); break;
      default:              unknown.push(item);
    }
  }
  return { ok: true, pending: pending, inside: inside.reverse(), done: done.reverse(),
           denied: denied.reverse(), unknown: unknown.reverse(), today: t };
}

/**
 * Approve = issue a badge. Everything is re-read inside the lock: the row
 * must still be PENDING and dated today, the badge must pass the whitelist
 * (if enforced), and no other APPROVED row today may hold that badge.
 */
function securityApprove(d) {
  if (!securityAuth_(d)) return { ok: false, message: 'Wrong PIN.' };
  var badgeNo = normBadge_(d.badgeNo);
  if (!badgeNo) return { ok: false, message: 'Enter the badge number to issue.' };
  var row = rowArg_(d.row);
  if (!row) return { ok: false, message: 'Invalid row.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, message: 'Busy, try again.' };
  try {
    var sh = logSheet_();
    if (row > sh.getLastRow()) return { ok: false, message: 'Row not found.' };
    var r = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];

    if (dateKey_(r[COL.DATE - 1]) !== today_()) {
      return { ok: false, message: 'That registration is not from today.' };
    }
    var st = status_(r[COL.STATUS - 1]);
    if (st !== STATUS.PENDING) {
      return { ok: false, message: 'Already ' + (st || 'processed').toLowerCase() + '. Refresh the list.' };
    }
    if (CONFIG.ENFORCE_BADGE_WHITELIST && !isValidBadge_(badgeNo)) {
      return { ok: false, message: 'Badge ' + badgeNo + ' is not in the VALID BADGES list.' };
    }
    var holder = openHolder_(sh, badgeNo, row);
    if (holder) {
      return { ok: false, message: 'Badge ' + badgeNo + ' is still with ' + holder + '. Close that visit first.' };
    }

    var now = new Date();
    var timeIn = fmt_(now, 'h:mm a');
    sh.getRange(row, COL.BADGE).setNumberFormat('@').setValue(badgeNo);
    sh.getRange(row, COL.TIME_IN).setValue(timeIn);
    sh.getRange(row, COL.STATUS).setValue(STATUS.APPROVED);
    sh.getRange(row, COL.APPROVED_BY).setValue(securityName_(d));

    return { ok: true, badgeNo: badgeNo, name: r[COL.NAME - 1], timeIn: timeIn };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, message: 'Could not save. Try again.' };
  } finally {
    lock.releaseLock();
  }
}

/** Deny = no badge, no time in, reason recorded. Any badge in the request is ignored. */
function securityDeny(d) {
  if (!securityAuth_(d)) return { ok: false, message: 'Wrong PIN.' };
  var reason = String(d.reason || '').trim().slice(0, 200);
  if (!reason) return { ok: false, message: 'Enter a reason for denying.' };
  var row = rowArg_(d.row);
  if (!row) return { ok: false, message: 'Invalid row.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, message: 'Busy, try again.' };
  try {
    var sh = logSheet_();
    if (row > sh.getLastRow()) return { ok: false, message: 'Row not found.' };
    var r = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];

    if (dateKey_(r[COL.DATE - 1]) !== today_()) {
      return { ok: false, message: 'That registration is not from today.' };
    }
    var st = status_(r[COL.STATUS - 1]);
    if (st !== STATUS.PENDING) {
      return { ok: false, message: 'Already ' + (st || 'processed').toLowerCase() + '. Refresh the list.' };
    }

    sh.getRange(row, COL.STATUS).setValue(STATUS.DENIED);
    sh.getRange(row, COL.DENIED_REASON).setValue(reason);
    sh.getRange(row, COL.APPROVED_BY).setValue(securityName_(d));
    // Deliberately untouched: BADGE and TIME IN stay blank on a denied row.

    return { ok: true, name: r[COL.NAME - 1] };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, message: 'Could not save. Try again.' };
  } finally {
    lock.releaseLock();
  }
}

/** Security personnel close an APPROVED visit whose visitor left without signing out. */
function securityForceOut(d) {
  if (!securityAuth_(d)) return { ok: false, message: 'Wrong PIN.' };
  var row = rowArg_(d.row);
  if (!row) return { ok: false, message: 'Invalid row.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, message: 'Busy, try again.' };
  try {
    var sh = logSheet_();
    if (row > sh.getLastRow()) return { ok: false, message: 'Row not found.' };
    var r = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];

    if (status_(r[COL.STATUS - 1]) !== STATUS.APPROVED) {
      return { ok: false, message: 'Only an approved visit can be closed out.' };
    }
    if (String(r[COL.TIME_OUT - 1] || '').trim()) {
      return { ok: false, message: 'Already timed out.' };
    }

    var now = new Date();
    var timeOut = fmt_(now, 'h:mm a');
    var note = String(d.note || '').trim().slice(0, 200) || 'Manual time out';
    sh.getRange(row, COL.TIME_OUT).setValue(timeOut);
    sh.getRange(row, COL.SIG_OUT).setValue('CLOSED BY SECURITY');
    sh.getRange(row, COL.STATUS).setValue(STATUS.CLOSED);
    var prev = String(r[COL.REMARKS - 1] || '').trim();
    sh.getRange(row, COL.REMARKS)
      .setValue([prev, note + ' (' + securityName_(d) + ')'].filter(String).join(' | '));
    return { ok: true, timeOut: timeOut };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, message: 'Could not save. Try again.' };
  } finally {
    lock.releaseLock();
  }
}

// ─── BADGE NUMBER NORMALISATION ────────────────────────────────────────────
/**
 * Every badge number — typed by a visitor, read back from the sheet, or listed
 * in VALID BADGES — goes through here before any comparison. "10", "010",
 * " 10 " and "0010" all become "0010", so entry and exit always match.
 */
function normBadge_(v) {
  var digits = String(v == null ? '' : v).replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.slice(-CONFIG.BADGE_LENGTH);
  return pad_(parseInt(digits, 10));
}

function pad_(n) {
  var s = String(n);
  while (s.length < CONFIG.BADGE_LENGTH) s = '0' + s;
  return s;
}

/**
 * Sheets may hand back a Date object or a string depending on how the cell was
 * formatted when it was written. Normalise both to MM-dd-yy before comparing.
 */
function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'MM-dd-yy');
  return String(v == null ? '' : v).trim();
}

function status_(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

/** Row numbers from the client are only ever used after the row is re-read and re-checked. */
function rowArg_(v) {
  var n = Number(v);
  return (isFinite(n) && n >= 2 && n === Math.floor(n)) ? n : 0;
}

// ─── LOOKUP HELPERS ────────────────────────────────────────────────────────
/**
 * Scans today's rows bottom-up for the badge. Returns the open visit
 * (APPROVED, no time out) if there is one, otherwise the most recent closed
 * visit for that badge today. PENDING and DENIED rows never carry a badge and
 * are ignored even if one was typed into the sheet by hand.
 */
function findOpenOrLast_(badgeNo) {
  var sh = logSheet_();
  var last = sh.getLastRow();
  if (last < 2 || !badgeNo) return null;

  var n = last - 1;
  var badges = sh.getRange(2, COL.BADGE, n, 1).getValues();
  var dates  = sh.getRange(2, COL.DATE, n, 1).getValues();
  var stats  = sh.getRange(2, COL.STATUS, n, 1).getValues();
  var outs   = sh.getRange(2, COL.TIME_OUT, n, 1).getValues();
  var t = today_();
  var lastClosed = null;

  for (var i = n - 1; i >= 0; i--) {
    if (normBadge_(badges[i][0]) !== badgeNo) continue;
    if (dateKey_(dates[i][0]) !== t) continue;
    var st = status_(stats[i][0]);
    var row = i + 2;
    if (st === STATUS.APPROVED && !String(outs[i][0] || '').trim()) return readRow_(sh, row);  // open visit wins
    if ((st === STATUS.CLOSED || st === STATUS.APPROVED) && !lastClosed) lastClosed = row;
  }
  return lastClosed ? readRow_(sh, lastClosed) : null;
}

/** Name of whoever holds an open (APPROVED, no time out) visit today on this badge, else ''. */
function openHolder_(sh, badgeNo, skipRow) {
  var last = sh.getLastRow();
  if (last < 2) return '';
  var n = last - 1, t = today_();
  var vals = sh.getRange(2, 1, n, LAST_COL).getValues();
  for (var i = 0; i < n; i++) {
    var r = vals[i];
    if (i + 2 === skipRow) continue;
    if (normBadge_(r[COL.BADGE - 1]) !== badgeNo) continue;
    if (dateKey_(r[COL.DATE - 1]) !== t) continue;
    if (status_(r[COL.STATUS - 1]) !== STATUS.APPROVED) continue;
    if (String(r[COL.TIME_OUT - 1] || '').trim()) continue;
    return String(r[COL.NAME - 1] || 'another visitor');
  }
  return '';
}

function readRow_(sh, row) {
  var r = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
  return {
    row: row,
    status: status_(r[COL.STATUS - 1]),
    name: r[COL.NAME - 1],
    dept: r[COL.DEPT - 1],
    contact: r[COL.CONTACT - 1],
    purpose: r[COL.PURPOSE - 1],
    timeIn: r[COL.TIME_IN - 1],
    timeOut: String(r[COL.TIME_OUT - 1] || '').trim()
  };
}

function isValidBadge_(badgeNo) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('BADGES');
  var list;
  if (cached) {
    list = JSON.parse(cached);
  } else {
    var bs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.BADGE_SHEET);
    if (!bs || bs.getLastRow() < 2) return true;
    list = bs.getRange(2, 1, bs.getLastRow() - 1, 2).getValues()
      .filter(function (r) { return String(r[1]).toUpperCase() === 'ACTIVE'; })
      .map(function (r) { return normBadge_(r[0]); });
    cache.put('BADGES', JSON.stringify(list), 300);
  }
  return list.indexOf(badgeNo) !== -1;
}

// ─── MISC HELPERS ──────────────────────────────────────────────────────────
function logSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
}

function validateRegistration_(d) {
  if (!d || typeof d !== 'object') return { ok: false, message: 'Bad request.' };
  if (!String(d.lastName  || '').trim()) return { ok: false, message: 'Last name is required.' };
  if (!String(d.firstName || '').trim()) return { ok: false, message: 'First name is required.' };
  if (String(d.lastName).length > 60 || String(d.firstName).length > 60 || String(d.mi || '').length > 3) {
    return { ok: false, message: 'Name is too long.' };
  }
  if (VISITOR_TYPES.indexOf(d.visitorType) === -1) return { ok: false, message: 'Select the visitor type.' };
  if (d.visitorType === 'Other' && !String(d.visitorTypeOther || '').trim()) {
    return { ok: false, message: 'Please specify the visitor type.' };
  }
  if (String(d.visitorTypeOther || '').length > 60) return { ok: false, message: 'Visitor type is too long.' };
  if (ID_TYPES.indexOf(d.idPresented) === -1) return { ok: false, message: 'Select the ID you presented.' };
  if (!String(d.idNo    || '').trim()) return { ok: false, message: 'Enter your ID number.' };
  if (String(d.idNo).length > 40) return { ok: false, message: 'ID number is too long.' };
  if (!String(d.dept    || '').trim()) return { ok: false, message: 'Department is required.' };
  if (!String(d.contact || '').trim()) return { ok: false, message: 'Contact person is required.' };
  if (String(d.dept).length > 60 || String(d.contact).length > 80) {
    return { ok: false, message: 'Department or contact person is too long.' };
  }
  if (String(d.company || '').length > 80) return { ok: false, message: 'Company name is too long.' };
  if (!normPhone_(d.contactNo)) {
    return { ok: false, message: 'Enter a valid contact number (7 to 15 digits).' };
  }
  if (!String(d.address || '').trim()) return { ok: false, message: 'Address is required.' };
  if (String(d.address).length > 160) return { ok: false, message: 'Address is too long.' };
  if (PURPOSES.indexOf(d.purpose) === -1) return { ok: false, message: 'Select your purpose of visit.' };
  if (d.purpose === 'Other' && !String(d.purposeOther || '').trim()) {
    return { ok: false, message: 'Please describe your purpose of visit.' };
  }
  if (String(d.purposeOther || '').length > 120 || String(d.remarks || '').length > 200) {
    return { ok: false, message: 'Purpose or remarks is too long.' };
  }
  if (!isPngDataUrl_(d.signature)) return { ok: false, message: 'Please sign before submitting.' };
  return { ok: true };
}

/** Signatures must be a PNG data URL of a sane size (canvas output is well under 1 MB). */
function isPngDataUrl_(s) {
  s = String(s || '');
  return /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(s) && s.length > 100 && s.length < 1500000;
}

/**
 * Contact number: keeps an optional leading "+", drops spaces, dashes and
 * brackets, and requires 7 to 15 digits. Returns '' if invalid. Stored as
 * text so "0917..." keeps its leading zero.
 */
function normPhone_(v) {
  var s = String(v == null ? '' : v).trim();
  var plus = s.charAt(0) === '+' ? '+' : '';
  var digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return plus + digits;
}

/** "Other" choices are stored as "Other: <what the visitor typed>". */
function otherOr_(p, other) {
  if (p === 'Other') return 'Other: ' + String(other || '').replace(/\s+/g, ' ').trim();
  return String(p || '').trim();
}
function purpose_(p, other) { return otherOr_(p, other); }

function name_(last, first, mi) {
  var l = String(last  || '').trim().toUpperCase();
  var f = String(first || '').trim().toUpperCase();
  var m = String(mi    || '').trim().toUpperCase().replace(/\./g, '');
  return l + ', ' + f + (m ? ' ' + m + '.' : '');
}

/** tag = ref code for sign-in (no badge yet), badge number for sign-out. */
function saveSig_(dataUrl, tag, kind) {
  var b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png',
    tag + '_' + kind + '_' + fmt_(new Date(), 'yyyyMMdd_HHmmss') + '.png');
  var id = PropertiesService.getScriptProperties().getProperty('SIG_FOLDER_ID');
  var folder = id ? DriveApp.getFolderById(id) : DriveApp.getRootFolder();
  return folder.createFile(blob).getUrl();
}

function link_(url) { return '=HYPERLINK("' + url + '","Signature")'; }
function today_()   { return fmt_(new Date(), 'MM-dd-yy'); }
function fmt_(d, p) { return Utilities.formatDate(d, CONFIG.TZ, p); }

// ─── MAINTENANCE (run manually from the editor) ────────────────────────────
/** Repairs existing rows where the badge or date was stored in the wrong type. */
function repairExistingRows() {
  var sh = logSheet_(), last = sh.getLastRow();
  if (last < 2) return;
  var n = last - 1;

  var bRng = sh.getRange(2, COL.BADGE, n, 1);
  bRng.setNumberFormat('@')
      .setValues(bRng.getValues().map(function (r) { return [normBadge_(r[0])]; }));

  var dRng = sh.getRange(2, COL.DATE, n, 1);
  dRng.setNumberFormat('@')
      .setValues(dRng.getValues().map(function (r) { return [dateKey_(r[0])]; }));
}

/**
 * Trashes the Drive signature file of every DENIED row older than daysOld
 * days and writes PURGED into SIGNATURE (IN). A denied visitor never entered,
 * so there is no reason to keep their signature for the 5-year retention.
 * Manual run only — there is no trigger. Default: 30 days.
 * Files go to the Drive trash (DriveApp cannot hard-delete); Drive empties
 * trash after 30 days.
 */
function purgeDeniedSignatures(daysOld) {
  daysOld = Number(daysOld);
  if (!isFinite(daysOld) || daysOld < 0) daysOld = 30;

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  var cutoffKey = fmt_(cutoff, 'yyMMdd');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet busy. Try again.');
  try {
    var sh = logSheet_(), last = sh.getLastRow();
    if (last < 2) return 0;
    var n = last - 1;
    var dates  = sh.getRange(2, COL.DATE, n, 1).getValues();
    var stats  = sh.getRange(2, COL.STATUS, n, 1).getValues();
    var sigRng = sh.getRange(2, COL.SIG_IN, n, 1);
    var sigs   = sigRng.getFormulas();
    var sigVal = sigRng.getValues();
    var purged = 0;

    for (var i = 0; i < n; i++) {
      if (status_(stats[i][0]) !== STATUS.DENIED) continue;
      var key = sortableDate_(dateKey_(dates[i][0]));
      if (!key || key > cutoffKey) continue;
      var cell = sigs[i][0] || String(sigVal[i][0] || '');
      if (!cell || cell === 'PURGED') continue;

      var m = cell.match(/\/d\/([A-Za-z0-9_-]+)/) || cell.match(/[?&]id=([A-Za-z0-9_-]+)/);
      if (m) {
        try { DriveApp.getFileById(m[1]).setTrashed(true); }
        catch (e) { console.warn('Row ' + (i + 2) + ': file not found, marking PURGED anyway.'); }
      }
      sh.getRange(i + 2, COL.SIG_IN).setValue('PURGED');
      purged++;
    }
    console.log('purgeDeniedSignatures: ' + purged + ' row(s) purged (older than ' + daysOld + ' days).');
    return purged;
  } finally {
    lock.releaseLock();
  }
}

/** "MM-dd-yy" -> "yyMMdd" so dates compare as strings. Returns '' if unparseable. */
function sortableDate_(key) {
  var m = String(key).match(/^(\d{2})-(\d{2})-(\d{2})$/);
  return m ? m[3] + m[1] + m[2] : '';
}
