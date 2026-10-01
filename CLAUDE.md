# CLAUDE.md — Bangla Monopoly



Full project specification: see SPEC.md (source of truth for rules, board, stack, build order).



## Environment

- Windows, PowerShell. Project root: H:\bangla-monopoly

- Node.js 18+. Run locally with `npm run dev` (node --watch), open http://localhost:3000



## Working rules (must follow)

1. Build ONE step of the build order at a time. After finishing a step, STOP and wait for my confirmation before starting the next.

2. Write complete files. No placeholders like "rest of the code here".

3. Stack exactly as in SPEC.md: plain HTML/CSS/JS frontend, Node + Express + Socket.IO backend, in-memory state. No React, TypeScript, bundlers or extra frameworks unless I ask. Ask before adding any npm dependency.

4. Game logic is SERVER-AUTHORITATIVE. Client only renders state and sends action requests. Server validates every action (turn order, funds, ownership).

5. All player-facing UI text in Bangla (Bengali script). Code, variable names and comments in English.

6. Simple, commented, beginner-readable code. Clarity over cleverness.

7. Missing/ambiguous values: propose a sensible default, state it, and put it in a config/data file (game/config.js or /data).

8. Mobile-friendly, responsive layout required.

9. At the end of each step, report: files created/changed, how to test locally (PowerShell commands), next step.

10. If you find a bug or rules conflict in SPEC.md, tell me instead of silently working around it.

11. Server must read PORT from process.env.PORT (Render deployment).



## Decided defaults (editable in game/config.js; override here if I change them)

1. Rents: scale each property's classic Monopoly rents by its own price ratio (new price / classic price), then rounded: rents under ৳50 to nearest ৳1, rents ৳50 and above to nearest ৳5. Full-set rent = exactly 2x the rounded base rent. Rents must strictly increase base < set < 1-4 houses < hotel (checked by `npm run check`).

2. Railroad rent 25/50/100/200, utility 4x/10x, house costs, GO ৳200, jail fine ৳50, taxes: exactly as in SPEC.md (not scaled).

3. Jail: 3rd failed doubles attempt -> pay ৳50 and move by that same roll. Escaping jail with doubles moves you but gives no extra roll.

4. Bankruptcy: creditor receiving mortgaged property pays 10% interest immediately. Bank as creditor: buildings return to bank, properties auctioned unmortgaged.

5. Buying and auctions (house rule "C", overrides SPEC.md §8 "else start an AUCTION"): declining to buy ("কিনব না") or letting the buy timer (BUY_DECISION_SECONDS) run out means NO auction; the property stays unowned and the turn continues. Owner auction: a player who lands on their own property/railroad/utility may choose "নিলামে তুলুন" or "রেখে দিন" within OWNER_AUCTION_DECISION_SECONDS (10s, timeout = keep). Not allowed if that property is mortgaged or any property in its color group has houses/hotel (server rejects it too). Only the other players bid; the owner cannot. Minimum first bid = OWNER_AUCTION_MIN_RATIO (0.5) x list price, rounded up to the nearest ৳10. Bidding: +৳10/+৳50/+৳100 above the highest bid, "পাস" (a player who passed cannot bid again), AUCTION_SECONDS (10s) countdown reset on each bid, early end when all other bidders have passed, server checks cash. The winner pays the OWNER and gets the property; no bids -> owner keeps it. The auction engine stays reusable: Step 9 bankruptcy uses bank auctions (seller = bank, everyone can bid, min ৳10).

6. Housing shortage: first come, first served (no shortage auction).

7. Player colors: red, green, blue, yellow, purple, orange.

8. Disconnected player: host can skip their turn after 60s, bankrupt them (assets to bank -> auction) after 3 minutes.

9. Host leaves: next player in seat order becomes host. Empty room deleted after 10 minutes.

10. Room code: 4 uppercase English letters excluding I and O.

11. In-memory state: any server restart/redeploy ends active games (accepted limitation).



## Build progress

### Current status (2026-10-01)

- Done and confirmed: all Steps 1-11, the game is deployed (setup, board, rooms/lobby, turns + server roll timer, buying/rent/taxes with house rule C owner auctions, cards + jail, houses/hotels/mortgage, trading, debts/bankruptcy/win, reconnection/polish/mobile). Also done: modern minimal UI, three-column layout, title-deed cards, DEBUG_DICE next-card picker.

- In progress: UI-only "3D glass" redesign (no rule or logic changes).

- Next: test the redesign on desktop and phones, then redeploy.


- [x] 1. Project setup, Express + Socket.IO server, deploy-ready

- [x] 2. Board data + static board rendering

- [x] 3. Room system: create/join/lobby/token select/start

- [x] 4. Core game loop: turns, dice, movement, GO salary

- [x] 5. Buying, rent, taxes, auction

- [x] 6. Cards and jail logic

- [x] 7. Houses/hotels, mortgage

- [x] 8. Trading

- [x] 9. Bankruptcy and win condition

- [x] 10. Reconnection, polish, animations, mobile fixes

- [x] 11. Deployment guide for Render + GitHub

Update this checklist when I confirm a step is done.

