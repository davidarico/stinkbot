# Frontend Audit Report — Stinkwolf
**Date:** 2026-05-06  
**Auditor:** Claude Sonnet 4.6 (automated)  
**Scope:** `/home/david/git/stinkbot/frontend`

---

## P0 — Critical / Crash

### P0-1: `dangerouslySetInnerHTML` used with unvalidated third-party HTML
**File:** `components/MediaDisplay.tsx` — `EmbeddedMedia` component, line ~88  
**Issue:** oEmbed responses from Tenor and Giphy can contain arbitrary `html` strings which are injected directly into the DOM via `dangerouslySetInnerHTML={{ __html: oembedData.html }}` with zero sanitisation. A compromised or spoofed oEmbed endpoint could inject scripts and achieve XSS. The `/api/media/oembed` proxy forwards raw third-party JSON unmodified.  
**Fix:** Strip the `html` field from oEmbed responses at the proxy layer, or render GIFs by constructing an `<img>` tag from the known ID rather than accepting arbitrary HTML from the third party.

---

### P0-2: Admin authentication token has no secret — trivially forgeable
**File:** `app/api/admin/auth/route.ts` line 22, `app/api/admin/verify/route.ts` line 14  
**Issue:** The admin session token is `base64(Date.now() + "-" + Math.random())`. The verify endpoint decodes this and only checks `Date.now() - parseInt(timestamp) < 24h`. Because there is no secret/HMAC, anyone who knows the token format can forge a valid token. The comment in the code even says *"In production, use proper JWT or session management."*  
**Fix:** Sign the token with a secret (e.g. `crypto.createHmac('sha256', SECRET).update(timestamp).digest('hex')`), or replace with a proper session store.

---

### P0-3: Game password stored and compared in plaintext
**File:** `lib/database.ts` — `verifyGamePassword`, line ~394–410  
**Issue:** The game password is the Discord category_id, stored and compared as a plaintext string with `===`. The game page also passes it in a cookie (`game_${gameId}_auth=true`) that is not `httpOnly` and trivially inspectable/settable by any client script.  
**Fix:** The `httpOnly` flag must be added to the game auth cookie. The category_id check itself is acceptable as low-security access, but the plaintext cookie without `httpOnly` is an XSS amplifier.

---

### P0-4: Game auth cookie is not `httpOnly` — accessible to any script
**File:** `app/game/[gameId]/page.tsx` line ~295  
**Issue:** `document.cookie = \`game_${gameId}_auth=true; path=/; max-age=86400\`` sets a client-side cookie without `httpOnly`. Any XSS in the page can read and replay or clear this cookie. It also lacks the `Secure` and `SameSite` attributes that the admin cookie receives.  
**Fix:** Set the game auth cookie from the server-side `verifyPassword` API response, using `response.cookies.set(...)` with `httpOnly: true, secure: true, sameSite: 'lax'`.

---

### P0-5: `DATABASE_URL` defaults to empty string — silently creates broken pool
**File:** `lib/database.ts` line 1537  
**Issue:** `new DatabaseService(process.env.DATABASE_URL || "")`. When `DATABASE_URL` is not set, a `pg.Pool` is created with `connectionString: ""`, which will fail every query at runtime rather than failing loudly at startup. Every API route will return a 500 with a cryptic pg error.  
**Fix:** At module initialisation throw a clear error: `if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set")`.

---

## P1 — High / Bug

### P1-1: `loadGameData` is a stale closure — called from `useEffect` that doesn't list it as a dependency
**File:** `app/game/[gameId]/page.tsx` lines 146–156 and 158–268  
**Issue:** `loadGameData` is defined as a plain `async function` inside the component. It reads `gameData` via a closure (`currentGameData = gameData`). The `useEffect` that calls it on mount only lists `[gameId]` as a dependency. If `gameData` state is ever stale when `loadGameData` executes (unlikely at first render but possible after React strict-mode double-invoke or future concurrent rendering), the vote-loading branch `if (currentGameData.phase === "day")` may use stale data. Additionally `loadGameData` is also called imperatively after login without being in any `useCallback`, creating a warning-free but fragile pattern.  
**Fix:** Wrap `loadGameData` in `useCallback` with proper dependencies, or use a local variable passed as a parameter rather than the closure.

