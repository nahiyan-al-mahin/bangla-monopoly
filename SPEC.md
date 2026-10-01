\# PROJECT: বাংলা মনোপলি (Bangla Monopoly) — Online Multiplayer Web Game



\## 1. Goal

A web-based Monopoly clone themed on Bangladesh. 2 to 4 players join a private room using a room code from their own devices and play in real time. All game mechanics are the same as classic Monopoly. Only the board content (districts), currency, and naming are Bangla.



\## 2. Tech Stack

\- Frontend: plain HTML, CSS, JavaScript (no framework, no build step). Served as static files from the Node server.

\- Backend: Node.js + Express + Socket.IO

\- State: in-memory on the server (object keyed by room code). No database.

\- Deployment target: Render (free web service), code on GitHub. Server must read PORT from process.env.PORT.

\- Suggested structure:

&#x20; /server.js

&#x20; /game/ (engine.js, rooms.js, cards.js)

&#x20; /data/ (board.js, cards data)

&#x20; /public/ (index.html, game.html, css/, js/, assets/)

&#x20; /package.json



\## 3. Multiplayer / Room Requirements

\- Home screen: enter name, then "Create Room" or "Join Room" (enter 4-letter code).

\- Room creator is the host. Lobby shows joined players, each picks a token and color (no duplicates). Host starts the game when 2-4 players are present.

\- Max 4 players per room. Reject joins to full or already-started rooms (except reconnection).

\- Reconnection: store a player token in localStorage; if a player refreshes or disconnects, they can rejoin the same seat. Show "disconnected" status; if a player is away for long, host can choose to skip/bankrupt them.

\- Server keeps the full game state and broadcasts updated state to the room after every action.

\- Only the current player can roll/act on their turn (except auctions, trades, and mortgage actions allowed per rules).

\- In-game simple text log of events (in Bangla) visible to everyone.



\## 4. Currency \& Start

\- Currency: টাকা (৳). Starting money: ৳1500 per player.

\- Passing or landing on "শুরু" (GO): collect ৳200.

\- Tokens: রিকশা, নৌকা, ইলিশ মাছ, হাতপাখা, লুঙ্গি, পান্তা ভাত (use emoji or simple icons; max 4 used).



\## 5. Terminology (Classic -> Bangla)

\- GO -> শুরু

\- Jail -> হাজতখানা (Just Visiting -> শুধু দেখতে আসা)

\- Go To Jail -> হাজতখানায় যাও

\- Free Parking -> চায়ের দোকান

\- Community Chest -> সমাজকল্যাণ

\- Chance -> ভাগ্য

\- Income Tax -> খাজনা (৳200)

\- Luxury Tax -> ভ্যাট (৳100)

\- Railroads -> রেলস্টেশন

\- Utilities -> ইউটিলিটি



\## 6. Board (40 squares, clockwise, index 0-39)

Only the DISTRICT NAME is printed on the board square. The "famous" note is reference only (optional tooltip/detail card).



Format: index | name | type | color group | price



0  | শুরু | go

1  | নোয়াখালী | property | brown | 70   (ref: গান্ধী আশ্রম, নিঝুম দ্বীপ)

2  | সমাজকল্যাণ | community

3  | দিনাজপুর | property | brown | 70   (ref: কান্তজীউ মন্দির)

4  | খাজনা | tax | 200

5  | কমলাপুর রেলস্টেশন | railroad | 220

6  | বাগেরহাট | property | lightblue | 110   (ref: ষাটগম্বুজ মসজিদ)

7  | ভাগ্য | chance

8  | নারায়ণগঞ্জ | property | lightblue | 110   (ref: পানাম নগর)

9  | বগুড়া | property | lightblue | 130   (ref: মহাস্থানগড়)

10 | হাজতখানা / শুধু দেখতে আসা | jail

11 | পটুয়াখালী | property | pink | 150   (ref: কুয়াকাটা)

12 | তিতাস গ্যাস | utility | 160

13 | রাঙামাটি | property | pink | 150   (ref: কাপ্তাই লেক)

14 | নওগাঁ | property | pink | 170   (ref: সোমপুর মহাবিহার)

15 | বিমানবন্দর রেলস্টেশন | railroad | 220

16 | টাঙ্গাইল | property | orange | 200   (ref: মধুপুর গড়)

17 | সমাজকল্যাণ | community

18 | কুষ্টিয়া | property | orange | 200   (ref: লালন আখড়া)

19 | ময়মনসিংহ | property | orange | 220   (ref: আলেকজান্ডার ক্যাসেল)

20 | চায়ের দোকান | free parking

21 | কুমিল্লা | property | red | 240   (ref: ময়নামতি)

22 | ভাগ্য | chance

23 | রংপুর | property | red | 240   (ref: তাজহাট জমিদার বাড়ি)

24 | যশোর | property | red | 260   (ref: মাইকেল মধুসূদন দত্তের বাড়ি)

25 | আখাউড়া জংশন | railroad | 220

