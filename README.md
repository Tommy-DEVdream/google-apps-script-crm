# Google Sheets CRM (Apps Script)

This repository contains a complete CRM implementation for Google Sheets using only Google Apps Script.

## What this CRM provides

- **CALL_SCREEN** dashboard
  - Customer picker at `C3`
  - Pending callbacks (today)
  - Upcoming callbacks (future)
  - Quick links to open customer sheets
- **All_Customers** overview
  - One row per customer
  - Last contact/result, next callback
  - Call history columns (`CALL1..CALL20`, where `CALL1` = most recent)
- **TEMPLATE_CALLLOG**
  - Used to create new customer sheets
  - Row 3 exact headers:
    - A3 = `Date/Time Opened`
    - B3 = `Result`
    - C3 = `Comment`
    - D3 = `Callback Date/Time`
- **One sheet per customer**
  - Call log starts at row 4
  - Result dropdown options:
    - `No answer`, `Cant talk`, `Order`, `Call back`
  - Callback UX via modal datetime dialog when Result = `Call back`

---

## Files

- `Code.gs` – all logic (setup, triggers, menus, dashboards, customer operations, utilities)
- `CallbackDialog.html` – modal dialog for callback datetime input

---

## Setup (fresh spreadsheet)

1. Create/open your Google Sheet.
2. Open **Extensions → Apps Script**.
3. Paste contents of:
   - `Code.gs`
   - `CallbackDialog.html`
4. Save the project.
5. Run function **`setupCRM`** once from Apps Script editor.
6. Authorize permissions when prompted.

Done. The script will:
- create/fix required sheets,
- format layout,
- install installable triggers (`onOpen`, `onEdit`),
- build dropdowns,
- refresh dashboards.

---

## Daily usage

1. Go to `CALL_SCREEN`.
2. In `C3`, type or select a customer name.
3. Use menu: **CRM → Open Customer (from CALL_SCREEN)**.
   - Creates customer sheet from `TEMPLATE_CALLLOG` if missing.
   - Appends a new call row with current datetime in column A.
4. Fill call result/comment in the customer sheet.
5. If Result = `Call back`, a modal prompts for callback date/time.
   - **Save** writes datetime to column D.
   - **Cancel** clears Result (B) and Callback (D) on that row.
6. Use menu: **CRM → Refresh Dashboards** any time.

---

## Menu functions (exact names)

- `setupCRM`
- `installTriggers`
- `menuOpenCustomerFromCallScreen`
- `refreshDashboards`
- `goToCallScreen`

Installable trigger entry points:
- `onOpen`
- `onEdit`

---

## Configuration constants

Defined in `Code.gs`:

- `SYSTEM_SHEETS = ["CALL_SCREEN","All_Customers","TEMPLATE_CALLLOG"]`
- `RESULT_OPTIONS = ["No answer","Cant talk","Order","Call back"]`
- `DATA_START_ROW = 4`
- `HEADER_ROW = 3`
- `MAX_CALL_HISTORY = 20`

Additional config:
- `THROTTLE_SECONDS` (default `8`) to limit expensive dashboard refresh frequency.

---

## Edge cases handled

- Missing required sheets (recreated by setup/refresh helpers)
- Missing `TEMPLATE_CALLLOG` (auto recreated)
- Illegal sheet characters removed from customer names: `[]:*?/\`
- Name length limit to 100 chars
- Duplicate customer sheet names auto-suffixed (`Name (2)`, `Name (3)`, ...)
- Blank edits ignored where appropriate
- Non-customer sheets excluded from `onEdit` logic
- Concurrent refresh/open operations protected with `LockService`

---

## Performance notes

- Uses batched reads (`getValues`) and batched writes (`setValues`) where practical.
- Dashboard refresh is throttled through `PropertiesService` to avoid excessive updates.
- Customer list derives from customer sheet names (non-system sheets).