---

### P1-2: `useEffect` in `useToast` hook has wrong dependency — listener leaks
**File:** `hooks/use-toast.ts` line 177  
**Issue:** `React.useEffect(() => { listeners.push(setState); ... }, [state])`. The dependency array includes `state`, which means the effect re-runs every time any toast changes. This causes repeated push/splice of `setState` into the global `listeners` array on every state change, and the cleanup only removes the *current* `setState` reference, but a new one was added between renders. Under React 18 strict-mode this creates listener duplicates and potential memory leaks.  
**Fix:** The dependency array should be `[]` (empty), matching the pattern in shadcn's own canonical implementation.

---

### P1-3: `selectedUserId` is shared across all channels in `ManageChannelsModal`
**File:** `components/manage-channels-modal.tsx` lines ~43, 310–334  
**Issue:** A single `selectedUserId` state is used to drive the "Add User" select for every rendered channel card. If the modal shows multiple channels, selecting a user in one channel's dropdown updates the shared state and the "Add" button for every other channel also becomes enabled. Clicking "Add" on the wrong channel silently adds the user to that channel instead.  
**Fix:** Move `selectedUserId` inside the per-channel map (use a `Record<channelId, userId>` state or extract a `ChannelRow` component with local state).

---

### P1-4: `setTimeout` used to work around closed settings modal state
**File:** `app/game/[gameId]/page.tsx` lines 1983–1986  
**Issue:**  
```tsx
setSettingsModalOpen(false)
setTimeout(() => setSettingsModalOpen(true), 100)
```  
This is a race-condition hack; it depends on a 100 ms delay being sufficient for React to unmount/remount the modal. If the component re-renders slowly or the user is on a slow device, the modal may not properly reload its channel list. State can also be dropped if the component unmounts during the timeout.  
**Fix:** Instead of toggling open/closed, expose a `reload()` callback from `SettingsModal` (e.g. via `useImperativeHandle` or a key prop).

---

### P1-5: Kanban drag-end fires multiple sequential `await updateTask` calls without optimistic update
**File:** `app/admin/kanban/page.tsx` lines 178–186  
**Issue:** When reordering within a column, the code loops over all tasks in that column (except the dragged one) and awaits `updateTask` for each sequentially. For a 10-task column this fires 9+ sequential API calls. The UI does not update until the awaits complete and the component re-renders. If any one call fails, the remainder are still attempted and the partial-update leaves the board in an inconsistent state.  
**Fix:** Optimistically update the local `tasks` array immediately, batch the position updates in a single API call (e.g. `PUT /api/admin/kanban/reorder`), and revert on failure.

---

### P1-6: `handleDragEnd` shadow-names `activeTask` state variable
**File:** `app/admin/kanban/page.tsx` line 150  
**Issue:** The component has `const [activeTask, setActiveTask] = useState<Task | null>(null)` (line 44) and inside `handleDragEnd` there is `const activeTask = tasks.find(...)` (line 150). This local `const` shadows the state variable. Inside `handleDragEnd` only the local const is accessible, which is likely correct, but is confusing and can mask bugs if the block structure changes.  
**Fix:** Rename the local const to something like `draggedTask` to avoid confusion.

---

### P1-7: `areFiltersSet` logic is wrong — "Jump to Original Message" shown incorrectly
**File:** `app/archives/page.tsx` lines 67–69  
**Issue:**  
```ts
const areFiltersSet = () => {
  return filters.query !== '' && filters.user !== 'all'
}
```  
This requires **both** a non-empty query **and** a non-"all" user filter. The button is intended to jump to the context of any individual message. In practice the button only appears when a very narrow condition is met, hiding a useful feature. The name "areFiltersSet" is also misleading for what is actually a "jump to context" trigger condition.  
**Fix:** Reconsider the condition. If the intent is "always show the jump button per message", remove the `areFiltersSet` guard entirely. If the intent is narrower, document it clearly.

