# Admin 2FA panel: design (short)

Date: 2026-11-24. Approved by the owner in chat the same day.

## Why
The owner wants to manage admin 2FA from the app instead of pasting SQL into the Supabase
SQL editor. That means seeing who is an admin, whether each one has 2FA, removing admin rights
where needed, and checking that the database itself requires 2FA for admin access.
This follows the fix in `supabase/migrations/20261124120000_restore_admin_mfa_requirement.sql`.

## What exists
Admin **Security** page (`src/pages/AdminSecurity.tsx`), **Admins** tab:
- a list of admins (name, email, 2FA badge, last seen, IP lock)
- Revoke, using the browser's `confirm()` and the `revoke_admin_role` action
- add an admin by email

Both actions live in `supabase/functions/admin-user-actions`.

**Bug:** the 2FA badge is wrong for every admin. `get_admins` reads the `user_mfa_status` view,
which filters to `auth.uid()`. The function calls it with the service key, where `auth.uid()` is
null, so it gets no rows and every admin shows "NO 2FA".

## Goals
1. **Correct 2FA badge.** `get_admins` reads each admin's verified factors from the auth admin
   API (`auth.admin.mfa.listFactors`), the same way `reset_user_mfa` does. If the lookup fails,
   the badge shows "unknown", never "NO 2FA".
2. **Real last sign-in.** `get_admins` adds `last_sign_in_at` from the auth user record, shown
   next to last seen.
3. **Revoke through the confirmation box.** Revoke uses the admin confirmation box
   (`useConfirmedCall`) instead of `confirm()`. `revoke_admin_role` joins the confirmation
   coverage list. You still can't revoke yourself, and every revoke is still logged.
4. **"Database 2FA check" card** on the Admins tab, read-only, answering three questions:
   - Do `is_admin()` and `has_role()` require 2FA?
   - Which live RLS policies check `user_roles` for admin on their own, without
     `is_admin()` or `has_role()`?
   - How many admins have no verified 2FA? This comes from the corrected list.

   The card is backed by a read-only SQL function, `admin_security_2fa_report()`. It may only be
   run by a signed-in admin whose session completed 2FA, which the function checks itself in the
   same way as `_db_space_require_admin`.

## Non-goals
- Applying migrations or changing policies from the app. Those stay as one-file pastes into the
  SQL editor.
- A bulk "remove all admins without 2FA" button. There are only a handful of admins, so they are
  removed one at a time.
- Recovery codes, sub-admin permissions, and the `AdminRoleModal` removal path. That modal
  deletes from `user_roles` in the browser; this is noted, not changed here.

## Anti-goals
- The card or badge must never say "NO 2FA" for an admin who has 2FA. A wrong red badge could
  get a working admin removed.
- Nothing on the page changes data except Revoke and Add, and both are confirmed.

## Approaches considered
- **Fix and extend the existing Admins tab (chosen).** The list, actions and logging already
  exist, so this only fixes the 2FA lookup and adds one read-only check.
- **A new standalone page.** It would duplicate the list and actions that already exist.
- **Apply the migration from the app.** This would give the website the power to change the
  database structure, which is a bigger risk than pasting one file once.

## Left to the builder
- The exact card layout. It follows the page's existing zinc card style and uses the admin
  console tokens.
- How the report function finds the policies: through `pg_policies`, matching `user_roles` and
  `admin` while excluding `is_admin()` and `has_role(`, the same as the query shown to the owner.
- The report function ships in its own migration file, applied in the SQL editor. Until it is
  applied, the card says "Database check not installed yet".
