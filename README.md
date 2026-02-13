# Google Apps Script CRM Web App

This project is a production-oriented CRM web app built with Google Apps Script + Google Sheets as database only. End users do not use spreadsheet tabs directly.

## Routing strategy

This implementation uses `e.parameter.page` consistently:
- Login: `.../exec?page=login`
- Admin: `.../exec?page=admin`
- Agent: `.../exec?page=agent`

Token is passed as `?t=TOKEN` and persisted to `localStorage.crm_session`.

## Required project files

- `Code.gs`
- `server/DbService.gs`
- `server/AuthService.gs`
- `server/AdminService.gs`
- `server/AgentService.gs`
- `ui/Login.html`
- `ui/Admin.html`
- `ui/Agent.html`
- `ui/styles.css.html`
- `README.md`

## Setup (from scratch)

1. Create/open a Google Spreadsheet (DB only).
2. Open **Extensions > Apps Script**.
3. Paste each file exactly with the same names and folders.
4. Save project.
5. Run `setupDatabase()` **once** from Apps Script editor and authorize.
6. Deploy web app:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Open deployed URL (`?page=login` is optional; login is default route).

## Default admin account

Automatically created by `setupDatabase()` if missing:
- Username: `Thomaz Muller`
- Password: `Rodmor2011@`
- Role: `ADMIN`

## Data model tabs and headers

`setupDatabase()` ensures exact sheets/headers exist:
1. CONFIG: `key, value`
2. USERS: `userId, username, passwordHash, passwordSalt, role, isActive, createdAt, lastLoginAt`
3. CUSTOMER_LISTS: `listId, listName, createdAt`
4. CUSTOMERS: `customerId, listId, customerName, phone, notes, isActive`
5. ASSIGNMENTS: `assignmentId, userId, listId, createdAt`
6. CALL_LOGS: `logId, customerId, userId, callAt, result, comment, callbackAt, createdAt`
7. SESSIONS: `sessionId, userId, expiresAt, createdAt`

## Reliability architecture implemented

- Single initial state call per page:
  - Admin: `apiAdminGetState(token)`
  - Agent: `apiAgentGetState(token)`
- UI waits for GetState before rendering interactive controls.
- DOM is never source of truth; page-level `state` object is source of truth.
- After every mutation: await mutation -> re-fetch GetState -> render.
- Dropdown/list import resolution is deterministic.
- Assignment UI renders deterministic placeholders when no agents/lists.
- Assignments replace atomically server-side under script lock.
- Session stability:
  - token resolved from `?t=` then localStorage fallback
  - internal navigation always preserves token via helper `go(page)`
  - invalid/expired session clears token and redirects to login

## Troubleshooting

### 1) Dropdown not selected after creating list
- Behavior is deterministic:
  - server returns created `listId`
  - client sets `state.selectedListId` immediately
  - then refreshes `apiAdminGetState`
- Verify you are using the provided `createList()` flow and not manual DOM state.

### 2) Import says `listId required`
- Import resolves listId in strict order:
  1. `state.selectedListId` if valid
  2. first list in `state.lists`
  3. else action disabled/error: "Create a customer list first."
- Ensure at least one list exists.

### 3) Assignment panel empty or broken
- UI intentionally shows placeholders:
  - "Create an AGENT first" if no active AGENT users
  - "Create a customer list first" if no lists
- Once both exist, it shows agent selector and plain checkbox checklist.

### 4) Random logout / bounce to login
- Token lifecycle:
  - URL `?t=TOKEN` persists into localStorage
  - localStorage reused on refresh
  - `go(page)` preserves token on all internal navigation
- If you still redirect, session likely expired or user deactivated.

## Acceptance test checklist

A) Setup and login
- Run `setupDatabase()`.
- Expected: all 7 tabs exist with exact headers.
- Expected: default admin can login (`Thomaz Muller` / `Rodmor2011@`).

B) List + import
- Create list `Test A`.
- Expected: list dropdown auto-selects `Test A`.
- Import 5 lines like:
  - `Name 1,,`
  - `Name 2,,`
  - ...
- Expected: inserted=5, each customer linked to `Test A` listId.

C) Assignments persist
- Create AGENT user.
- Assign list `Test A` to that agent.
- Refresh/re-login.
- Expected: assignment remains persisted.

D) Stable sessions
- Navigate login/admin/agent using in-app buttons and refresh pages.
- Expected: no random logout while session valid.
- Click logout.
- Expected: token removed and returns to login.

E) Agent data isolation
- Login as agent.
- Expected: sees only customers from assigned lists.
- Expected: cannot open unassigned customer details via API.