---

### P1-8: `searchMessages` fires on every `filters` change including `jumpToMessageRef` side effects
**File:** `app/archives/page.tsx` lines 88–90  
**Issue:** `useEffect(() => { searchMessages() }, [filters])`. The `jumpToMessageRef` is updated imperatively in `handleJumpToRepliedMessage` before `setFilters` is called, but because `jumpToMessageRef` is a ref (not in the dep array), the effect has no way to know whether the current search is a "jump" or a normal filter change. This creates subtle ordering bugs: if `setFilters` batches with another state update, `searchMessages` may read a stale `jumpToMessageRef`.  
**Fix:** Encode the `jumpToMessageId` inside the `filters` state object (it already has a matching API param) and clear it after the search completes.

---

### P1-9: `fetchReplyPreviews` makes one serial API call per reply message — potential waterfall
**File:** `app/archives/page.tsx` lines 148–175  
**Issue:** For each message with a `replyToMessageId`, a sequential `await fetch(...)` is made inside a `for` loop. If a page returns 20 messages each with replies, this fires 20 serial requests. This blocks the loading spinner from clearing until all finish.  
**Fix:** Fan out in parallel with `Promise.all(messages.filter(m => m._source.replyToMessageId).map(m => fetch(...)))`.

---

### P1-10: `getServerUsersByUserIds` builds `placeholders` variable but never uses it
**File:** `lib/database.ts` lines 1022–1025  
**Issue:**  
```ts
const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',')
const result = await this.pool.query(
  `SELECT ... WHERE user_id = ANY($1)`,
  [userIds]
)
```  
The `placeholders` string is computed but never inserted into the query. The query uses `ANY($1)` with the array directly (which is correct for pg), so `placeholders` is dead code that wastes a loop. It is confusing because it suggests the query was once or was intended to be written differently.  
**Fix:** Delete the `placeholders` computation.

---

### P1-11: `params` type inconsistency across API routes — some sync, some async
**File:** Multiple route files  
**Issue:** Next.js 15 requires `params` to be typed as `Promise<{...}>` and awaited. Some routes do this correctly (`app/api/games/[gameId]/route.ts`, `app/api/games/[gameId]/channels/route.ts`), while others still use the synchronous type `{ params: { gameId: string } }` and then `await params` anyway (`app/api/games/[gameId]/players/route.ts`, `app/api/games/[gameId]/roles/route.ts`, `app/api/games/[gameId]/votes/route.ts`, `app/api/games/[gameId]/night-actions/route.ts`, `app/api/games/[gameId]/player-roles/route.ts`, `app/api/admin/kanban/[id]/route.ts`).  
Calling `await` on a plain object is a no-op in JS/TS, so these routes currently work, but Next.js emits build warnings and future framework versions may break them.  
**Fix:** Standardise all route files to `params: Promise<{ gameId: string }>` and `const { gameId } = await params`.

---

### P1-12: `saveGameRolesIndividually` silently swallows insert errors, can produce partial data
**File:** `lib/database.ts` lines 513–554  
**Issue:** The fallback `saveGameRolesIndividually` method uses `console.warn` instead of rethrowing on individual insert errors (line ~538: `console.warn('Failed to insert game role:', insertError)`). If multiple roles fail to insert, the COMMIT still proceeds, leaving the game in a partial state with fewer roles than expected. The upstream caller gets `{ success: true }` even though data is missing.  
**Fix:** Collect failures and rethrow after the loop, or remove the fallback entirely and fix the root cause of constraint errors.

---

