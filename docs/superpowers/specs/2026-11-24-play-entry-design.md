# One Play entry — design

Date: 2026-11-24. Size: small change (short design).

## Intent

Players should see one way to start a game, not two apps called "Solo" and "Online". Solo stays: it runs bots on the device (offline, no Worker CPU), and it alone has PBN import, board sets against the field, and "Play this deal again". The lobby gains one **Play** panel; choosing "Me and bots" runs the solo engine, choosing "With other people" creates an online table.

## Goals

- The signed-in lobby's main panel is **Play**, with a choice of **Me and bots** or **With other people**, and a **Play** button.
- Me and bots: Your seat, Bot skill (Beginner, Intermediate, Advanced, Expert), Bidding style (SAYC, 2/1), Scoring (Rubber bridge, Single deals). Play opens solo and deals the first hand at once.
- With other people: Table name, Bidding style, Scoring (Rubber, Duplicate), Show in lobby. Play does what **New table** does today (create, then open the table).
- Solo remembers the Me-and-bots choices (seat, bot skill, bidding style, scoring, and that opponents are bots) between visits.

## Non-goals

- No change to sign-in gating (option A: Play lives in the account-gated lobby; `#/solo` keeps working directly).
- No change to **New duplicate session**, Open tables, or online table behaviour.
- No shared setup component between lobby and solo.

## Anti-goals

- Starting "Me and bots" must never create a server table or use Worker CPU.
- A hand in progress in solo must not be thrown away by pressing Play in the lobby without the player seeing it (see below).

## Approaches

1. **Saved settings handoff — chosen.** The lobby writes the Me-and-bots settings to the same browser storage solo already uses for scoring and hints, then navigates to `#/solo` with a start-now request; solo reads its settings from storage and deals. Small, keeps lobby and solo independent, and gives solo remembered settings for free.
2. One shared setup component used by both — rejected: a large refactor of `App.tsx` for little visible gain.

## Decided

- Lobby header: the **Solo play** button goes; **Recent hands**, account name, and **Sign out** stay. The **New table** form is replaced by the Play panel.
- Solo start screen: **Play online** becomes **Lobby** (goes to `#/online`). The start screen itself stays (reached after leaving a game, or via `#/solo`), and keeps its setup fields, Recent hands and PBN import.
- Solo's Settings dialog keeps Opponents (Manual table / Bots), Dealer and Vulnerability, so manual tables remain available.
- Solo's default opponents become Bots when nothing is stored (today it defaults to Manual table).
- The start-now request is one-shot: solo consumes it, so reloading `#/solo` does not deal again.
- If solo already has an unfinished hand when start-now arrives, solo resumes that hand instead of dealing a new one (the player can finish or abandon it from the game menu as today).

## Left to the builder

- Storage key names and the exact start-now mechanism (a hash such as `#/solo/start`, or a one-shot storage flag), following the existing route and storage patterns.
- Layout and copy of the Play panel within the existing lobby styles.
- Update previews (lobby screen 1, solo start screen 17), README preview table text, `CHANGES.md`, and tests.
