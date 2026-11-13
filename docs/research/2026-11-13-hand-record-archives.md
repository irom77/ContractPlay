# Played hand records and field comparison for ContractPlay

Reviewed November 13, 2026. This note looks at replacing ContractPlay's randomly dealt hands with boards that were already played at a tournament or online, so a player can (a) compare their result with the real field (matchpoints or IMPs against the traveller) and (b) optionally view or replay how the board was originally bid and played. It draws on ContractPlay's [README](../../README.md), [roadmap](../../TODO.md) and code, and on the format specifications, first-party sites, terms pages, and library source code linked below. It is a desk review, not legal advice. Anything I could not confirm against a primary source is marked **unverified**.

## Where ContractPlay is today

- **Dealing.** Every hand is random. Core exposes `createDeck`, `shuffle(items, random = Math.random)` and `deal()` ([`packages/core/src/cards.ts`](../../packages/core/src/cards.ts)). Solo play calls `createGameState({ deal: deal(), ... })` in `startHand` ([`apps/client/src/App.tsx`](../../apps/client/src/App.tsx)). Online tables call `dealCards(shuffle(createDeck(), random))` with a secure `random` supplied by the server ([`packages/table/src/hand.ts`](../../packages/table/src/hand.ts), [`packages/table/src/reduce.ts`](../../packages/table/src/reduce.ts)). There is no seed or board-set concept.
- **PBN already exists.** `@contractplay/pbn` ([`packages/pbn/src/pbn.ts`](../../packages/pbn/src/pbn.ts)) parses tags, `Deal`, `Auction` and `Play` sections into validated core `GameAction`s, records diagnostics, handles `*` plus `Result` as a claim, keeps unknown tags, and exports a single hand. It does **not** interpret supplemental table sections: the rows under a `[ScoreTable "..."]` tag fall into the "Ignored content outside a PBN section" warning, and it does not apply `#` / `##` tag inheritance. Solo import (`importHand` in `App.tsx`) takes only the **first** board, then **replays its recorded actions into the live game**. An imported played board therefore opens finished or part-played, not as a fresh deal to play.
- **Saved hands.** `SavedHand` = `{ id, name?, game: GameState, savedAt, pbnMetadata? }` in versioned local storage, holding up to 25 completed hands ([`packages/persistence/src/index.ts`](../../packages/persistence/src/index.ts)). Recent commits `da3eca5` and `ab4e98c` added access to recent hands from the lobby and online menu, and names derived from the dealt cards. Online hands are saved through [`apps/client/src/online/savedHand.ts`](../../apps/client/src/online/savedHand.ts).
- **Scoring.** `scoreContract` returns a duplicate score from North-South's point of view ([`packages/core/src/scoring.ts`](../../packages/core/src/scoring.ts)), which is the raw number a traveller compares. Core has no IMP table and no matchpoint code (search of `packages/*/src`). Rubber scoring lives in [`packages/core/src/rubber.ts`](../../packages/core/src/rubber.ts).
- **LIN.** No LIN, RBN or DUP code exists in the repository (search of `packages/*/src` and `apps/*/src`).
- **Solver hook.** The solo `App` accepts an optional `solver` for card hints. Claims against robots use an exact search in `@contractplay/bots`. No double-dummy library is bundled.

## 1. Formats

### PBN 2.1: the only open format that carries a traveller