### P1-13: Alignment detection for non-wolf players is ambiguous — triple-fallback logic
**File:** `app/api/games/[gameId]/players/route.ts` lines 32–36  
**Issue:**  
```ts
alignment: player.is_wolf ? "wolf" : 
           (player as any).role_team === 'wolf' ? "wolf" : 
           (player as any).role_team === 'neutral' ? "neutral" : "town",
```  
`is_wolf` is a legacy boolean column but `role_team` (from the JOIN) is the ground truth. If `is_wolf` is `true` but `role_team` is `"neutral"`, the player incorrectly shows as wolf. The cast to `any` also defeats TypeScript.  
**Fix:** Use only `role_team` (from the JOIN) as the source of truth and deprecate or stop reading `is_wolf` for alignment display.

---

## P2 — Medium / Stability

### P2-1: `loadGameData` has no race-condition protection — concurrent calls can clobber state
**File:** `app/game/[gameId]/page.tsx` lines 158–268  
**Issue:** `loadGameData` is called both on cookie-auth success (after `useEffect`) and after `handleLogin`. If the user double-clicks "Access Game", two concurrent calls can run and their `setState` calls interleave, potentially leaving `players` or `selectedRoleSlots` from the first call overwritten by the second.  
**Fix:** Use an `AbortController` or a boolean `isMounted`/`isLoading` guard to cancel in-flight calls when a newer one starts.

---

### P2-2: No error boundary — any render error in game page crashes to blank
**File:** `app/game/[gameId]/page.tsx` (entire file)  
**Issue:** There is no React Error Boundary wrapping the game management page. Any unhandled rendering exception (e.g. undefined property access in `getDisplayRoleName`) will render a blank screen with no feedback.  
**Fix:** Add an `ErrorBoundary` component that shows a "Something went wrong. Reload?" message.

---

### P2-3: `loading.tsx` returns `null` — no actual loading UI
**Files:** `app/game/[gameId]/loading.tsx`, `app/roles/loading.tsx`  
**Issue:** Both files export `export default function Loading() { return null }`. Next.js shows these during server-side data fetching, meaning users see a completely blank page while data loads instead of a skeleton or spinner.  
**Fix:** Return a meaningful loading skeleton or spinner matching the page layout.

---

### P2-4: Dark-mode class toggled directly on `document.documentElement` — no cleanup on error
**File:** `app/game/[gameId]/page.tsx` lines 825–835  
**Issue:** The `useEffect` that applies `.dark` to `<html>` does remove the class in its cleanup, but only in the `!isAuthenticated || loading || error` branch when `return` is hit early — that branch never attaches the class and returns early, so the cleanup runs even without adding `.dark`. The real problem is if the component unmounts during an active dark session (e.g. navigating away mid-game), the cleanup does correctly remove it — that part is fine. However, combining theme logic with page-level component state couples the two concerns tightly and will cause issues if any other component also manipulates `document.documentElement.classList`.  
**Fix:** This is a low-severity concern now but should use a theme provider (e.g. `next-themes` which is already in `package.json`) rather than direct DOM manipulation.

---

### P2-5: `next-themes` is installed but not used; `ThemeProvider` is not in the layout
**File:** `package.json` (dependency), `components/theme-provider.tsx`, `app/layout.tsx`  
**Issue:** `next-themes` is listed as a dependency and `ThemeProvider` exists in `components/theme-provider.tsx` but is never imported or mounted in `app/layout.tsx`. The app manually toggles the `dark` class on `<html>` from the game page component instead. This means theme preferences are not persisted, there is a flash of unstyled content risk, and SSR/client mismatches may occur.  
**Fix:** Wrap `app/layout.tsx` with `ThemeProvider`, and use `useTheme()` from `next-themes` in the game page instead of direct DOM manipulation.

---