26 | খুলনা | property | yellow | 280   (ref: সুন্দরবন)

27 | বান্দরবান | property | yellow | 280   (ref: নীলগিরি)

28 | রূপপুর বিদ্যুৎ | utility | 160

29 | গাজীপুর | property | yellow | 300   (ref: ভাওয়াল জাতীয় উদ্যান)

30 | হাজতখানায় যাও | go\_to\_jail

31 | সিলেট | property | green | 320   (ref: জাফলং, রাতারগুল)

32 | মৌলভীবাজার | property | green | 320   (ref: শ্রীমঙ্গল চা বাগান)

33 | সমাজকল্যাণ | community

34 | চট্টগ্রাম | property | green | 340   (ref: পতেঙ্গা, বন্দর)

35 | পার্বতীপুর জংশন | railroad | 220

36 | ভাগ্য | chance

37 | কক্সবাজার | property | darkblue | 380   (ref: সমুদ্রসৈকত, সেন্ট মার্টিন)

38 | ভ্যাট | tax | 100

39 | ঢাকা | property | darkblue | 440   (ref: সংসদ ভবন, আহসান মঞ্জিল)



Color groups: brown(2), lightblue(3), pink(3), orange(3), red(3), yellow(3), green(3), darkblue(2). 4 railroads, 2 utilities.



\## 7. Rent \& Building Costs (NOT yet finalized)

Follow classic Monopoly rent structure (base rent, monopoly = double base rent with no houses, 1-4 houses, hotel), scaled proportionally to the prices above (prices are roughly 10% above classic). Generate the full rent table in /data/board.js as editable data and show it to me for review. Suggested house cost per group: brown/lightblue 50, pink/orange 100, red/yellow 150, green/darkblue 200 (hotel = 4 houses + 1 extra house cost). Mortgage value = half of price; unmortgage = mortgage + 10%. Railroad rent: 25/50/100/200 by number owned. Utility rent: 4x dice roll with one, 10x with both.



\## 8. Game Rules to Implement (same as classic Monopoly)

\- Turn: roll two dice, move clockwise. Doubles = roll again; three doubles in a row = go to jail.

\- Landing on unowned property: option to buy at list price, else start an AUCTION among all players (starting bid ৳10, increments).

\- Landing on owned property: pay rent to owner (unless mortgaged).

\- Monopoly (full color set) enables building. Even-building rule required. Houses/hotels: limit 32 houses and 12 hotels in the bank.

\- Selling buildings back to the bank at half price.

\- Mortgaging/unmortgaging properties.

\- Jail: go via "হাজতখানায় যাও" square, a ভাগ্য/সমাজকল্যাণ card, or three doubles. Get out by paying ৳50, using a Get Out of Jail Free card, or rolling doubles (max 3 attempts, then pay ৳50 and move).

\- Chance (ভাগ্য) and Community Chest (সমাজকল্যাণ) decks: shuffled, 16 cards each, with Bangladesh-flavored Bangla text. Include movement, collect/pay money, pay per house/hotel, go to jail, get out of jail free, advance to nearest railroad/utility. Put all cards in /data as editable data.

\- Free Parking (চায়ের দোকান): no money, just a rest square (classic rule).

\- Trading between players: properties, cash, and get-out-of-jail cards, with accept/reject.

\- Bankruptcy: if player cannot pay, they must sell/mortgage; if still unable, they go bankrupt and assets transfer to the creditor (or bank -> auction). Last player remaining wins.

\- Game-end: winner screen.



\## 9. UI Requirements

\- Classic square board: 11x11 grid layout, 40 squares around the perimeter, colored strips on property squares, district name in Bangla.

\- Center of board: dice, current player, action buttons (পাশা ফেলো, কিনুন, নিলাম, শেষ করুন, etc.).

\- Player tokens animated along the board.

\- Side panel: all players' money, owned properties (grouped by color), and event log.

\- Clicking a square shows its detail card (price, rent table, owner, famous place note).

\- Modals for: buy decision, auction, trade, card drawn, jail options, bankruptcy.

\- Bangla numerals optional toggle; default to showing ৳ with English digits.

\- Font: use a Bangla-supporting Google Font (e.g., Hind Siliguri or Noto Sans Bengali).

\- Responsive for desktop and mobile.



\## 10. Build Order (please follow, one step at a time)

1\. Project setup, folder structure, package.json, basic Express + Socket.IO server, deploy-ready.

2\. Board data file + static board rendering (no game logic).

3\. Room system: create/join/lobby/token select/start.

4\. Core game loop: turns, dice, movement, GO salary.

5\. Buying, rent, taxes, auction.

6\. Cards (ভাগ্য / সমাজকল্যাণ) and jail logic.

7\. Building houses/hotels, mortgage.

8\. Trading.

9\. Bankruptcy and win condition.

10\. Reconnection, polish, animations, mobile fixes.

11\. Deployment guide for Render + GitHub (step-by-step).

