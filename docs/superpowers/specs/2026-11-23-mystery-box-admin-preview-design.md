# Mystery Box admin preview: design

**Status:** approved by the owner on 2026-11-23 ("yes build it").

## Why
Admins need to see exactly what customers will see before a campaign goes live. Right now the popup is hidden for admin accounts, and the only way to see it is to log in as a customer while a campaign is switched on.

## Goals
- Add a **Preview** button on the admin Mystery Box page that opens the real customer popup.
- The popup uses the campaign form's current values (title, image, reward wording, bullets, orders needed per day, boxes per day), including unsaved edits, and works for campaigns that are switched off.
- Add a state switcher with three states: **Locked** (for example "Complete 4 more orders today…"), **Ready to open**, and **Opened** (a sample prize).

## Non-goals and anti-goals
- The preview must never call the server: no box opened, no stock used, no order created, no navigation to the buy page. If the preview could change data, it has failed.
- Customer behaviour does not change.

## Approach
- **Chosen:** split `MysteryBoxModal` into a presentational `MysteryBoxDialog`, which receives campaign, progress, state and callbacks as props, and the existing connected `MysteryBoxModal`, which loads the live data and passes it in. The admin preview renders `MysteryBoxDialog` with form values and fake callbacks. Because the preview doesn't use the data hook, it cannot reach the server.
- **Rejected:** a `preview` flag on the connected modal. The live data hook would still run for the admin, and a forgotten branch could call `open-mystery-box`.
- **Rejected:** a separate copy of the popup for admins. It would drift away from what customers see.

## Details
- Sample progress per state: Locked means 1 order done today. Ready means `boxes_available` is 1. Opened means the reveal screen.
- Sample prize: the first active prize in the pool, or "5GB MTN Data" if the pool is empty.
- Image: the newly chosen file (shown via an object URL) if one is selected, otherwise the saved `image_url`.
- In preview mode the "Open your box" button shows the reveal without calling the server, the locked button does nothing, and a small "Preview — nothing is sent" note is shown.

## Left to the builder
- Exact placement of the button: next to "Save campaign".
- The state switcher shows as a row of three buttons inside the preview panel.