### P2-6: `SettingsModal` initialSettings overwrite loses channel state race
**File:** `components/settings-modal.tsx` lines 53–57 and 59–63  
**Issue:** The modal has two `useEffect`s triggered by `[isOpen, initialSettings]` and `[isOpen]`. When opened, both fire. The first sets `settings` from `initialSettings` (which has no `gameChannels`). The second calls `loadGameChannels()` which does `setSettings(prev => ({ ...prev, gameChannels: channels }))`. If `initialSettings` causes a re-render between the two effects, the channel list set by the second effect can be wiped by a re-run of the first. The ordering is fragile.  
**Fix:** Merge the two effects into one that loads channels and applies `initialSettings` in a single consistent update.

---

### P2-7: Admin sub-pages use client-side redirect (`router.push`) for auth guard
**Files:** `app/admin/feedback/page.tsx` line 100, `app/admin/kanban/page.tsx` line 229, `app/admin/server-roles/page.tsx` line 247  
**Issue:** When `isAuthenticated === false`, these pages call `router.push('/admin')` and `return null`. This means the page renders `null` for one frame before the redirect fires, potentially flashing blank content. It also means the guard runs **after** the auth check API call completes — unauthenticated users see a spinner while the check runs.  
**Fix:** Use Next.js middleware (`middleware.ts`) to redirect unauthenticated requests at the edge, or at minimum use `redirect()` from `next/navigation` (server-side) to avoid the client flash.

---

### P2-8: `handleDeleteRole` in `server-roles/page.tsx` uses `window.confirm` — breaks in headless environments
**File:** `app/admin/server-roles/page.tsx` line 202  
**Issue:** `if (!confirm('Are you sure...'))` uses the browser's native `window.confirm` dialog, which is blocked in many headless/embedded contexts, inside cross-origin iframes, and is generally considered bad UX. The kanban and manage-channels pages correctly use a Dialog-based confirmation instead.  
**Fix:** Replace with an AlertDialog (already used elsewhere in the admin pages).

---

### P2-9: `getArchiveAggregations` issues N+1 queries for user display names
**File:** `lib/database.ts` lines 1457–1466  
**Issue:** After fetching up to 100 user IDs, for each user not found in `server_users`, a separate `SELECT username FROM archive_messages WHERE user_id = $1 LIMIT 1` is issued. In the worst case this is 100 sequential queries.  
**Fix:** Collect all unknown user IDs into a single `SELECT DISTINCT user_id, username FROM archive_messages WHERE user_id = ANY($1)` query.

---

### P2-10: No protection against concurrent role assignment clicks
**File:** `app/game/[gameId]/page.tsx` — `assignRoles` function (lines 370–450)  
**Issue:** The "Assign Roles" button has no loading/disabled state while `assignRoles` is executing. A moderator who double-clicks will fire two concurrent assignment requests, potentially duplicating or scrambling role assignments. The function also does not set `loading = true` while running.  
**Fix:** Add a separate `assigningRoles` state boolean, disable the button while true, and clear it in a `finally` block.

---

### P2-11: `useEffect` dependency in `BreakdownBuilderModal` includes `gameId` but also runs an IIFE
**File:** `components/breakdown-builder-modal.tsx` lines 61–82  
**Issue:** The `useEffect` calls `loadPlayerRoles()` (an `async` function defined outside the effect) and also kicks off an inline IIFE for player roster loading. Having two network requests initiated from one effect via two different patterns (named function + void IIFE) makes error handling and cancellation inconsistent. The `loadPlayerRoles` request has a toast error handler; the IIFE silently sets `[]` on failure. If the component unmounts while either fetch is in-flight, `setState` will be called on an unmounted component.  
**Fix:** Merge into a single async effect and use `AbortController` for cleanup.

---

### P2-12: Archives search fires on every keystroke with no debounce
**File:** `app/archives/page.tsx` lines 88–90  
**Issue:** `useEffect(() => { searchMessages() }, [filters])`. The `query` filter in `filters` is updated directly on every `onChange` event (`handleFilterChange('query', e.target.value)`). This fires a full-text database query on every keystroke. For a large archive this is expensive and can result in many in-flight queries overtaking each other.  
**Fix:** Debounce the `query` field update (e.g. 300–500 ms) or use a separate local state for the input value and only commit to `filters.query` on blur or after a debounce.