Source: the [PBN 2.1 specification](https://www.tistis.nl/pbn/pbn_v21.txt) (dated 2017-02-14, coordinator Tis Veugen).

- **Mandatory tag set (§3.4).** Export format requires 15 tags in order: Event, Site, Date, Board, West, North, East, South, Dealer, Vulnerable, Deal, Scoring, Declarer, Contract, Result. An unknown value is written as `"?"`. Import format has no mandatory tags.
- **Auction and Play (§3.5–3.6).** `[Auction "N"]` and `[Play "W"]` sections hold the calls and cards. The play section is written trick by trick, in seat order from the opening leader. ContractPlay already reads and writes both.
- **Score tags (§4.2).** `Score` gives the declarer's score, or `"NS <n>"` / `"EW <n>"`. `ScoreIMP` and `ScoreMP` give per-board IMPs and matchpoints, and §4.2.3 defines matchpoints as 2 for each lower score and 1 for each equal score (modifier `MP1`). `ScorePercentage`, `ScoreRubber` and `ScoreRubberHistory` cover the other methods. `OptimumScore` (§4.2.7) is the double-dummy par score.
- **Scoring tag (§3.4.12).** The value is open-ended. It names a basic method (`MP`, `IMP`, `BAM`, `Rubber`, `Chicago`, `Instant`, …) plus modifiers: `Butler` ("IMPed against the average value of all scores"), `Butler-2` (the two extreme scores dropped), `Cross` ("IMPed against every other trick point score, and summed"), `Cross1` / `Cross2` (divided by the number of scores or of comparisons), and `MP1` / `MP2`.
- **ScoreTable (§5.9): the traveller.** "This table presents the duplicate game results of a tournament. After playing a game, the result can be compared with the games that have actually been played." Predefined columns: `Rank`, `PairId_NS`, `PairId_EW`, `Names_NS`, `Names_EW`, `Contract`, `Declarer`, `Result`, `Score_NS`, `Score_EW`, `IMP_NS`, `IMP_EW`, `MP_NS`, `MP_EW`, `Percentage_NS`, `Percentage_EW`, `Multiplicity`. The tag value lists the columns, separated by `;`, each with an optional `\<width>[L|R]`, and the rows follow as section data. `?` means unknown, `-` irrelevant, and `^` marks an artificial (adjusted) score (§5.2).
- **TotalScoreTable (§5.10)** gives event rankings. **InstantScoreTable (§5.5)** maps score ranges to a percentage or IMPs, which fits "instant feedback" products. **OptimumResultTable (§5.7)** is the 20-row double-dummy makes table.
- **Tag inheritance (§4.8).** `"#"` copies the previous board's value. A value beginning `##` sets it for all subsequent boards. Neither is allowed for Dealer, Vulnerable, Deal, Declarer, Contract, Auction or Play. Real exports use this for Event, Site and Date. ContractPlay's parser does not resolve it yet.

**Conclusion:** one PBN file **can** carry deal, one auction and play, and the whole field's results for a board. In practice most club PBN files carry only deals and double-dummy makes. The ScoreTable is optional (see section 2).

### LIN (BBO): undocumented, so use the community's reverse-engineered meanings

- **No official spec.** On BBO's own forum a BBO administrator wrote in 2011 that "Part of the .lin structure is confidential and copyright protected," and other posters confirm "No authorised specification is freely available" ([BBO forum, topic 46671](https://www.bridgebase.com/forums/topic/46671-lin-file-format-description/)).
- **Closest first-party reference.** BBO's [Handviewer documentation](https://www.bridgebase.com/tools/hvdoc.html) says the viewer "understands a subset of the language that is used in lin files" and takes a raw `lin=` string or a `linurl=`. Its example uses `md`, `rh`, `ah`, `sv`, `mb`, `pg`, `pc`, `mc`, but it defines none of them. The same page says the viewer may be used for non-commercial purposes only, and may not be modified or copied to your own server.
- **Best authoritative reading: open-source parser code.** The MIT-licensed Python library endplay ([`parsers/lin.py`](https://github.com/dominicprice/endplay/blob/master/src/endplay/parsers/lin.py)) gives, in code comments:
  - `pn`: player names, comma-separated starting from South.
  - `md`: the deal, starting with a dealer digit followed by comma-separated hands. The digit maps 1=S, 2=W, 3=N, 4=E ([`types/player.py`](https://github.com/dominicprice/endplay/blob/master/src/endplay/types/player.py)). The fourth hand may be omitted, because the parser completes the deal (`complete_deal=True`).
  - `sv`: vulnerability, `o` none, `n` NS, `e` EW, `b` both ([`types/vul.py`](https://github.com/dominicprice/endplay/blob/master/src/endplay/types/vul.py)).
  - `ah`: board heading, `Board N`.
  - `mb`: a call, with a trailing `!` meaning alerted. `an` and `nt` attach an announcement to the previous call.
  - `pc`: a played card.
  - `pg`: page break, ignored.
  - `mc`: tricks claimed.
  - `st`, `rh`, `qx`, `va`, `sa`, `mn`, `bt`, `tu`: display commands that are skipped.

  Multi-board vugraph files are split on `pn|`. These meanings are inferred from BBO output, not specified, so treat them as **de facto**.
- **Field results.** A LIN record is one table's play of one board. A vugraph "match" file holds both rooms of a team match, so at most two results per board. It is not a field traveller.

### RBN / RBX (Pavlicek)

[Richard Pavlicek's RBN page](https://www.rpbridge.net/7a12.htm) (© 2023) defines a line-oriented text format with one-letter line labels: `E` event, `S` session, `D` date, `L` location, `F` form of scoring, `K` teams, `N` names, `B` board, `H` hands, `A` auction (with dealer and vulnerability), `C` contract, `P` play, `R` result and score, `M` double-dummy makes, `I` item list, and digits for notes. Records end at a blank line. Paired records separated by `!` hold the two tables of a team match, each with its own `R`. RBX is the same record on one line, with line feeds replaced by `}`. RBN has no general traveller section. It is a niche format, and PBN or LIN will cover nearly all files users have.

### DUP / BRI / DGE (dealing-machine files)

No first-party byte-level spec was reachable. The Duplimate conversion note those formats point to (`duplimate.com/DuplimateClub/convert.pdf`) is cited in code but was **not verified**. The MIT-licensed npm package [`pbn`](https://github.com/richardschneider/pbn) implements converters, and its source documents the layout:

- **BRI** is "78 ASCII numbers per deal to designate the North, East and South hands," two digits per card (`01`=♠A … `52`=♣2), padded to 128 bytes ([`bri-to-pbn.js`](https://github.com/richardschneider/pbn/blob/master/lib/bri-to-pbn.js)).
- **DGE** uses DOS suit-symbol characters, also padded to 128 bytes ([`dge-to-pbn.js`](https://github.com/richardschneider/pbn/blob/master/lib/dge-to-pbn.js)).
- **DUP** begins with the BRI deal and includes DGE "for verification" ([`dup-to-pbn.js`](https://github.com/richardschneider/pbn/blob/master/lib/dup-to-pbn.js)).

These files hold **deals only**: no dealer or vulnerability beyond the board number, no auction, no results. Bridgemate's control software exports hand records to `.dup` or `.pbn` ([Bridgemate US hand-record guide](https://www.bridgemate.us/guides/hand-records/)), and BridgeWebs accepts `.pbn` ("Preferred … including Double Dummy Makeable Analysis"), `.dup` and `.bri` as deal files ([BridgeWebs guide 3.1](https://www.bridgewebs.com/guide/results_files.html)).

### USEBIO XML (results, not PBN)

Club results usually travel as **USEBIO** XML, not as a PBN ScoreTable. [usebio.org](https://www.usebio.org/) says it was developed by Chris Stableford and adopted by the English Bridge Union in April 2010. The [v1.4 DTD](https://www.usebio.org/files/usebio_v1_4.dtd) defines `TRAVELLER_LINE` with `NS_PAIR_NUMBER`, `EW_PAIR_NUMBER`, `CONTRACT`, `PLAYED_BY`, `LEAD`, `TRICKS`, `SCORE`, `NS_MATCH_POINTS`, `NS_CROSS_IMP_POINTS`, `NS_BUTLER_POINTS` and related fields, plus `HANDSET` / `HAND` for deals and `AUCTION` / `PLAY` elements. BridgeWebs takes USEBIO XML as a results file alongside a PBN deal file ([BridgeWebs guide 3.1](https://www.bridgewebs.com/guide/results_files.html)). **For field comparison, a PBN deal file plus a USEBIO results file is the common real-world pair**, so a USEBIO traveller reader is worth planning for.

### Format summary

| Format | Deal | Auction/play | Field traveller in the file | Spec status |
| --- | --- | --- | --- | --- |
| PBN 2.1 | yes | one table | optional `ScoreTable` | open spec |
| LIN | yes | one table per record | no (vugraph: 2 tables) | undocumented; de facto |
| RBN/RBX | yes | yes | paired team records only | published by author |
| DUP/BRI/DGE | yes | no | no | no first-party spec found |
| USEBIO XML | yes (`HANDSET`) | optional | yes (`TRAVELLER_LINE`) | open DTD |

## 2. Sources of played boards

| Source | What is available | Format and access | Licensing / terms |
| --- | --- | --- | --- |
| **BBO vugraph archive** | Top team matches, two tables per board, full auction and play. The page lists new matches daily, for example 2026 ECC Zurich rounds on 2026-11-13 ([archive](https://www.bridgebase.com/vugraph_archives/vugraph_archives.php)). | LIN, through `tools/vugraph_linfetch.php?id=…` links on that page. | BBO Terms (effective 18 May 2026) forbid users to "scrape, copy, aggregate, redistribute, alter, reproduce or re-use any information accessible through BBO Property," allow only "your non-commercial use," and say "Only natural persons (and not, for example, web bots) may use BBO Properties" ([BBO Terms](https://news.bridgebase.com/terms/)). **Bundling or scraping is not permitted without BBO's written authorization.** |
| **BBO hand records / My Hands, BBO tournaments** | A player's own hands and tournament travellers. | Web and LIN. `robots.txt` disallows `/myhands/` and `/tourneyhistory/` ([robots.txt](https://www.bridgebase.com/robots.txt)). | Same Terms. BBO's Terms for Organizations list "bridge hands or deals" and "tournament or performance records" as confidential "BBO Data" that may not be disclosed or used to build "any competing platform" ([Org terms, 11 Dec 2025](https://news.bridgebase.com/termsorg/)). A user exporting **their own** file and importing it locally is the only clean path. |
| **ACBL Live for Clubs** | Each club game page links "an ACBLscore gamefile, a Usebio XML file, BWS contract information file and a PBN hand record file," so players can "re-play hands" ([ACBL Club Corner](https://www.acbl.org/club-corner/)). The USEBIO plus PBN pair gives a full field. | Web download. `live.acbl.org` and `my.acbl.org` returned Cloudflare challenges (HTTP 403) to automated requests on 2026-11-13. | ACBL's data terms approve publishing results with names, but member personal data "may not [be released] to unrelated third parties or to the public" except as game results, and must not be used for "commercial purposes" ([ACBL Terms of Use for Information and Data, 2018](https://cdn.acbl.org/wp-content/uploads/2014/02/termsofuse.pdf)). No general redistribution licence for results or hand records was found (**unverified** either way). |
| **Bridgemate (BCS)** | Results in a `.bws` database; hand records exported to `.pbn` / `.dup`. | Local files at the club ([Bridgemate guide](https://www.bridgemate.us/guides/hand-records/)). | Club's own data; a partnership route. |
| **BridgeWebs** | Club results with travellers. | Uploaded as a USEBIO XML, ACBLscore, Scorebridge or EBUScore results file plus a PBN, DUP or BRI deal file ([guide](https://www.bridgewebs.com/guide/results_files.html)). Whether players can download the source files is **unverified**. | Club-owned. No platform-wide reuse licence found. |
| **Pianola** | Results pages show "rankings, travelers, scorecards and the hands," and directors can download USEBIO ([Pianola support](https://support.pianola.net/support/solutions/articles/61000288494-finishing-a-game)). | Web; director downloads. | **Unverified**. Terms not reviewed. |
| **EBL / WBF championship sites** | Championship results and bulletins. `db.eurobridge.org` and `www.worldbridge.org/results/` returned HTTP 403 to automated requests, so whether they publish board travellers or PBN/LIN downloads is **unverified**. | Web. Bulletins are PDFs ([EBL bulletins](https://championships.eurobridge.org/2026EWTC/Bul_09.pdf)). | EU database right likely applies (section 3). |
| **Vugraph Project (Nikos Sarantakos)** | Historic championship matches as `.pbn` / `.lin` ("The essential is to conserve the hands, the bidding and the play records"), collected from spectators and books ([archived page, May 2026](https://web.archive.org/web/20260515105132/https://sarantakos.com/bridge/vugraph.html)). | Static downloads. **Since mid-2026, `sarantakos.com/bridge/…` redirects (HTTP 301) to an unrelated site**, so the archive is reachable only through the Wayback Machine. | No licence statement on the page. Files transcribed from ACBL or WBF championship books carry those publishers' rights (**unverified**). |
| **RealBridge** | Live and online events. The USBF says "On the scorecard you can click on a result to get the hand record and records of play at other tables" and offers PBN files per round ([USBF 2021 Mixed USBC](https://usbf.org/past-tournaments/2021-mixed-usbc/results/play-records)). | Web scorecards; PBN per round from organizers. RealBridge's own PBN-with-play guide returned 404/403 (**unverified**). | Organizer's data. |
| **Funbridge** (GOTO GAMES) | Daily tournaments compared against a field inside the app. | No export or API found. | All content is "the exclusive property of GOTO GAMES," and "Any representation, reproduction, adaptation or use … of the contents" is prohibited without written authorization (GCU art. 12). Database rights are reserved (GCS art. 7) ([terms](https://funbridge.com/terms-of-use)). |
| **IntoBridge** | Online play. | No export found. | The user owns their non-personal "User Data" (cl. 7.2), but users may not "copy, … republish, download" the Services or build a competing product (cl. 2.3) ([terms](https://play.intobridge.com/terms-of-service.html)). |

**Summary.** No large source of played boards with full field results is openly licensed for redistribution. The richest public play records (BBO vugraph) are explicitly non-redistributable. Club data (ACBL Live, BridgeWebs, Pianola, Bridgemate) comes as PBN deals plus a USEBIO traveller and belongs to clubs and organizers. The practical sources are therefore files the user brings, and data a club or organizer licenses to the project.

## 3. Legal position (not legal advice)

- **Facts are not protected by copyright (US).** *Feist v. Rural* held that "[i]n no event may copyright extend to the facts themselves" and rejected "sweat of the brow." A factual compilation is protected only for an original selection or arrangement ([Feist, 499 U.S. 340](https://www.law.cornell.edu/supremecourt/text/499/340)). A random deal and the scores obtained on it are, on that reasoning, facts. That is an inference: no bridge-specific ruling was found. Written commentary and annotations, such as bulletin write-ups or `{…}` comments in a PBN file, are ordinary literary works and are protected.
- **EU/UK sui generis database right.** Directive 96/9/EC art. 7(1) gives the maker of a database a right "to prevent extraction and/or re-utilization of the whole or of a substantial part" where there was "a substantial investment in either the obtaining, verification or presentation of the contents." Art. 7(5) also bars "repeated and systematic extraction … of insubstantial parts." The term is fifteen years from completion, renewed by substantial new investment (art. 10) ([Directive 96/9/EC, art. 7](https://www.legislation.gov.uk/eudr/1996/9/article/7), [art. 10](https://www.legislation.gov.uk/eudr/1996/9/article/10); this is the UK-retained copy of the EU text). The UK keeps an equivalent right ([SI 1997/3032, reg. 13](https://www.legislation.gov.uk/uksi/1997/3032/regulation/13)).
- **The "creating vs obtaining" limit.** In *British Horseracing Board v William Hill* (C-203/02, 2004) the Court of Justice held that resources spent **creating** the data (there, drawing up race lists) are not investment in "obtaining" it ([EUR-Lex judgment](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A62002CJ0203); summarised from search results because EUR-Lex was unreachable from this environment, so treat the summary as **unverified**). An organizer that only generates deals and records its own results may therefore have a weaker database-right claim than it assumes. Collecting, verifying and presenting results across many events, as BBO's archive or an EBL results database does, is closer to protected "obtaining/verification." Whether a given federation's results database qualifies is fact-specific and **unverified**.
- **Contract beats both.** Even where the data itself is free, site terms bind users who accept them. BBO, Funbridge and IntoBridge all prohibit copying or reuse (section 2). Scraping them would breach contract regardless of copyright.
- **Personal data.** Travellers carry player names and often pair numbers. Under GDPR, "personal data" includes any information relating to an identifiable person, "in particular by reference to an identifier such as a name" ([GDPR art. 4(1), UK-retained](https://www.legislation.gov.uk/eur/2016/679/article/4)). ACBL's data terms likewise limit releasing member information beyond published game results ([ACBL terms](https://cdn.acbl.org/wp-content/uploads/2014/02/termsofuse.pdf)). A curated set should strip names to pair numbers unless it has a clear lawful basis.
- **Safe options, in order of risk:**
  1. The user imports their own file and it stays on their device. ContractPlay redistributes nothing, which matches how [Shark Bridge](https://www.thesharkbridgecompany.com/shark-bridge-game/how-to-load-hands-on-a-table-in-shark-online-club) handles PBN/LIN.
  2. Deals ContractPlay generates itself, with a "field" simulated by bots or computed double-dummy. There is nothing third-party in that.
  3. Sets licensed in writing by a club, unit or federation (scope: redistribution in the app, names removed or consented).
  4. Public-domain or explicitly licensed sets. **None found** in this review.

## 4. Libraries usable from TypeScript

Repository facts below are from the GitHub API and npm registry on 2026-11-13.

| Library | What it does | Licence | Maintenance |
| --- | --- | --- | --- |
| [`dds-bridge/dds`](https://github.com/dds-bridge/dds) (C++) | The standard double-dummy solver: `CalcDDTable`, `SolveBoard`, `DealerPar`. | Apache-2.0 | Active (pushed 2026-11-13), 186 stars |
| [`bridge-dds`](https://github.com/bookchris/bridge-dds-js) (npm 1.4.0) | WebAssembly build of DDS with a thin JS API: `CalcDDTablePBN`, `SolveBoardPBN`, `AnalysePlayPBN`, `DealerPar`. Blocking calls, so the README recommends a web worker. Built from a DDS PR branch that "has not been accepted" upstream ([README](https://github.com/bookchris/bridge-dds-js)). | Apache-2.0 | Last push 2025-05-22, 5 stars |
| [`@bridge-tools/dd`](https://github.com/aaron-hutton/bridge-tools) (npm 0.2.2) | Wasm DDS wrapper in a TS monorepo (`core`, `dd`, `generator`). README usage section is still "TODO." | MIT | Last push 2025-05-17, 4 stars |
| [`pbn`](https://github.com/richardschneider/pbn) (npm 1.6.1) | Node-stream PBN tokenizer, `#` inheritance, BRI/DGE/DUP to PBN. | MIT | Last push 2020-05-24; Node streams, not browser-first |
| [`contract-bridge`](https://github.com/jfklorenz/Bridge-Package) (npm 3.2.1) | Scoring, movements, dealer. | MIT | Last push 2023-01-04 |
| [`endplay`](https://github.com/dominicprice/endplay) (Python) | PBN, LIN, Dealer parsers and DDS bindings. A **reference** for LIN semantics, not a runtime dependency. | MIT | Last push 2025-03-21 |
| [`bridge-craftwork/bridge-encodings`](https://github.com/bridge-craftwork/bridge-encodings) (Rust) | PBN, LIN and one-line formats. | Unlicense | Pushed 2026-11-02, 0 stars; too new to judge |
| [`dds-node-adapter`](https://github.com/frankwallis/dds-node-adapter) | Native Node addon for DDS. | No licence file | Last push 2019 |

**Recommendation.** Keep ContractPlay's own PBN package, which already validates through core, and extend it, rather than adopt `pbn`. Write a small LIN reader in the same package, using endplay's mapping as the reference. For double dummy, evaluate `bridge-dds` (Apache-2.0, has `DealerPar`) inside a web worker in the client or Tauri host, behind the existing `Solver`-style seam. Keep it out of `packages/core` so core stays platform-neutral and dependency-free. Check the wasm size and the Workers CPU limit before using it on the server (TODO.md already flags that limit for bots).

## 5. Comparing a score with a traveller

Rules sources: [WBF Laws of Duplicate Bridge 2017, Law 78](https://www.worldbridge.org/wp-content/uploads/2017/03/2017LawsofDuplicateBridge-paginated.pdf), and the EBU [White Book 2022](https://www.ebu.co.uk/documents/laws-and-ethics/2022/white-book.pdf), §§3.1.3, 4.2.3–4.2.6.

- **Matchpoints (Law 78A).** "Two scoring units … for each score inferior to his, one scoring unit for each score equal to his, and zero … for each score superior." ACBL-style tops count 1 and ½ per comparison. The ratio is the same.
- **IMPs (Law 78B).** Convert the point difference with the scale 0–10→0, 20–40→1, 50–80→2, 90–120→3, 130–160→4, 170–210→5, 220–260→6, 270–310→7, 320–360→8, 370–420→9, 430–490→10, 500–590→11, 600–740→12, 750–890→13, 900–1090→14, 1100–1290→15, 1300–1490→16, 1500–1740→17, 1750–1990→18, 2000–2240→19, 2250–2490→20, 2500–2990→21, 3000–3490→22, 3500–3990→23, 4000+→24.
- **Butler.** IMP the score against a datum, the average of the field's scores (PBN `Butler`), optionally without the extremes (`Butler-2`). The EBU drops the top and bottom score, and rounds the datum to the nearest 10 with exact 5s rounded away from average (White Book §4.2.4 example, §4.2.6.2).
- **Cross-IMPs.** IMP the score against every other score and sum (PBN `Cross`). Normalise by dividing by the number of scores (`Cross1`) or of comparisons (`Cross2`), or by the EBU's factor in White Book §3.1.3.
- **Two-table teams (vugraph).** IMP against the other room's score at the same direction. With both rooms known, this is a two-score cross-IMP.

**Inserting one new score without changing the field.** Let the traveller have *n* results with NS scores *s₁…sₙ*, and the player's NS-perspective score be *s* (from `scoreContract`, with the sign flipped when the player sat EW):

- Matchpoints: `M = 2·#{sᵢ < s} + #{sᵢ = s}`, top `2n`, percentage `M / 2n`. This is the player's score as if they were an *(n+1)*-th table. The field's own published MPs stay as they are and remain valid as an approximation.
- To show the result on the event's original top of `2(n−1)`, apply **Neuberg** (White Book §4.2.3.2): `MP = ((M + 1)/A)·E − 1`, with `A = n + 1` actual results and `E = n` expected.
- Butler: `IMP(s − datum(s₁…sₙ))`, using the same exclusion and rounding as the event.
- Cross-IMPs: `Σᵢ IMP(s − sᵢ)`, divided by *n* for a per-comparison figure.
- Skip ScoreTable rows marked `^` (artificial scores) or with `-` results when comparing, and show them greyed out.
- The traveller's own MP and IMP columns can be read as they are, but recomputing from `Score_NS` keeps one scoring path and checks the file.

## 6. Recommended architecture for ContractPlay

These steps follow the project rules: keep core platform-neutral, keep state immutable, and validate every action through `applyAction`.

### Core and PBN model (`packages/core`, `packages/pbn`)

1. **`HandRecord` (core, pure data):** `{ board?, dealer, vulnerability, deal, scoring?, played?: { actions, declarer?, contract?, result? }, field?: TravellerRow[], source: { kind: "user-file" | "licensed-set" | "generated"; label; licence? } }`. `TravellerRow` = `{ contract | "pass" | "adjusted", declarer?, tricks?, nsScore, multiplicity?, artificial? }`. Pair names are optional and dropped by default. The record is validated with `isValidDeal`, and its `played.actions` are replayed through `applyAction`, which the PBN parser already does.
2. **Field scoring (core, pure functions):** `impsFor(diff)` (Law 78B table), `matchpointsAgainst(field, s)`, `neuberg(M, A, E)`, `butlerDatum(field, { dropExtremes })`, `crossImps(field, s)`. These are table-driven and easy to unit-test against White Book examples, such as the §4.2.4 fouled-board example (datum +410, then IMPs +6, +5, −6, −11).
3. **PBN parser extensions (`@contractplay/pbn`):** parse `ScoreTable` and `TotalScoreTable` section rows using the column-header tag value (widths, `?`, `-`, `^`). Resolve `#` / `##` inheritance. Return every board, not just the first. Map rows to `TravellerRow`.
4. **LIN reader** in the same package (or `@contractplay/lin`): `pn`, `md`, `sv`, `ah`, `mb`/`an`, `pc`, `mc` → `HandRecord`, with diagnostics like the PBN parser. Optional later: DUP/BRI deal-only import, and a USEBIO `TRAVELLER_LINE` reader so a club's PBN plus XML pair yields a full field.

### Board source abstraction

5. **`BoardSource` seam:** `random` (today's `deal()`), `set` (an ordered list of `HandRecord`s from an imported file or licensed set, with position), and later `generated-with-field`. `startHand` in `App.tsx` and `dealHand` in `packages/table/src/hand.ts` ask the source for `{ deal, dealer, vulnerability, record? }` instead of calling `deal()` directly. Board-set play should take dealer and vulnerability **from the record**, not from rubber rotation. That suggests a third scoring mode, "duplicate vs field," alongside rubber and single deals.
6. **Fresh play vs replay.** Importing a played record should start a **fresh** game from the deal (auction phase) and attach the original as `record`. Today's `importHand` instead replays the recorded actions into the live game. Keep that behaviour as the explicit "View original" path.

### Client

7. **Replay viewer.** Build a `GameState` by folding `record.played.actions` through `applyAction`, and step with the existing `rewindTo(state, count)` / `replayActions` helpers in `packages/core/src/game.ts`. The current "reviewing a saved hand" screen (preview 26) is the natural base. Show the original auction beside the player's own after the hand.
8. **Field comparison panel** on the hand result: the traveller sorted by NS score, the player's row inserted and highlighted, with MP %, Butler IMPs and cross-IMPs according to the record's `Scoring` tag. A double-dummy par line appears when a solver is present (`OptimumScore` from the file, or `DealerPar`).
9. **Persistence.** Extend `SavedHand` with an optional `recordRef` or embedded `HandRecord` and its field result. Keep `version: 1` readable and add a migration. Store imported sets separately from the 25 most recent hands.
10. **Previews.** Per CLAUDE.md, add `#/mocks` screens for "Board set: board 3 of 24," "Result vs field," and "Viewing the original play," with `Previews.test.tsx` expectations and README table rows.

### Phased plan

| Phase | Scope | Data risk |
| --- | --- | --- |
| **MVP** | Multi-board PBN import with ScoreTable traveller; play the set fresh; field MP and IMP comparison; view the original auction and play when present. | None: the user's own file, kept on the device. |
| **2** | LIN import (single-table and vugraph two-room); two-room IMP comparison; DUP/BRI deal-only import. | None for user files. |
| **3** | USEBIO traveller import (PBN plus XML); `Butler-2` and Neuberg options; double-dummy par via a wasm DDS in a worker as the fallback "field" when no traveller exists. | None. DDS is Apache-2.0, so include its NOTICE. |
| **4** | Curated sets: ContractPlay-generated deals with a bot-played or double-dummy field, then sets licensed by clubs or federations (names removed). | Needs written licences; GDPR review if names are kept. |
| **5 (online)** | Online tables dealt from a board set, so all four players meet the same record; server holds the set and reveals the record only after the hand. | The server must never send the original play or other hands before the hand ends, as `viewFor` already enforces for hands. |

### Open questions and risks

- **Data availability.** A typical club PBN carries deals and makes but **no** ScoreTable. The field usually lives in USEBIO or the scoring program's own file, so the MVP may disappoint unless phase 3 follows quickly. This could be checked by sampling real ACBL Live and BridgeWebs downloads, which was not possible here (Cloudflare).
- **Comparability.** Field results came from humans under the event's conditions (scoring method, system regulations, screens). ContractPlay bots partner the user. The UI should present the comparison as a guide, not a ranking.
- **Seat choice.** The player should sit the direction the field compares (NS or EW). For EW, flip signs consistently, including the `Score_EW` column.
- **Spoilers.** Hide the traveller and the original play until the hand ends, and sit the player where the record's names are hidden.
- **LIN drift.** BBO can change undocumented commands. Parse leniently with diagnostics, as the PBN package does.
- **Licensing for curated sets** depends on the jurisdiction (EU/UK database right vs US *Feist*) and on contract terms. Get written permission. Do not rely on "facts aren't copyrightable" for sites whose terms forbid reuse.
- **Archive fragility.** The Sarantakos Vugraph Project domain now redirects elsewhere. Any link-out feature should use durable sources or the user's own files.
- **Unverified here:** EBL/WBF traveller downloads, Pianola and RealBridge export details and terms, the Duplimate `convert.pdf` spec, and the exact holding text of C-203/02 (EUR-Lex unreachable).
