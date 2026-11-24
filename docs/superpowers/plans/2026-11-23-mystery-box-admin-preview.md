# Mystery Box Admin Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can preview the customer Mystery Box popup (locked / ready / opened) from the admin page without touching the server.

**Architecture:** Split `MysteryBoxModal` into a presentational `MysteryBoxDialog`, which takes everything as props, and the existing connected wrapper. The admin page renders `MysteryBoxDialog` with the campaign form's values and fake callbacks.

**Tech Stack:** React 18, TypeScript, Vitest and Testing Library, shadcn Dialog.

**Spec:** `docs/superpowers/specs/2026-11-23-mystery-box-admin-preview-design.md`

## Global Constraints
- The preview never calls `supabase` or `open-mystery-box`, never navigates, and never writes anything.
- Customer popup behaviour and copy stay exactly as they are, and every existing `src/test/mystery-box-modal.test.tsx` test passes unchanged.
- The preview note reads exactly: `Preview — nothing is sent`.
- Fallback sample prize: `5GB MTN Data`.

## Review Focus
- If the campaign form has empty bullets, the preview drops blank lines, like the customer popup. Test in Task 2.
- If a newly chosen image file isn't saved yet, the preview shows it via an object URL, which is revoked when the preview closes. Checked by reading the code in Task 2.
- If the prize pool is empty or every prize is inactive, the reveal shows `5GB MTN Data`. Test in Task 2.
- Switching state after a reveal resets the popup to that state's screen. Test in Task 2.

---

### Task 1: Presentational `MysteryBoxDialog`

**Files:**
- Modify: `src/components/MysteryBoxModal.tsx`
- Test: `src/test/mystery-box-modal.test.tsx` (existing tests are the regression suite, plus one new test)

**Interfaces:**
- Produces: `export function MysteryBoxDialog(props: { open: boolean; onOpenChange: (v: boolean) => void; campaign: MysteryCampaign; progress: MysteryProgress; state: BoxState; onOpenBox: (phone: string) => Promise<OpenResult>; onGoBuy: () => void; defaultPhone?: string; revealDelayMs?: number; preview?: boolean })`. When `preview` is set, it renders the text `Preview — nothing is sent` and hides the LIVE badge.
- `MysteryBoxModal` keeps its current props and wires up `useMysteryBox`, `useAuth` and `navigate` into `MysteryBoxDialog`.

- [ ] **Step 1:** Add test `"MysteryBoxDialog in preview mode reveals via onOpenBox and never uses the live hook"`. Render `MysteryBoxDialog` with `campaign`, `available`, `state="available"`, `preview`, and `onOpenBox = vi.fn().mockResolvedValue({ success: true, prize_label: "10GB MTN", order_id: "x" })`. Click "Open your box 🎁". Expect `You won 10GB MTN! 🎉`, expect `Preview — nothing is sent` to be visible, and expect the mocked hook's `openBox` not to have been called.
- [ ] **Step 2:** Run `npx vitest run src/test/mystery-box-modal.test.tsx`. It should fail because `MysteryBoxDialog` isn't exported yet.
- [ ] **Step 3:** Extract the JSX and handlers into `MysteryBoxDialog`, and make `MysteryBoxModal` a thin wrapper around it.
- [ ] **Step 4:** Run the same command. All tests should pass.
- [ ] **Step 5:** Commit: `refactor(mystery-box): presentational MysteryBoxDialog for previews`.

### Task 2: Admin Preview button and panel

**Files:**
- Create: `src/components/MysteryBoxPreview.tsx`
- Modify: `src/pages/AdminMysteryBox.tsx` (form footer next to "Save campaign")
- Test: `src/test/admin-mystery-box.test.tsx`

**Interfaces:**
- Consumes: `MysteryBoxDialog` from Task 1.
- Produces: `export function MysteryBoxPreview(props: { open: boolean; onOpenChange: (v: boolean) => void; campaign: { title: string; image_url: string | null; orders_per_box: number; boxes_per_day: number; reward_text: string; bullets: string[] }; samplePrize: string })`, plus `export function previewSamplePrize(prizes: { label: string; is_active: boolean }[]): string`, which returns the first active label or `5GB MTN Data`.
- Sample progress: Locked is `{ qualifying_orders: 1, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: orders_per_box - 1 }`. Ready is `{ qualifying_orders: orders_per_box, boxes_earned: 1, boxes_opened: 0, boxes_available: 1, orders_to_next: 0 }`. `today` is today's UTC date.
- The state switcher has buttons labelled `Locked`, `Ready to open` and `Opened`. `Opened` shows the reveal straight away. `onOpenBox` resolves `{ success: true, prize_label: samplePrize, order_id: "preview" }`. `onGoBuy` does nothing.

- [ ] **Step 1:** Add tests:
  - `previewSamplePrize([])` returns `5GB MTN Data`. `previewSamplePrize([{label:"1GB",is_active:false},{label:"10GB MTN",is_active:true}])` returns `10GB MTN`.
  - Rendering `MysteryBoxPreview` (open, `orders_per_box: 5`, `reward_text: "5GB or more"`, bullets `["A", "  ", "B"]`) shows `Complete 4 more orders today to earn 5GB or more` with exactly two bullet items. Clicking `Ready to open` shows `Open your box 🎁`. Clicking `Opened` shows `You won 10GB MTN! 🎉`. Clicking `Locked` again shows the locked button.
  - Mock `@/integrations/supabase/client` so any call throws, and assert it was never called.
- [ ] **Step 2:** Run `npx vitest run src/test/admin-mystery-box.test.tsx`. It should fail because the module doesn't exist yet.
- [ ] **Step 3:** Implement `MysteryBoxPreview` and `previewSamplePrize`. Add an outline `Preview` button (Eye icon) next to Save. It opens the preview with `form`, the image (an object URL of `imageFile` if one is set, otherwise `form.image_url`) and `previewSamplePrize(prizes)`.
- [ ] **Step 4:** Run the same command, then `npm test`. Everything should pass.
- [ ] **Step 5:** Commit: `feat(mystery-box): admin preview of the customer popup`.