---

### P2-13: `addGameChannel` endpoint has no authentication check
**File:** `app/api/games/[gameId]/channels/route.ts` (POST, PATCH, DELETE handlers)  
**Issue:** The channels API has no check that the caller is authenticated for the game. Anyone who knows a `gameId` can POST to add channels, PATCH to modify invited users, or DELETE channels without providing the game password.  
**Fix:** Add a password/cookie verification step in the channels route matching the pattern used in the game verify endpoint.

---

### P2-14: `updatePlayerStatus`, `updatePlayerCharges`, `updatePlayerWinByNumber` have no auth check
**File:** `app/api/games/[gameId]/players/route.ts` (POST handler)  
**Issue:** Any unauthenticated client can POST to `/api/games/:gameId/players` with `action: "updatePlayer"` and kill/revive players or manipulate their charges/win conditions. The `verifyPassword` action exists on the game route but is not enforced on the players route.  
**Fix:** Validate the `game_${gameId}_auth` cookie server-side (or use a shared middleware) before mutating player data.

---

### P2-15: `saveGameRoles` validates roles one-by-one inside a loop with individual queries
**File:** `lib/database.ts` lines 467–475  
**Issue:** For each role in the payload, `SELECT id FROM roles WHERE id = $1` is run individually. For a game with 15 roles this is 15 sequential queries before any inserts begin.  
**Fix:** Use a single `SELECT id FROM roles WHERE id = ANY($1)` query to validate all role IDs at once.

---

## P3 — Low / Cleanup

### P3-1: `components/role-info-components.tsx` — entirely dead code
**File:** `components/role-info-components.tsx`  
**Issue:** `SleepwalkerComponent`, `BartenderComponent`, and `SeerComponent` are exported but not imported by any other file in the codebase. They use hardcoded mock player lists (`["Alice", "Bob", "Charlie", ...]`) which is clearly prototype-era code. These have been superseded by the proper calculators in `components/calculators/`.  
**Fix:** Delete the file.

---

### P3-2: `components/MediaDisplay.tsx` — `InlineMediaDisplay` is exported but never used
**File:** `components/MediaDisplay.tsx` lines 240–293  
**Issue:** `InlineMediaDisplay` is exported but has no importers anywhere in the codebase.  
**Fix:** Remove the export (or the entire function if it is not planned).

---

### P3-3: `lib/opensearch.ts` — dead module, OpenSearch client never imported
**File:** `lib/opensearch.ts`  
**Issue:** The OpenSearch client is created at module load time (unconditionally connecting to `localhost:9200` or `OPENSEARCH_DOMAIN_ENDPOINT`). No other file in `app/` imports `openSearchClient`. The application has migrated to PostgreSQL for archive search. However, the client is still instantiated during builds, and the `@opensearch-project/opensearch` package remains in `dependencies`, adding bundle weight and a startup side-effect.  
**Fix:** Delete `lib/opensearch.ts` and remove `@opensearch-project/opensearch` from `package.json`. Remove related npm scripts `setup-opensearch` and `index-archives` if they are also obsolete.

---

### P3-4: `components/ui/use-mobile.tsx` and `hooks/use-mobile.ts` — duplicate files
**Files:** `components/ui/use-mobile.tsx`, `hooks/use-mobile.ts`  
**Issue:** Both files contain identical `useIsMobile` implementations. Only `components/ui/use-mobile.tsx` is consumed (by `components/ui/sidebar.tsx`). `hooks/use-mobile.ts` is unreferenced.  
**Fix:** Delete `hooks/use-mobile.ts` (it is the orphaned duplicate).

---

### P3-5: `components/ui/use-toast.ts` and `hooks/use-toast.ts` — duplicate files
**Files:** `components/ui/use-toast.ts`, `hooks/use-toast.ts`  
**Issue:** Both files contain the same `useToast` / `toast` implementation. The project imports from `@/hooks/use-toast` in components and pages. `components/ui/use-toast.ts` appears to be a shadcn scaffold leftover.  
**Fix:** Confirm which one is the canonical source (currently `hooks/use-toast.ts` is used everywhere). Remove the unused one.

