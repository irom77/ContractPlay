# Changes

## Unreleased

- When the human and bot partner win the contract, the human now controls both declaring-side hands after the opening lead, including turns where the bot is nominally Declarer.
- Online tables now transfer both declaring-side hands to a human in dummy when Declarer is a bot; the server authorizes those plays and reveals Declarer's cards only to that human after the opening lead.
- Solo play now scores rubber bridge by default. Contract points go below the line and overtricks, undertricks, slam bonuses, the doubled insult, and honors go above it; part scores carry over until a side reaches 100, a side that has won a game is vulnerable, the dealer rotates each deal, and the rubber ends with a 700 or 500 bonus when a side wins two games. The scoresheet is shown after each hand and in the table menu, survives a reload, and "Start a new rubber" resets it. "Single deals" in the new Scoring setting keeps the previous behavior with a chosen dealer and vulnerability.
- The hand result now says whether the contract made or went down, the tricks taken against the tricks needed, and the number of overtricks or undertricks, followed by the points.
- Hints can also be switched on in the deal settings before a hand starts, as well as with the Hints switch at the table during bidding and play.
- Added online tables, live at https://contractplay.niuk.workers.dev (the GitHub Pages web app is built without the online entries; desktop and iOS builds do not offer online play yet). From "Play online" on the start screen or "Online tables" in the table menu you can open a lobby, create a listed or unlisted table, share its link, and take a seat with a display name; no account is needed. Each seat can be a person or a bot at a skill level you choose, and a hand starts when all four seats are filled and at least one is a person.
- Online play is dealt and checked by the service, so you see only your own cards, dummy after the opening lead, and all hands when the hand ends. Tables keep running totals. If a player is away, another seated player can hand the seat to a bot, and the player takes it back on return; the host can hand an idle player to a bot after two minutes.
- Finished online hands are saved to the hand history for review and PBN export. Online tables have no take-back, PBN import, chat, voice, or video, and a seat is tied to the browser, so clearing browser data or changing device loses it.
- Online tables now include the same off-by-default Hints switch as solo play: high-card points and a suggested call or card with a reason, plus clickable call meanings. Hints are calculated from the player's visible cards and public play.
- Online hand results now show tricks taken against the contract target and how many were short or over. Between hands, the four seats use a compact grid with Deal directly below.
- Online table seats now keep their compass cross layout at every screen width, with North and South centered and West and East at the sides.
- Added a development-only `/admin` page to list listed and unlisted online tables and remove a table after confirmation. It is currently open without sign-in; add RBAC before public production use.
- Bots now follow a full set of SAYC and 2/1 agreements. Beyond the earlier rules they answer Jacoby 2NT, limit raises and game tries, continue after a strong 2♣ and a weak two (including the 2NT feature ask), use and answer Blackwood with the king ask, bid on after fourth suit, and never stop below game in a 2/1 game-forcing auction. SAYC and 2/1 differ where the systems do, for example after 1♠–1NT.
- Bots compete more fully. Partner's takeout double is advanced by strength (jump with 9–11, cue bid with 12+), and from Intermediate up bots double or overcall the opponents' preempts and 1NT openings, rebid as overcaller and doubler, and compete as opener and responder after interference. Advanced and Expert also balance in the pass-out seat, reopen with a double, and open light in third and fourth seat.
- Bots bid game in contested auctions when the partnership has shown the points for it. In simulated deals, hands with 27+ points stopping in a partscore fell from just under 3% to about 1%.
- Skill levels now play the cards differently. Advanced draws trumps as declarer, ruffs when void, plays third hand high, and discards from its weakest suit; Expert also cashes cards that have become winners, leads a singleton against a suit contract, and keeps winners when discarding. Against the same contracts, each level takes more tricks than the one below it.
- Hints explain more calls: answers to Jacoby 2NT, a reopening double, and responder's waiting 2NT after a strong 2♣.
- Bots read every auction from the opening bid, so passes before the opening no longer need special handling.

## 0.1.9 - 2026-11-10

- Bots no longer pass partner's forcing bids. Opener now rebids naturally over a new-suit response and over a negative double, responder bids on over a reverse or a new suit after a two-level response, and a cue-bid raise is answered. Before this, a bot passed one of these in about 3% of deals, sometimes with 20 or more points.
- Bots now compete after a pass before the opening bid. Overcalls, takeout doubles, balancing, and most follow-up bids used to work only when the opener was the dealer.
- Bots reach game more often: responder answers one of a suit with 6+ points and 1NT with 8+ points even with an awkward shape, a strong opener jumps or reverses with 19+ points, and a hand that knows the partnership has 26 points bids game. Simulated deals with 27+ points stopping in a partscore fell from about 8% to under 3%.
- The web app is live on GitHub Pages at https://irom77.github.io/ContractPlay/.

## 0.1.8 - 2026-11-10

- Added About ContractPlay to the table menu; it shows the app version.
- Recent hands now have a generated name such as "Quiet Squeeze" and show the date and time played, in place of "Hand 1", "Hand 2". Hands saved earlier get a name too.
- Added "Let bots finish this hand" to the table menu: bots make every remaining call and play for all four seats, at a manual table or against bots. "Take back control" in the menu, or Take back, returns the hand to you.
- The table is now a vibrant green felt, bright emerald at the center and deeper green at the edges, with a faint watermark of the bridge mark and the four suits at the center. Start-screen settings sit on dark panels so they stay readable.

