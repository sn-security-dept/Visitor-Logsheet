# Changes — approval gate

The badge is no longer the entry key. A visitor registers first, waits for
security personnel, and only receives a Solaire badge on approval. The badge remains
the exit key.

## Flow

```
Visitor: Register ─────────────► row = PENDING, ref code shown on screen
Security: Approve (badge no.) ──► row = APPROVED, badge + TIME IN + APPROVED BY written
Security: Deny (reason) ────────► row = DENIED, reason + APPROVED BY written, no badge, no time in
Visitor: Sign out (badge no.) ─► row = CLOSED, TIME OUT + SIGNATURE (OUT) written
Security: Close out ────────────► row = CLOSED, TIME OUT written, SIGNATURE (OUT) = CLOSED BY SECURITY
```

DENIED and CLOSED are terminal. Security personnel approve alone; there is no
"waiting on department" state. A denied visitor may register again the same
day; the server does not block on name or ID match.

## Sheet schema (`VISITOR LOG`)

Old layout had 15 columns. New layout has 23. Asterisks mark new columns.

| # | Header | Notes |
|---|---|---|
| 1 | SOLAIRE BADGE NUMBER | Blank until approval. Text format. |
| 2 | ID PRESENTED | |
| 3 | ID NO. | |
| 4 | DATE | Text format, `MM-dd-yy`, stamped server-side at registration. |
| 5 | NAME (Last, First, MI) | |
| 6 | * VISITOR TYPE | Required. `Visitor`, `Contractor`, `Vendor / Supplier`, or `Other: <text>`. |
| 7 | * COMPANY | Optional. Upper-cased. |
| 8 | * CONTACT NO. | Required. Visitor's phone. Text format so a leading 0 survives. |
| 9 | * ADDRESS | Required. One free-text line, max 160 chars, whitespace collapsed. |
| 10 | DEPARTMENT | |
| 11 | CONTACT PERSON | |
| 12 | PURPOSE OF VISIT | |
| 13 | * STATUS | `PENDING`, `APPROVED`, `DENIED`, `CLOSED`. Plain string. |
| 14 | * SUBMITTED AT | `h:mm a`, server time at registration. |
| 15 | TIME IN | Stamped at approval, not registration. |
| 16 | SIGNATURE (IN) | Captured at registration. `PURGED` after purge. |
| 17 | TIME OUT | |
| 18 | SIGNATURE (OUT) | |
| 19 | REMARKS | Close-out note is appended as `note (SECURITY PERSONNEL NAME)`. |
| 20 | * APPROVED BY | Security personnel name on Approve or Deny. Replaces VERIFIED BY. |
| 21 | * DENIED REASON | |
| 22 | * REF CODE | 4 chars, text format. |
| 23 | ENTRY ID | Hidden, unchanged. |

The visitor type list lives in `VISITOR_TYPES` in `Code.gs` and is served by
the `config` action, the same way ID types and purposes are. Choosing
`Other` requires a short description, which is stored as `Other: <text>`,
matching how purpose already works.

Contact number is normalised server-side: an optional leading `+` is kept,
spaces, dashes and brackets are dropped, and 7 to 15 digits are required.
The security personnel console renders it as a tap-to-call link.

VERIFIED BY is gone. The Verify button and `verify` action are gone; approval
is now the verification act.

## Migration steps

Old rows are **not** migrated. The old tab is kept for reference.

1. Paste the new `Code.gs` into the Apps Script editor and save.
2. Set the security console PIN (one time, see the next section). Security
   actions are refused until this is done.
3. Run `rebuildSheet()` once from the editor. It renames the current
   `VISITOR LOG` tab to `VISITOR LOG (old MMdd-HHmm)` and creates a fresh
   `VISITOR LOG` with the 19-column layout, header styling, frozen row,
   hidden ENTRY ID, and text format on BADGE, DATE, CONTACT NO. and REF CODE.
4. Deploy > Manage deployments > pencil > Version: New version > Deploy.
   Saving alone does not update the live URL.
5. Publish the new `index.html` and `security-console.html` to GitHub Pages. The
   `API_URL` constant is unchanged if the deployment ID did not change.
6. Do the rebuild during a quiet period. Anyone inside on the old sheet at
   the moment of rebuild cannot sign out through the app, because lookups
   only read the new tab. Time them out by hand on the old tab.

## Security console PIN is now a Script Property