---

### P3-6: `generator: 'v0.dev'` in page metadata
**File:** `app/layout.tsx` line 12  
**Issue:** `metadata` includes `generator: 'v0.dev'`, which exposes the scaffolding tool used. This is a minor information disclosure and looks unprofessional in production.  
**Fix:** Remove the `generator` field from the metadata.

---

### P3-7: `next` version "16.0.8" does not exist — likely a typo for "15.x"
**File:** `package.json` line 56  
**Issue:** `"next": "16.0.8"` — there is no published Next.js 16.0.8 as of the current date (latest is the 15.x line). This is likely a mistyped version that npm resolved to the closest available or cached version. If it resolved to an unexpected version, features and APIs (including the `params` async behavior) may behave differently than expected.  
**Fix:** Verify the installed Next.js version with `npm ls next` and update `package.json` to reflect the actual installed version.

---

### P3-8: `gameData` state uses `any` type for `gameSettings`
**File:** `app/game/[gameId]/page.tsx` line 140  
**Issue:** `const [gameSettings, setGameSettings] = useState<any>(null)`. `gameSettings` is passed as `initialSettings` to `SettingsModal` which expects `GameSettings`. The `any` type bypasses type safety and could allow malformed objects to propagate silently.  
**Fix:** Type the state as `GameSettings | null` (the interface is already defined in `settings-modal.tsx`; export and reuse it).

---

### P3-9: `updateRoleCharges` and `updateRoleWinByNumber` update all slots with matching `roleId`, not a specific slot
**File:** `app/game/[gameId]/page.tsx` lines 760–773  
**Issue:**  
```ts
const updateRoleCharges = (roleId: number, charges: number) => {
  setSelectedRoleSlots((prev) =>
    prev.map((slot) => (slot.role.id === roleId ? { ...slot, charges } : slot)),
  )
}
```  
When the same role appears more than once (e.g. two Villagers), changing charges for one updates ALL slots with that `roleId`. The UI also only shows a single charge counter per role name, so this is intentional design — but the function name implies per-slot control. This logic is consistent with how the grouped view works, but it means individual-slot charge customisation is not possible by design. The feedback item #53 ("Allow for villagers to have separate themes") suggests this may become a requested feature. **Low severity now; document the limitation.**

---

### P3-10: `sortSlotsByAlignmentAndName` is duplicated in `page.tsx` and `breakdown-builder-modal.tsx`
**Files:** `app/game/[gameId]/page.tsx` lines 96–106, `components/breakdown-builder-modal.tsx` lines 115–129  
**Issue:** Identical sort logic is copy-pasted in two places. If the alignment ordering ever changes, both must be updated.  
**Fix:** Extract to `lib/utils.ts` and import from both.

---

### P3-11: `console.log` debug statements left in production paths
**Files:**  
- `app/archives/page.tsx` lines ~108, 123, 130–135, 180, 186, 191, 208, 223, 242, 253, 255  
- `lib/database.ts` lines 811–812, 814  
**Issue:** Numerous `console.log('🔍 searchMessages called...')`, `console.log('📡 Making search request...')`, etc. are left in the archive page. These log filter state and message IDs on every search, leaking data to anyone with the browser console open and degrading performance.  
**Fix:** Remove or replace with a debug-only logger gated by `process.env.NODE_ENV === 'development'`.

---

### P3-12: `app/game/[gameId]/loading.tsx` and `app/roles/loading.tsx` return `null`
**Files:** Both files  
**Issue:** (Also noted at P2-3.) At minimum the `loading.tsx` files should show a spinner or skeleton to prevent a fully blank screen.

---