## 0.1.7 - 2026-11-10

- Added a Hints switch (off by default, remembered on the device) in place of the Show hint button. With hints on, the auction shows your high-card points and highlights the suggested call in the bidding box with its meaning; clicking any call beside a seat explains what it shows; and card play highlights one suggested card with a one-line reason. Suggestions follow the Expert bot and the selected bidding style, and a host solver still takes precedence for card hints.
- Fixed bots occasionally choosing a call that was no longer legal (about 1 auction in 75), which left the table waiting on the bot. This happened mostly after a strong 2♣ opening with a positive response, a 2♠ Stayman answer, and a few weak-two, 2/1, Unusual 2NT, and king-ask continuations. Those rules now bid at a legal level or stop, and a bot passes if any rule ever picks an unavailable call.
- Added screenshots of bidding, card play, and hints to the README.

## 0.1.6 - 2026-11-10

- The table now fills the window and never scrolls: the header, footer, and "Auction" / "Playing as" headings are gone, and every size follows the window. Contract, NS/EW tricks, and whose turn it is sit top-left; the last trick stays in view top-right with its winner outlined; Take back / Redo and Show hint sit in the bottom corners. The hand result and a Next deal button appear at the center of the table.
- Added full-screen mode: use the button at the top-right or press F (Esc leaves it). The desktop app switches its window to full screen.
- Redesigned the playing cards with bold black and red suits, large corner indices, printed-style pip layouts, and framed court cards; pips never sit under a rank. The hand is fanned along the bottom edge, and dummy is laid out as real cards and played by clicking them while declarer's own cards stay visible.
- Each seat shows its full call history as bidding-box chips during the auction; during play, click the contract to show or hide the bidding. A red ring marks a vulnerable side and "D" marks the dealer. The table is drawn from the user's seat against bots, and from declarer's seat at a manual table.
- Auction calls now appear beside the seats that made them while the bidding controls stay compact at center; the table no longer repeats auction/play phase headings. Dummy appears at its compass seat after the opening lead and remains visible through hand completion.

## 0.1.5 - 2026-10-28

- Replaced the auction call selector with a Trickster-style bidding box: calls are arranged by level and strain, unavailable contract bids and doubles are disabled, and the auction history is aligned by seat.

## 0.1.4 - 2026-10-28

- Played cards now sit by compass seat; completed tricks remain visible for two seconds, the last trick can be reopened, and live NS/EW trick totals stay in view.
- Show hint and Take back sit beside the hand cards. Card input and bot play pause until the completed trick display clears.
- Moved completed roadmap checklist history into `TODO-archive.md` to keep the active roadmap focused.

## 0.1.3 - 2026-10-28

- During card play, the auction is tucked into a right-edge drawer that opens on hover, focus, or click; classic card faces and clear “to play” / “played” seat markers make the table easier to follow.

## 0.1.2 - 2026-10-28

- Imported deals now show the current player's 13 cards during the auction; cards remain non-interactive until play begins.
- Added a Tauri 2 host for Windows, macOS, iOS, and iPadOS, native PBN file pickers with scoped text-file access, and save-on-suspend lifecycle handling. Added a shared SVG app icon and relative web asset paths.
- Added Windows/macOS installer and iPad simulator CI workflows, GitHub Pages deployment, and draft desktop releases from version tags. Windows/macOS installers and the iPad simulator build/install/launch passed in [GitHub Actions](https://github.com/irom77/ContractPlay/actions/runs/40745554895).
- Documented local platform builds, web deployment, signing, store submission, and account/device requirements in [the platform delivery guide](docs/platform-delivery.md).
- Expert can use Blackwood after 3♥–3♠ establishes a spade fit and the Grand Slam Force after a weak-three major fit reaches game. Weak-three Blackwood skips an unproductive king ask when responder holds no kings and places 7M directly when responder holds all four.
- In a 2/1 game force after opener raises responder's minor, responder can show a three-card major fit below game with 15+ HCP; opener completes game, while 13–14 HCP fast-arrives.
- Expert can continue Blackwood after 3♣/3♦–3♥/3♠–4M confirms a major fit, asking for aces and kings before placing small or grand slam.
- Expert can investigate slam after an uncontested 3♣/3♦ opening with 19+ HCP and five-card support, using Blackwood ace and king asks.
- SAYC and 2/1 bots now invite or place game after a simple major raise, and SAYC openers accept limit raises only with game values; same-suit raises are no longer classified as jump shifts.
- Expert Blackwood over an uncontested weak three major now asks for kings after all four aces are accounted for and places grand slam only when all four kings are known.
- Expert Blackwood now continues after a direct 2/1 response, opener's natural side-major rebid, and responder's game raise; the sequence covers ace and king asks and slam placement.
- Expert does not treat a passed responder's later two-level suit response as a 2/1 game force for Blackwood.
- Intermediate, Advanced, and Expert bots cover an opponent's led honor with the cheapest higher honor when acting second hand; they retain second-hand-low when no cover applies.
- Expert 2/1 bidding now continues Blackwood after opener raises responder's minor to the three level, including the ace response, king ask, and minor-slam placement.
- After a 2/1 game-forcing response and opener's balanced 2NT rebid, responder can show a four-card side major without support for opener; opener raises a three-card fit or places 3NT.
- After a 2/1 opener repeats the major following a two-club response, responder can show a four-card side major naturally at the two level; opener finds the fit or places 3NT.

- Expert 2/1 slam tools now continue through the side-major fit route: responder can ask for aces with 4NT, ask for kings with 5NT after all aces are known, and place a grand slam only when all kings are confirmed. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-two-over-one-blackwood.md).
- After an uncontested 1M–2♣–2♦ 2/1 game force, responder can show a four-card side major at the two level without three-card support for opener; opener raises a three-card fit and responder places game, or opener places 3NT without one. See [implementation plan](docs/superpowers/plans/2026-10-26-two-over-one-responder-side-major.md).
- SAYC bots now use a natural jump-shift response with a five-card suit and 19+ HCP, continue with opener's fit or natural description, and place game; 2/1 response selection remains distinct.
- SAYC openers now require 16+ HCP to reverse to 2♠ after 1♥–2♦; below that strength they repeat hearts when no eligible side suit applies.
- Expert bots can use the Grand Slam Force after a SAYC strong jump shift finds a major fit at game; with fewer than two top trump honors, they retain the Blackwood route and king ask.
- After SAYC 1M–2m, balanced openers with 18–19 HCP now rebid 2NT; responder places game in a three-card major fit or in 3NT.
- Maximum unbalanced SAYC openers after 1M–2m now jump-raise a supported responder minor, jump-shift to a four-card side suit, or jump-rebid a six-card major; responder continues to game.
- SAYC 1♠–2♥ now has natural opener rebids and responder continuations for a heart fit, a repeated spade suit, a side suit, and strong balanced notrump.