The repo is public, so the PIN no longer lives in `Code.gs`.
There is no `CONFIG` field for it at all, so it cannot be read from source.
`securityAuth_` reads the Script Property `SECURITY_PIN` and returns false
when it is missing or blank. There is no default PIN.

One-time setup, in the Apps Script editor:

1. Add a temporary line at the bottom of `Code.gs`:
   ```
   function setPinOnce() { setSecurityPin('YOUR_PIN'); }
   ```
   The PIN must be 4 to 8 digits.
2. Select `setPinOnce` in the function dropdown and run it. Authorise when
   prompted. The log shows "SECURITY_PIN stored in Script Properties."
3. Delete the temporary line and save. Do not commit it.
4. Verify under Project Settings > Script Properties that `SECURITY_PIN` exists.

To change the PIN later, repeat the steps or edit the property directly in
Project Settings. No redeploy is needed; properties are read on every request.

## Secrets review

- Security console PIN: Script Property, see above.
- Drive signature folder ID: Script Property `SIG_FOLDER_ID`, written by
  `setup()`. Not in any committed file.
- Spreadsheet ID: never referenced. The script is container-bound and uses
  `getActiveSpreadsheet()`.
- `/exec` URL: committed as the `PASTE_YOUR_DEPLOYMENT_ID` placeholder. The
  real URL is a public endpoint by design and is safe to publish once pasted.

`setup()` still works for a brand-new spreadsheet. `repairExistingRows()` is
unchanged and still only touches BADGE and DATE.

## API actions

| Action | Who | Notes |
|---|---|---|
| `config` | visitor | Now also returns `visitorTypes`. |
| `register` | visitor | New. Replaces `checkin`. No badge field. Returns `refCode`, `name`, `submittedAt`. |
| `lookup` | visitor | Sign-out step 1. States: `INVALID`, `NONE`, `OPEN`, `CLOSED`. `NEW` no longer exists. |
| `checkout` | visitor | Matches only today's `APPROVED` row for the badge. Sets `CLOSED`. |
| `today` | security | Returns `pending` (oldest first), `inside`, `done`, `denied`, `unknown` (newest first). |
| `approve` | security | New. Needs `row` and `badgeNo`. |
| `deny` | security | New. Needs `row` and non-empty `reason`. Ignores any badge in the request. |
| `force` | security | Close out. Now refuses rows that are not `APPROVED`. Sets `CLOSED`. |
| `verify` | — | Removed. |

All security console actions are PIN-checked by `securityAuth_`. All writes run inside
`LockService.getScriptLock()`. Approve re-reads the row inside the lock,
requires it to be `PENDING` and dated today, checks `VALID BADGES` when
`ENFORCE_BADGE_WHITELIST` is true, and scans today's rows for any other
`APPROVED` row with the same normalised badge and blank TIME OUT. If found it
refuses with the holder's name.

## Unrecognised STATUS values

Any row dated today whose STATUS is not one of the four known values is
returned in `unknown[]` with its raw cell text. The security personnel console shows an
**Unrecognised** tab, with a count, only when that list is non-empty, plus a
notice above the tabs. This is deliberate: a row that vanishes from the
console is worse than a mislabelled one. Fix the cell in the sheet.

Sign-out and Approve still ignore such rows, so an unrecognised row can
neither hold a badge nor be signed out until its STATUS is corrected.

## Reference code

- Alphabet: `ACDEFGHJKMNPQRTUVWXY23456789` (28 symbols, no 0/O, 1/I/L, B/8,
  S/5, Z/2). Four characters, so 614,656 combinations.
- Uniqueness is checked against today's rows only. Codes may repeat across
  days.
- **Retry limit: 50 attempts.** On each attempt a fresh random code is drawn
  and compared with the set of codes already used today. If all 50 collide
  the server throws, `register` catches it, and the visitor sees
  "Could not save. Please tell security personnel." No row is written and no
  signature file is created, because the code is generated before either.
  With fewer than a few thousand registrations a day the chance of 50
  consecutive collisions is effectively zero.
- The ref code is shown large on the visitor's screen and is searchable in
  the Pending tab. The server never uses it as a lookup key; security personnel act
  on the sheet row number, which is re-validated inside the lock.

## Signature purge for denied rows

`purgeDeniedSignatures(daysOld)` is a manual maintenance function. Run it
from the Apps Script editor. There is no trigger.