### P3-13: No `not-found.tsx` or `error.tsx` global pages
**Directory:** `app/`  
**Issue:** There is no `app/not-found.tsx` or `app/error.tsx`. Any 404 or unhandled server error shows Next.js's default development overlay in dev or a plain white page in production.  
**Fix:** Add both files with themed error states matching the rest of the UI.

---

### P3-14: No page-level `metadata` exports on any sub-page
**Files:** `app/game/[gameId]/page.tsx`, `app/archives/page.tsx`, `app/roles/page.tsx`, `app/admin/page.tsx` and sub-pages  
**Issue:** Only `app/layout.tsx` exports metadata. Sub-pages have no `export const metadata` or `generateMetadata()`, meaning every page shows the same title "Stinkwolf - Werewolf Game Management" regardless of context. Search engines and browser tabs cannot distinguish between pages.  
**Fix:** Add per-page `metadata` exports (for static pages) or `generateMetadata` (for dynamic pages like the game view).

---

### P3-15: `addChannelPrefix` padding computed with hardcoded character width
**File:** `components/add-channel-modal.tsx` lines 243–244  
**Issue:**  
```tsx
style={{ paddingLeft: channelPrefix ? `${channelPrefix.length * 8 + 24}px` : undefined }}
```  
The padding is computed assuming each character is 8px wide. This will misalign for prefixes with wide characters (e.g. `W`, `M`) or narrow characters, or when font size changes. It also overrides Tailwind's `pl-20` class (which correctly handles fixed-width prefixes).  
**Fix:** Use a more robust approach — position an absolutely-positioned prefix overlay and use a transparent spacer matching its rendered width, or use a prefix `<span>` with `flex` layout.

---

### P3-16: `Bloodhound` calculator has non-functional placeholder logic
**File:** `components/calculators/bloodhound-calculator.tsx` lines 47–62  
**Issue:** The Bloodhound calculator picks up to 3 random alive players as its "result" regardless of which role is being searched for. The comment in the file acknowledges this: *"Does not implement full rules — picks among alive players for flavor text."* Feedback item #67 notes the Bloodhound rule is about tracking IA violations across days, which this calculator doesn't address at all.  
**Fix:** Either implement proper Bloodhound logic or add a clear in-UI disclaimer that results are random placeholders, not actual game logic.

---

### P3-17: Hardcoded couple-chat messages in database layer
**File:** `lib/database.ts` lines 1149–1150  
**Issue:**  
```ts
'Back to the mines yall go.', // Day message
'Have some nice pillow talk you two.', // Night message
```  
These strings are hardcoded in the database service. They cannot be configured per-server and will be sent to all couples in all games.  
**Fix:** Read couple chat messages from the server config or a separate settings record.

---

### P3-18: `areFiltersSet` in archives page is defined as a function but never changes
**File:** `app/archives/page.tsx` line 67  
**Issue:** `const areFiltersSet = () => { ... }` is recalculated on every render. It could simply be a derived constant: `const filtersAreSet = filters.query !== '' && filters.user !== 'all'`. Minor performance concern.  
**Fix:** Replace with a `const` or `useMemo`.

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** | 5 | Critical / crash-level security or data integrity issues |
| **P1** | 13 | High-priority bugs, incorrect React patterns, data integrity bugs |
| **P2** | 15 | Medium-severity stability, performance, and auth gaps |
| **P3** | 18 | Low-priority cleanup: dead code, polish, accessibility, missing metadata |
| **Total** | **51** | |

### Top priorities to address immediately:
1. **P0-1**: Remove `dangerouslySetInnerHTML` usage with unvalidated oEmbed HTML
2. **P0-2**: Replace the forged-admin-token auth system with a properly HMAC-signed token
3. **P0-3 / P0-4**: Move game auth cookie to server-side with `httpOnly`
4. **P0-5**: Fail loudly if `DATABASE_URL` is not set
5. **P1-2**: Fix the `useToast` effect dependency to prevent listener leaks
6. **P2-13 / P2-14**: Add authentication checks to game channel and player mutation routes