- Expert bots use Smolen after Stayman denial over 1NT to show a game-forcing 5-4 major pattern; opener raises the longer major with three-card support, and responder corrects 3NT only with a six-card major.
- After 1M–1NT–2m, responders with 13+ HCP and three-card support now raise opener's major to game; 11–12 HCP still invites at the three level.
- Expert 2/1 bots now use New Minor Forcing after 1m–1M–1NT: responder asks with the unbid minor, opener shows major support or a side major, and responder places the contract. SAYC keeps its existing Expert Checkback sequence.

Project changes are recorded here, newest first. Keep entries short and link implementation plans when useful.

- Centered the auction on the table, enlarged the cards, moved setup/import/history into a compact table menu, and displayed the current app version in the header.

- Over a weak three-level opening, responders with three to six trumps now place a preemptive raise one level above their trump length; stronger game, 3NT, and forcing-suit responses retain priority, and opener passes. See [implementation plan](docs/superpowers/plans/2026-10-27-intermediate-weak-three-preemptive-fit-raise.md).
- The client now exports completed hands as PBN and retains imported tags and comments through autosave and hand completion; PBN play import follows the trick winner when assigning the next lead.
- After an uncontested 3♥ opening, Intermediate, Advanced, and Expert responders with 16+ HCP and a six-card spade suit containing two honors can bid 3♠; after 3♠, the same agreement allows 4♥ with a six-card heart suit. Opener raises a three-card fit to game or repeats the preempt suit, then responder places the contract. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-weak-three-major-new-suit-response.md).
- After an uncontested 3♣/3♦ opening, Intermediate, Advanced, and Expert responders with 16+ HCP and a six-card major containing two honors among ace through ten can make a natural forcing response; opener raises a three-card fit or repeats the minor, then responder places 4M. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-weak-three-natural-major-response.md).
- Expert responders with 19+ HCP and three-card support can use direct 4NT Blackwood over an uncontested weak 3♥/3♠ opening; opener answers aces and responder places 5M or 6M. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-blackwood-over-weak-three.md).
- Over partner's 3♣/3♦/3♥/3♠ preempt, Intermediate responders bid 3NT only with an eight-card AKQJ side suit, an outside ace, and stoppers in the other side suits; opener passes. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-weak-three-notrump-response.md).
- After an uncontested partner 3♥/3♠ opening, Intermediate responders with four-card support and 15+ HCP, or 4.5+ estimated quick tricks, bid 4M; opener passes. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-weak-three-quick-trick-game-response.md).
- Intermediate, Advanced, and Expert open 3♣/3♦/3♥/3♠ with 5–10 HCP, a seven-card suit with two honors among ace through ten, and no outside four-card major; Beginner behavior and responses to these openings are unchanged. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-weak-three-opening.md).
- After 1M–1NT–2m, a weak responder with a doubleton in opener's major and fewer than four cards in opener's minor now prefers 2M; a five-card alternate major remains natural in both SAYC and 2/1. See [implementation plan](docs/superpowers/plans/2026-10-26-forcing-notrump-major-preference.md).
- After 1M–1NT–2m, an unbalanced responder with 11–12 HCP and five-card support now invites at 3m in both SAYC and 2/1; opener accepts in 3NT with 16+ HCP, four-card support, and stoppers in the other suits. See [implementation plan](docs/superpowers/plans/2026-10-26-forcing-notrump-minor-raise.md).
- After 1M–1NT–2m, a balanced responder with 11–12 HCP now needs stoppers in both unbid suits to invite in 2NT; with a doubleton in opener's major and a missing stopper, responder prefers 2M. See [implementation plan](docs/superpowers/plans/2026-10-26-forcing-notrump-stopper-requirement.md).
- Intermediate bots can make a balancing takeout double after a one-level opening and two passes with 10+ total points, shortness in opener's suit, and support for the unbid suits; a passed advancer can still make a natural minimum advance if opener passes. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-balancing-double.md).
- SAYC responder continuations after 1♠–2♣ now include 2♠ preference, a balanced 2NT invitation, a six-card club rebid, or a diamond raise after opener's 2♦; after 2♥, responder can invite with a heart fit or club suit, or prefer spades. See [implementation plan](docs/superpowers/plans/2026-10-26-sayc-two-over-one-preference.md).
- After a direct 2/1 minor response, an unbalanced opener with 12+ HCP now shows a four-card fit with a three-level raise; responder places the minor game with four-card support. Balanced 18–19 HCP hands retain the 2NT rebid. See [implementation plan](docs/superpowers/plans/2026-10-26-two-over-one-minor-raise.md).
- After a direct 2/1 1M–2♦ response, opener can show four clubs with 3♣; responder shows a four-card side major, places 5♣ with four-card support, rebids six diamonds, or chooses 3NT without a fit. See [implementation plan](docs/superpowers/plans/2026-10-26-two-over-one-club-rebid.md).
- Expert opening leads against suit contracts no longer underlead an ace from the selected suit; notrump lead choices are unchanged. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-suit-contract-ace-lead.md).
- Intermediate and Advanced bots now play the lowest legal card as second hand, avoiding unnecessary overtakes of an opponent's lead.
- After a SAYC major reverse to the alternate major, responder can invite with four-card support and 10+ HCP; opener accepts with three-card support and 16+ HCP. See [implementation plan](docs/superpowers/plans/2026-10-26-sayc-two-level-opener-rebid.md).
- Expert responders can use the Grand Slam Force after an accepted splinter raise with 18+ HCP and two top trump honors; opener bids 7M with two of A/K/Q in trumps, otherwise 6M. With 18+ HCP but fewer than two top trump honors, 4NT Blackwood remains available. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-grand-slam-force-after-splinter.md).
- Splinter detection now matches the agreed level for the opening major, so a natural 1♠–3♥ jump is not treated as a splinter.
- Expert openers can use the Grand Slam Force after a 2/1 auction establishes a major fit and responder places game; responder bids 7M with two of A/K/Q in trumps, otherwise 6M. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-grand-slam-force-two-over-one.md).
- Expert Blackwood auctions now ask for kings with 5NT after all four aces are confirmed; the bot uses the king count to choose 6M or 7M. The Jacoby Grand Slam Force remains separate. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-blackwood-kings.md).
- Expert Puppet Stayman over 2NT now finds opener's four- or five-card major, with follow-ups to place a fit in game or choose notrump. A responder with a 6–4 major holding can transfer to game after opener denies a fit. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-puppet-stayman.md).
- Expert responders use Texas transfers over notrump openings to place game in a six-card major while keeping opener as declarer. Over 1NT, use 8–9 HCP; over 2NT, use 0–9 HCP. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-texas-transfers.md).
- Intermediate bots now use Support Doubles after a minor opening and a one-level major response: double with exactly three-card support or raise with four or more after an opponent's suit overcall. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-support-doubles.md).
- Weak-two openings now deny an outside four-card major, protecting possible 4–4 major fits.
- Over a 1NT opening, a six-card minor with invitational values and two top honors can invite 3NT; opener accepts with a top honor and support. See [implementation plan](docs/superpowers/plans/2026-10-26-notrump-minor-invitations.md).
- After a weak-two opening, responder can show a natural five-card suit with 10–14 HCP; opener rebids the weak suit with a minimum or shows a feature with a maximum. See [implementation plan](docs/superpowers/plans/2026-10-26-weak-two-new-suit-response.md).
- After a 1NT opening, a weak hand with a six-card minor can use 2♠ to play in clubs or diamonds through opener's 3♣ relay. See [implementation plan](docs/superpowers/plans/2026-10-26-notrump-minor-signoff.md).
- Expert responders use Checkback Stayman after a minor opening, major response, and 1NT rebid to find major fits, then invite or place major game with an eight-card fit; balanced hands with stoppers can place or invite in notrump when the major fit is short or opener denies both majors.
- After a major opening and 1NT response, responders can show a five-card second major naturally after opener rebids a minor, below the direct two-level response strength. Opener invites with 3M on 16+ HCP and three-card support or returns to the opening major; responder accepts at 8+ HCP in SAYC or 10+ in 2/1.
- 2/1 bots now treat 1♥–2♠ as game-forcing when responder has 13+ HCP and five spades, and continue to game after opener shows spade support or a balanced 2NT rebid. SAYC keeps the natural one-level spade response.
- Expert bots now use Lebensohl after a natural 2♦/2♥/2♠ overcall of 1NT to show weak or invitational suits, distinguish 3NT stopper holdings, find a major through Stayman cue-bids, and start game-forcing three-level suit sequences. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-lebensohl-weak-suits.md).
- Expert bots now use Reverse Drury after a third- or fourth-seat major opening: a passed responder with a limit raise starts with artificial 2♣, then both hands place or invite game based on their strength. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-reverse-drury.md).
- After the Unusual 2NT overcaller shows a minimum in response to a strong cue-bid, advancer places game with 16+ HCP and three-card support or passes with 13–15 HCP.
- Added a game-invitational cue-bid after Unusual 2NT: advancer shows 13+ HCP and a fit; overcaller places game with 13+ HCP or rebids the preferred suit at level 3. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-unusual-notrump-advance.md).
- Weak advancers with 5+ card support for a suit shown by partner's Unusual 2NT now jump to level 4 as a preemptive raise. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-unusual-notrump-advance.md).
- After partner's Unusual 2NT overcall, balanced Intermediate advancers with 13+ HCP now place the contract in 3NT; weaker hands still prefer a shown suit. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-unusual-notrump-advance.md).
- After an Intermediate partner's Unusual 2NT overcall, advancers now make a level-three preference for the better-supported shown suit when the next opponent passes. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-unusual-notrump-advance.md).
- Intermediate bots now use a direct Unusual 2NT overcall over a one-level suit opening with at least five cards in each of the two lowest unbid suits. See [implementation plan](docs/superpowers/plans/2026-10-26-intermediate-unusual-notrump.md).
- Intermediate bots now use Michaels cue-bids over one-level openings and answer a partner's 2NT minor-suit ask after a major cue-bid.
- Intermediate bots now make preemptive jump overcalls in a six-card major or seven-card minor with 5–11 HCP and at least two honors.
- Added fourth-suit forcing after a one-level response and opener's suit rebid: with 10+ HCP, responder may bid the only unbid suit artificially, and opener continues by showing support, a notrump stopper, or the opening suit.
- Card-play hints now show a brief message if a host-provided solver fails; stale hint requests do not affect a replacement hand.
- After a SAYC 1M–2m sequence and opener's natural side-suit rebid, responder can show an unbid four-card major with 10+ HCP; opener raises with three-card support or continues in the original major without a fit. See [implementation plan](docs/superpowers/plans/2026-10-26-sayc-alternate-major-after-two-level-response.md).
- Corrected opener's rebid after sequences such as 1♦–1♠: a four-card heart suit now requires 16+ HCP and is shown at 2♥ as a reverse. See [implementation plan](docs/superpowers/plans/2026-10-26-opener-reverse-after-one-level-response.md).
- After an uncontested 1M–1NT response, opener now rebids 3NT with a balanced 20–21 HCP hand in both SAYC and 2/1. See [implementation plan](docs/superpowers/plans/2026-10-26-major-nt-rebid-20-21.md).
- Added the Expert Grand Slam Force after Jacoby 2NT: responder asks with 18+ HCP and two top trump honors; opener bids 7M with two of A/K/Q in trumps or 6M otherwise. See [implementation plan](docs/superpowers/plans/2026-10-26-expert-grand-slam-force.md).
- After an uncontested SAYC 1M–2m response, opener can show a natural four-card side suit or repeat the five-card major; responder can raise a four-card fit or place 3NT with balanced game values and stoppers.
- After a SAYC 1M–2m response and opener’s natural second-suit rebid, responder can invite in 2NT with balanced 10–12 HCP and stoppers, or show preference for opener’s major with 10+ HCP and two-card support.
- After a SAYC two-level response and opener’s repeated major, responder can invite with 2NT or raise with support; opener accepts a 3M invitation with 16+ HCP.
- Opener also accepts a 2NT invitation in that sequence with 3NT at 16+ HCP.
- Expert responders with 18+ HCP can ask for aces after opener accepts a splinter raise with game; opener answers and responder bids slam when at least three aces are known.
- Expert responders can also use Blackwood after a 2/1 game force establishes a major fit, with responder placing slam from the combined ace count.
- After an uncontested one-level suit response, opener can show a natural four-card lower-ranking side suit at the two level with an unbalanced 12–18 HCP hand in either bidding style.
- After a minor opening, one-level major response, and opener’s balanced 2NT rebid, responder accepts game with a balanced 8+ HCP hand in either style.
- After a SAYC 1♦–2♣ response, opener rebids five-card diamonds naturally; responder can raise with four-card support and 10+ HCP.
- After an uncontested major opening, responders with five-card support, a singleton or void, and fewer than 10 HCP can make a preemptive 4M raise.
- In SAYC, balanced 15–17 HCP responders with two-card support for opener's major can place the contract directly in 3NT when they have no four-card other major.
- In a 1♠–2♥ game force, opener now shows three-card heart support with 3♥ and responder places game in 4♥.
- After a one-level major response, openers with an unbalanced 19+ HCP hand and four-card support place game directly in the major.
- After 1♥–(1♦)–1♠, opener raises four spades by strength, rebids a six-card heart suit at 2♥/3♥ by strength, or shows a balanced hand with a diamond stopper at 1NT/2NT with 12–14/18–19 HCP.
- After 1♥–(1♦)–1♠–1NT, responders can invite with a balanced 10–12 HCP hand or five-card spade support, and place game with 13+ HCP.
- In 2/1, after responder rebids a six-card minor, opener shows three-card support for the minor game or places the contract in 3NT without support.
- After a major opening and a two-level minor overcall, responders can make a negative double with four or more cards in the unbid major and 6+ HCP.
- After a major opening and a one-level major overcall, responders can make a negative double with four or more diamonds and 6+ HCP.
- After a major opening and a one-level overcall, responders can bid an available new suit naturally at the one level with 4+ cards and 6+ HCP.
- After a major opening and 1NT response, opener places game with 19+ HCP and a six-card major when no side suit takes priority.
- After 1M–1NT–3M, responders accept the invitation at 8+ HCP in SAYC or 10+ in 2/1.
- In a direct 2/1 game force, responder chooses 3NT after opener's balanced 2NT rebid when no three-card major fit exists, even with a six-card minor.
- After responder shows a four-card side major in a direct 2/1 game force, opener raises to game with three-card support.
- Without three-card support for that side major, opener completes the game force in 3NT.
- A 2/1 continuation now stops at 4M after a major fit is agreed instead of incorrectly bidding 5M with a long responder suit.
- After 1♠–1NT–2♥, responders can invite with three-card heart support, place 4♥ with 13+ HCP, or invite/bid game in notrump with a balanced hand.
- After Jacoby 2NT and opener's shortness response, Expert can ask for aces with 4NT at 18+ HCP; opener answers with Blackwood steps and responder bids slam only when at least three aces are known.
- Expert responders can make a splinter raise after a one-level major opening with four-card support, one singleton or void, and 13+ support points; opener completes game in the major.
- After 1♥–(1♦), responders can bid 1♠ naturally with four or more spades and 6+ HCP in both SAYC and 2/1.
- After 1♠–(2♥), intermediate responders make a negative double with 4+ diamonds and 6+ HCP in both bidding styles.
- After 1NT–2♣–2♦ denies a major, responders can show a five-card major naturally at the two level, and opener raises with three-card support.
- Added an Expert bot skill with direct Gerber ace-asking over 1NT/2NT openings; its 4NT invitations remain quantitative.
- Added an Advanced bot skill: it follows Intermediate bidding and plays the top touching honor third hand when partner is winning.
- Responders now accept an opener's invitational jump raise to 3M with 10+ HCP, or pass with fewer points, in both bidding styles.
- Responders now continue after a 1♥–1NT–2♠ reverse by showing a major fit, bidding notrump with a spade stopper, or rebidding a natural minor.
- Added quantitative 4NT slam invitations after 1NT and 2NT openings when responder has a balanced hand without a major fit; notrump openers accept with maximum strength.
- Over a 2NT opening, responders can use Stayman with a four-card major, transfer with a five-card major, or bid 3NT with a balanced game hand; opener shows or denies a major fit, responder can find an alternate spade fit after a heart reply, and then places the contract.
- Strong 2♣ openings now include six-card-or-longer hands estimated at nine playing tricks below 22 HCP. Responders show a natural positive with an 8+ HCP five-card suit or balanced hand, and opener raises a supported positive major to game.
- After a waiting 2♦ response to strong 2♣, responders use Stayman or transfers after a balanced 2NT rebid, raise opener's natural suit rebid with support, place 3NT with balanced values and a stopper, or pass a weak hand without a fit.
- Extended the 2/1 game force after 1♠–2♣: opener can show four diamonds at 2♦ with 12–17 HCP, and responder can raise the suit to game with four-card support.
- Added the Jacoby 2NT game-forcing major raise in both SAYC and 2/1: responder shows 13+ HCP and four-card support; opener shows a singleton or void, or bids game without shortness.
- Added SAYC Stayman and Jacoby transfers over an uncontested 1NT opening, including opener's major response, transfer acceptance, game/invitation placement, and finding spades after a heart reply.
- SAYC and 2/1 bots now open balanced 20–21 HCP hands with 2NT and strong 22+ HCP hands with 2♣; after a waiting 2♦ response, opener rebids 2NT with 22–24 or 3NT with 25–27 balanced.
- Intermediate bots now open a natural weak two in a six-card major or diamond suit with 5–11 HCP and at least two honors among ace through ten.
- Over a weak two, Intermediate responders use forcing 2NT with game interest; opener shows a 5–8 HCP minimum, or with 9–11 shows an outside ace/king or bids 3NT without one.
- Weak-two responders can also raise to 3M/4M with trump support or bid 3NT directly with a balanced game hand and no major fit.
- Intermediate bots now use support points for partner’s overcalls: 6–10 points for a simple raise and 11+ points for a cue-bid raise.
- After partner’s strong-raise cue-bid, intermediate overcallers repeat their suit with a minimum, show a three-card side suit with 11+ HCP, or bid game with 15+ HCP.
- After a simple raise of an intermediate overcall, overcallers invite game with 11–14 HCP after a one-level overcall and bid game with 15+ HCP.
- Intermediate takeout doublers now pass minimum major advances, raise with 16–18 support points, jump-raise with 19+ support points, and accept game over a jump advance with 15+ support points.
- After advancer's strong cuebid of opener's suit, intermediate takeout doublers now name their longest available major, or longest available minor when no major is held.
- After opener's partner raises over a takeout double, intermediate advancers compete in a natural four-card suit with 6–8 support points, jump with 9–11, or cue-bid the raised suit with 12+.
- Intermediate bots now make a natural 1NT overcall with a balanced 15–18 HCP hand and a stopper in opener's suit.
- After a partner's natural 1NT overcall, responders with 8+ HCP and a four-card major can use 2♣ Stayman; the overcaller shows a four-card major or denies one with 2♦.
- After the Stayman reply, responders can invite in a shown major with 8–9 HCP, place major-suit game with 10+ HCP and support, or invite/bid game in notrump when there is no fit.
- After a 1NT overcaller shows hearts, responders with four spades and no heart fit can show spades; the overcaller raises a spade fit or bids notrump without one.
- Responders can also show a natural five-card suit at the two level with 6+ HCP, or a six-card club suit at 3♣ because 2♣ is Stayman.
- After a partner's 1NT overcall, responders without a four-card major can invite in 2NT with a balanced 8–9 HCP hand or bid 3NT with a balanced 10+ HCP hand.
- Intermediate bots now advance partner's takeout double with minimum or jump suit bids, natural notrump with a stopper, or a strong cuebid.
- Intermediate bots now make natural takeout doubles of one-level suit openings with opening values, shortness, and support for the unbid suits.
- Intermediate bots can advance partner's overcall in a natural five-card suit, requiring 6+ HCP for a one-level bid and 11+ HCP at the two level.
- Intermediate bots now advance partner's one-level overcall with natural 1NT on a balanced 8–11 HCP hand with a stopper in opener's suit.
- Intermediate bots now make simple raises with 6–10 support points and cue-bid strong raises with 11+ support points after partner's overcall.
- Intermediate bots now make natural direct overcalls after an opponent's one-level suit opening, showing a five-card suit and 8+ HCP at the one level or 10+ HCP at the two level.
- Added a simple competitive raise to 3M with 3+ card support and 6–9 HCP after a two-level overcall, in SAYC and 2/1.
- After 1m–1NT, opener now rebids a six-card minor with 12–17 HCP in both SAYC and 2/1.
- Added a natural two-level new-suit response with 5+ cards and 10+ HCP after a major opening and one-level overcall, in both SAYC and 2/1.
- Extended natural competitive notrump responses to minor openings in both SAYC and 2/1, using 1NT with balanced 6–9 HCP after a double or one-level overcall and 2NT with balanced 10–12 HCP after a two-level overcall with a stopper.
- Added a simple 2m competitive raise with five-card support and 6–9 HCP after an opponent's one-level overcall, for both SAYC and 2/1.
- Added negative doubles after a minor opening and one-level major overcall, showing 4+ cards in the unbid major and 6+ HCP; direct 1♠ responses over 1♥ now require five cards.
- Added natural one-level major responses after a minor opening and one-level minor overcall when the suit is available and responder has 4+ cards and 6+ HCP.
- Added natural one-level suit responses after a minor opening is doubled, with 4+ cards and 6+ HCP.
- Added a game-forcing cue-bid raise after a minor opening and one-level overcall, with three-card support and 10+ HCP.
- Added a strong raise cue-bid after a major opening and one- or two-level overcall, with three-card support and 10+ HCP.
- Added the 2NT limit raise or better after a takeout double in both styles, with four-card major or five-card minor support; opener shows a minimum at 3M and a maximum at game.
- Extended the simple major raise to takeout doubles: responder raises to 2M with three-card support and 6–9 HCP in both configured styles.
- Extended natural competitive responses to SAYC: after a double or one-level overcall, responder can bid 1NT with balanced 6–9 HCP (and a stopper over an overcall); after a two-level overcall, responder can bid 2NT with balanced 10–12 HCP and a stopper. A 6–9 HCP three-card major raise is also available after a one-level overcall.
- Improved intermediate opening leads: after honoring a touching sequence, the bot leads fourth-highest from its longest suit when that suit has at least four cards.
- Added 10–12 HCP responder invitations after 1M–1NT–2M: raise with three-card support or invite with 2NT on a balanced hand.
- Added a natural 2NT rebid with balanced 18–19 HCP after an uncontested direct 2/1 response.
- Added a strength-showing redouble with 10+ HCP after an opponent doubles partner's one-level suit opening.
- Added a 2/1 game-forcing continuation that shows a four-card side major when responder lacks support for opener's major.
- Completed the responder's game continuation after a balanced 2NT rebid in a direct 2/1 sequence.
- Added a six-card 2/1 response-suit rebid after opener repeats the major.
- Added a natural 2NT opener rebid with a balanced 18–19 HCP hand after 1m–1NT; responder accepts with 8+ HCP.
- Added a simple 2M raise with 6–9 HCP and three-card support after a one-level overcall in 2/1 style.