- Default `daysOld` is 30 when called with no argument. To run with another
  value, add a one-line wrapper in the editor such as
  `function purge90() { purgeDeniedSignatures(90); }` and run that.
- It scans rows with `STATUS = DENIED` whose DATE is on or before today
  minus `daysOld`, extracts the Drive file ID from the SIGNATURE (IN)
  hyperlink, trashes the file, and writes `PURGED` into the cell.
- Rows already marked `PURGED` are skipped. A missing file is logged and the
  cell is still marked `PURGED`.
- Runs inside the script lock. Returns the number of rows purged and logs it.

**Retention limitation.** `DriveApp` cannot permanently delete a file. The
purge sends files to the Drive trash, and Drive empties trash automatically
after 30 days. Until then the file is recoverable by the account owner.
Hard deletion would require the Advanced Drive service, which is not
enabled by decision for the pilot.

## Visitor page (`index.html`)

- Landing screen offers **Register** and **Sign out**. No badge field.
- Registration is a four-step wizard with a progress bar. No badge field.
  1. **Personal**: name, visitor type (with "Other, please specify"),
     company (optional), contact number, address (a single text box).
  2. **Identification**: ID presented, ID number.
  3. **Visit**: department, contact person, purpose (with "Other"), remarks.
  4. **Review and sign**: every answer grouped by step with an Edit button
     per group, then the signature pad and consent text, then Submit.
- Each step validates before Next, mirroring the server rules. The first
  failing field is outlined, focused, and scrolled into view. The server
  still validates everything again on submit and is the authority.
  Consent text unchanged. Client-side `maxlength` mirrors the server limits.
- Edit from the review page opens that step with a "Save and review" button
  that returns straight to the review. Back on step 1 cancels.
- Enter in a text field advances the step. The Submit button is disabled
  while the request is in flight so a double tap cannot create two rows.
- The success screen shows the ref code large, then the name, then the three
  instructions. No time in is shown.
- Sign out asks for the badge only, then handles `OPEN`, `NONE`, `CLOSED`,
  `INVALID` and any unexpected response.
- No polling. The page never checks its own approval status.
- Fetch body is a plain string with no `Content-Type` header. Unchanged.

## Security personnel console (`security-console.html`)

- Tabs: Pending (default, oldest first, count in label), Inside, Signed out,
  Denied, Unrecognised (only when non-empty, count in label).
- Approve and Deny open an inline input in the row's Actions cell. Deny's
  submit button stays disabled until the reason is non-empty. Enter submits,
  Escape cancels. Server errors show under the input.
- Search fields per tab. Pending matches ref code, name, department, ID
  number. Denied also matches the reason.
- Sortable columns, 20-second refresh, PIN gate, session-stored PIN and
  security personnel name, and minutes-since-midnight time sorting are kept.
- If the 20-second refresh drops the row someone is acting on out of
  Pending (another session handled it), the inline form is dismissed.

## Server-side validation added

- Length caps: names 60, M.I. 3, visitor type "Other" text 60, ID number 40, company 80, address 160, department 60, contact 80,
  purpose description 120, remarks 200, deny reason 200, close-out note 200,
  security personnel name 40.
- Signatures must be a PNG data URL between 100 bytes and 1.5 MB on both
  register and checkout. Previously any truthy value was accepted.
- Row numbers from the client must be integers of 2 or more and are only
  used after the row is re-read and its status and date re-checked.

## Assumptions made

- Approve and Deny both write the security personnel name into APPROVED BY. The column
  is named for the common case; the Denied tab labels it "Denied by".
- Approve refuses a PENDING row that is not dated today, so a stale row from
  a previous day cannot be issued a badge by accident.
- Close out appends the security personnel name to the remark, e.g.
  `Left without scanning (JUAN)`.
- Ref codes are compared case-insensitively on the server but are always
  generated upper-case.
- Signature files for registrations are named by ref code
  (`K7MX_IN_20260910_143000.png`) since no badge exists yet. Sign-out files
  keep the badge number.
- `ENFORCE_BADGE_WHITELIST` remains `false` by default. When `true`, an empty
  `VALID BADGES` tab still allows every badge, as before.
- A PIN of 4 to 8 digits is enforced by `setSecurityPin`. Editing the Script
  Property by hand bypasses that check; `securityAuth_` only requires it to be
  non-blank.