- Allow a direct 2/1 game-forcing response with three-card support for opener's major.

- Added the SAYC 3M invitational jump rebid with a six-card major and 16–18 HCP after 1M–1NT when no side suit takes priority.
- Added a natural SAYC 2M rebid after 1M–1NT with 12–15 HCP and no side suit to show.
- Added a natural, nonforcing 2NT response after a two-level overcall of a 2/1 major opening, with balanced 10–12 HCP and a stopper in the overcalled suit.
- Added natural, nonforcing 1NT responses after an opponent's double or one-level overcall in 2/1, requiring a balanced 6–9 HCP hand and a stopper over an overcall.
- Added 2/1 forcing 1NT responses and continuations, including passed-hand exceptions; responder can invite in notrump, show a three-card limit raise, or rebid a five-card heart suit below direct 2/1 strength.
- Corrected the SVG wordmark and app header mark to use ContractPlay branding.
- Rebranded the app and workspace packages as ContractPlay; existing `bridgelab.solo` saves migrate to the new storage key.
- Added a responder game acceptance: 3NT with 6+ HCP after 1M–1NT–2NT.
- Added an invitational 3M responder rebid with a five-card major and 10–12 HCP after opener's uncontested 1NT rebid.
- Added a solo setup choice for Beginner or Intermediate bot skill; the initial Intermediate skill reused Beginner bidding.
- Added the 1♥–1NT–2♠ opener reverse with 16+ HCP and four spades, after checking for an available lower side suit.
- Added an initial intermediate bot skill that conserves high cards when partner is winning and takes a trick with the cheapest winning card when an opponent is ahead. Its bidding still uses beginner rules.
- Added an intermediate opening lead that selects the top honor from a touching honor sequence.
- Added a natural four-card side-major rebid by opener after a direct 2/1 response with 12–17 HCP.
- Added responder's game raise of opener's shown side major with four-card support in a direct 2/1 game force.
- Added a natural 2♦ opener rebid after 1♥–2♣ with four diamonds and 12–17 HCP, unless a four-card spade suit is available.
- Added the natural 1♦–1♠–2♣ opener continuation with at least five diamonds, four clubs, and 12–17 HCP.
- Added an invitational opener jump raise to 3M with four-card support and 16–18 HCP after an uncontested one-level major response.
- Added balanced responder continuations after an uncontested opener 1NT rebid: 2NT with 10–12 HCP and 3NT with 13+ HCP.
- Added a natural 2M signoff after an uncontested 1NT rebid when responder has a five-card major and no more than 9 HCP.
- Added a natural lower side-suit rebid after an uncontested 1M–1NT response when opener has 12–17 HCP, five cards in the major, and four cards in the side suit.
- Added a natural 2M rebid after 1M–1NT when opener has 12–17 HCP, six cards in the major, and no lower four-card side suit to show.
- Added a balanced 2NT opener rebid with 18–19 HCP after an uncontested 1M–1NT auction.
- Added a 1NT response with a balanced 6–9 HCP hand after a major opening when responder lacks three-card support.
- Added a 1NT response with a balanced 6–9 HCP hand after a minor opening when responder lacks five-card support.
- Added natural one-level opener rebids in a separate four-card higher suit after an uncontested one-level response.
- Added an uncontested opener raise of responder's major with four-card support and 12–15 HCP.
- Added balanced opener rebids after a one-level new-suit response: 12–14 HCP in 1NT and 18–19 HCP in 2NT.
- Distinguished limited SAYC and 2/1 two-level responses: SAYC keeps the 10+ HCP response, while a 2/1 response after a major opening requires 13+ HCP and continues to game.
- Added a balanced 12–14 HCP 1NT rebid after a minor opening and partner's one-level suit response.
- Added a simple opener rebid of the original suit with six or more cards after an uncontested one-level new-suit response.
- Expanded uncontested minor-opening responses with five-card invitational raises and balanced 2NT/3NT ranges.
- Added limited uncontested two-level new-suit responses with four-card length and 10+ high-card points when no higher one-level suit is available.
- Added a limited uncontested raise after a minor opening with five-card support and 6–9 high-card points.
- Added one-level new-suit responses with four-card length and six high-card points after an uncontested partner opening.
- Added basic uncontested major raises after partner opens hearts or spades, scaled by responder high-card points and support.
- Added basic balanced 1NT responses after an uncontested partner opening, with the bot given its seat to identify partnership.
- Refined beginner opening bids to prefer five-card majors and use a minor when no major qualifies.
- Added advisory card-play hints that highlight legal cards, or optional solver recommendations when a host provides a solver.
- Added a platform-neutral beginner bot package with deterministic opening/pass bidding and legal card play, plus an optional solo table mode with automated opponents.
- Added local dealer/vulnerability setup and PBN deal import to the client.
- Added versioned browser autosave/resume, recent completed hands, JSON export/delete, and move-by-move review with take-back and redo.
- Verified the table and card hand at phone, tablet, and desktop widths without horizontal overflow.

## 2026-10-25

- Added a responsive React bridge table with reducer-backed auction, card play, rule feedback, trick progression, and hand results.
- Added the pnpm lockfile, focused core and PBN tests, and a separate `@contractplay/pbn` package; corrected redoubled undertrick penalties.
- Added the pnpm workspace foundation, shared strict TypeScript settings, core build/typecheck scripts, and CI workflow.
- Added immutable auction and card-play transitions, contract/declarer resolution, trick progression, and history reconstruction APIs in `packages/core`.
- Added full-deal validation and duplicate contract scoring, including vulnerability, doubles/redoubles, overtricks, undertricks, game, and slam bonuses; completed hands now include their score.
- Added PBN parsing and serialization for multi-board records, deals, auctions, card play, comments, preserved tags, and board-level diagnostics.
- Added the MIT license.
- Added the initial `packages/core` TypeScript scaffold for cards, dealing, play legality, action history, bot/hint interfaces, and basic PBN metadata utilities.
- Added the ContractPlay app roadmap and the initial project documentation and agent guidance.
- Corrected the SAYC direct 3NT response to a major opening to use the ACBL's 16–18 HCP range.
