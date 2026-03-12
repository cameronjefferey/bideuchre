export type TableCard = {
  suit: string;
  rank: string;
};

export type TableState = {
  roomCode: string;
  seat: "N" | "E" | "S" | "W";
  phase: string;
  dealer: string;
  handNumber?: number;
  scoreNS?: number;
  scoreEW?: number;
  contractSummary?: string | null;
  trumpSuit?: string | null;
  ledSuit?: string | null;
  hand: TableCard[];
  handSizes: Record<"N" | "E" | "S" | "W", number>;
  seatNames?: Record<"N" | "E" | "S" | "W", string | null>;
  currentTurn?: "N" | "E" | "S" | "W" | null;
  currentBid?: {
    seat: "N" | "E" | "S" | "W";
    level: string;
    bidType: string;
  } | null;
  playTurn?: "N" | "E" | "S" | "W" | null;
  currentTrick?: Partial<Record<"N" | "E" | "S" | "W", TableCard>>;
  tricksWon?: Record<"N" | "E" | "S" | "W", number>;
  lastTrickWinner?: "N" | "E" | "S" | "W" | null;
  specialExchange?: {
    contract: "PUT_TWO_DOWN" | "PUT_ONE_DOWN" | "SHOOT_MOON";
    declarer: "N" | "E" | "S" | "W";
    partner: "N" | "E" | "S" | "W";
    exchangeCount: number;
    trumpType?: string | null;
  } | null;
  winningBid?: {
    seat: "N" | "E" | "S" | "W";
    label?: string;
    level?: number;
    trumpType?: string;
  } | null;
  logs: string[];
  /** When phase is COMPLETE, server sends full trick history with winner for review. */
  completedTricksReview?: Array<{
    trick_index: number;
    leader: string;
    plays: Array<{ seat: string; card: TableCard }>;
    winner: string;
  }>;
  /** Toggles the "previous round tricks" review panel (hand complete only). */
  showPreviousTricks?: boolean;
  connectionLost?: boolean;
  /** First-jack-deals animation: sequence of (seat, card) and winning dealer. */
  firstJackAnimation?: {
    sequence: Array<{ seat: string; card: TableCard }>;
    dealer: string;
  };
  /** How many cards to show in the first-jack animation (0 = none yet). */
  firstJackRevealedIndex?: number;
};

export type TableCallbacks = {
  onStandardBid?: (level: number, trump: string) => void;
  onSpecialBid?: (
    contract: "PUT_TWO_DOWN" | "PUT_ONE_DOWN" | "SHOOT_MOON",
  ) => void;
  onPass?: () => void;
  onPlayCard?: (index: number) => void;
  onForceScore?: () => void;
  onNextHand?: () => void;
  onSpecialExchange?: (payload: { trump: string; discardIndices: number[] }) => void;
  onShowPreviousTricks?: () => void;
  onClosePreviousTricks?: () => void;
  onFirstJackComplete?: () => void;
  onFirstJackRevealNext?: (nextIndex: number) => void;
};

function suitSymbol(suit: string): string {
  return suit === "HEARTS" ? "♥" : suit === "DIAMONDS" ? "♦" : suit === "CLUBS" ? "♣" : "♠";
}

export function renderTable(
  root: HTMLElement,
  state: TableState,
  callbacks?: TableCallbacks,
): void {
  root.innerHTML = "";

  // First-jack on the table: same 4-seat layout, cards dealt to each seat until a jack
  const isFirstJack =
    state.firstJackAnimation &&
    (callbacks?.onFirstJackComplete || callbacks?.onFirstJackRevealNext);

  const card = document.createElement("div");
  card.className = "card";

  if (state.connectionLost) {
    const banner = document.createElement("div");
    banner.className = "connection-lost-banner";
    banner.textContent = "Connection lost. Refresh the page to rejoin.";
    card.appendChild(banner);
  }

  // —— Header: room, you, phase, score ——
  const header = document.createElement("div");
  header.className = "card-header";
  const handLabelText =
    state.handNumber && state.handNumber > 0
      ? `Hand ${state.handNumber} of 8`
      : "Hand —";
  const nsNames = [
    state.seatNames?.N ?? "North",
    state.seatNames?.S ?? "South",
  ].join(" & ");
  const ewNames = [
    state.seatNames?.E ?? "East",
    state.seatNames?.W ?? "West",
  ].join(" & ");
  const scoreHtml =
    state.scoreNS !== undefined && state.scoreEW !== undefined
      ? `
      <div class="score-team">
        <span class="label">${nsNames}</span>
        <span class="value">${state.scoreNS}</span>
      </div>
      <div class="score-divider"></div>
      <div class="score-team">
        <span class="label">${ewNames}</span>
        <span class="value">${state.scoreEW}</span>
      </div>
    `
      : "";
  const youName = state.seatNames?.[state.seat] ?? state.seat;
  const dealerName = state.seatNames?.[state.dealer as "N" | "E" | "S" | "W"] ?? state.dealer;

  if (isFirstJack) {
    header.innerHTML = `
      <div>
        <div class="title">Room ${state.roomCode}</div>
        <div class="subtitle">First jack — who deals?</div>
      </div>
    `;
  } else {
    header.innerHTML = `
      <div>
        <div class="title">Room ${state.roomCode}</div>
        <div class="subtitle">
          You are <span class="badge badge-you">${youName}</span>
          · Dealer: ${dealerName}
          · <span class="badge badge-phase">${state.phase}</span>
        </div>
        ${
          state.contractSummary
            ? `<div class="subtitle contract-summary">Contract: ${state.contractSummary}</div>`
            : ""
        }
      </div>
      <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <div class="pill"><span>${handLabelText}</span></div>
        <div class="score-board">${scoreHtml}</div>
      </div>
    `;
  }

  const body = document.createElement("div");

  // —— Table felt: N, E, S, W + center ——
  const tableSection = document.createElement("div");
  tableSection.className = "table-section";
  const tableTitle = document.createElement("div");
  tableTitle.className = "section-title";
  const nsTricks =
    (state.tricksWon?.N ?? 0) + (state.tricksWon?.S ?? 0);
  const ewTricks =
    (state.tricksWon?.E ?? 0) + (state.tricksWon?.W ?? 0);
  tableTitle.textContent = isFirstJack ? "Cards dealt until a jack" : "Table";
  const tricksInfo = document.createElement("div");
  tricksInfo.className = "subtitle";
  if (!isFirstJack) {
    tricksInfo.textContent = `Tricks this hand · ${nsNames} ${nsTricks} – ${ewTricks} ${ewNames}`;
  }
  const contractInfo = document.createElement("div");
  contractInfo.className = "subtitle";
  if (state.contractSummary) {
    contractInfo.textContent = state.contractSummary;
  }
  const tableFelt = document.createElement("div");
  tableFelt.className = "table-felt";
  const tableGrid = document.createElement("div");
  tableGrid.className = "table-grid";

  if (isFirstJack && state.firstJackAnimation) {
    const fj = state.firstJackAnimation;
    const revealed = state.firstJackRevealedIndex ?? 0;
    const showCount = Math.min(revealed + 1, fj.sequence.length);
    const nameFor = (s: string) =>
      state.seatNames?.[s as "N" | "E" | "S" | "W"] ?? s;
    const cardsBySeat: Record<
      string,
      { card: TableCard; isJack: boolean }[]
    > = { N: [], E: [], S: [], W: [] };
    for (let i = 0; i < showCount; i++) {
      const { seat, card } = fj.sequence[i];
      cardsBySeat[seat].push({ card, isJack: card.rank === "JACK" });
    }
    function firstJackSeatEl(seat: "N" | "E" | "S" | "W"): HTMLElement {
      const el = document.createElement("div");
      el.className = "table-seat";
      const cards = cardsBySeat[seat];
      const hasJack = cards.some((c) => c.isJack);
      if (hasJack && fj.dealer === seat) el.classList.add("first-jack-winner-seat");
      const nameEl = document.createElement("div");
      nameEl.className = "seat-name";
      nameEl.textContent = nameFor(seat) + (state.seat === seat ? " (you)" : "");
      el.appendChild(nameEl);
      const cardRow = document.createElement("div");
      cardRow.className = "first-jack-dealt-cards";
      cards.forEach(({ card: c, isJack }) => {
        const sym = suitSymbol(c.suit);
        const cardEl = document.createElement("div");
        cardEl.className =
          "playing-card first-jack-mini" +
          (c.suit === "HEARTS" || c.suit === "DIAMONDS" ? " red" : "") +
          (isJack ? " first-jack-winner-card" : "");
        cardEl.innerHTML = `<div class="corner top">${c.rank[0]}${sym}</div><div class="suit-large">${sym}</div>`;
        cardRow.appendChild(cardEl);
      });
      el.appendChild(cardRow);
      return el;
    }
    const fjCenter = document.createElement("div");
    fjCenter.className = "table-center first-jack-center";
    const lastDealt = showCount > 0 ? fj.sequence[showCount - 1] : null;
    const jackRevealed = lastDealt && lastDealt.card.rank === "JACK";
    if (jackRevealed) {
      const msg = document.createElement("div");
      msg.className = "first-jack-dealer-msg";
      msg.textContent = `${nameFor(fj.dealer)} wins the deal!`;
      fjCenter.appendChild(msg);
      const dealBtn = document.createElement("button");
      dealBtn.type = "button";
      dealBtn.className = "button button-primary";
      dealBtn.textContent = "Deal hand";
      dealBtn.onclick = () => callbacks?.onFirstJackComplete?.();
      fjCenter.appendChild(dealBtn);
    } else {
      fjCenter.textContent = "Dealing…";
      if (showCount < fj.sequence.length && callbacks?.onFirstJackRevealNext) {
        setTimeout(() => callbacks.onFirstJackRevealNext?.(showCount), 450);
      }
    }
    tableGrid.appendChild(document.createElement("div"));
    tableGrid.appendChild(firstJackSeatEl("N"));
    tableGrid.appendChild(document.createElement("div"));
    tableGrid.appendChild(firstJackSeatEl("W"));
    tableGrid.appendChild(fjCenter);
    tableGrid.appendChild(firstJackSeatEl("E"));
    tableGrid.appendChild(document.createElement("div"));
    tableGrid.appendChild(firstJackSeatEl("S"));
    tableGrid.appendChild(document.createElement("div"));
  } else {
  function seatEl(seat: "N" | "E" | "S" | "W", position: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "table-seat";
    if (state.lastTrickWinner === seat) {
      el.classList.add("winner-seat");
    }
    const isTurnNow =
      (state.phase === "BIDDING" && state.currentTurn === seat) ||
      (state.phase === "PLAYING" && state.playTurn === seat);
    if (isTurnNow) {
      el.classList.add("active-seat");
    }
    const size = state.handSizes[seat] ?? 0;
    const tricks = state.tricksWon?.[seat] ?? 0;
    const displayName = state.seatNames?.[seat] ?? seat;
    const isYou = state.seat === seat;
    let bidLine = "";
    if (state.winningBid && state.winningBid.seat === seat) {
      if (state.winningBid.label) {
        bidLine = `Bid: ${state.winningBid.label}`;
      } else if (
        state.winningBid.level !== undefined &&
        state.winningBid.trumpType
      ) {
        const tt = state.winningBid.trumpType;
        if (tt === "HEARTS" || tt === "DIAMONDS" || tt === "CLUBS" || tt === "SPADES") {
          const sym = suitSymbol(tt);
          bidLine = `Bid: ${state.winningBid.level} ${sym}`;
        } else {
          bidLine = `Bid: ${state.winningBid.level} ${tt === "HIGH" ? "High" : tt === "LOW" ? "Low" : tt}`;
        }
      }
    }
    el.innerHTML = `
      <div class="seat-name">${displayName}${isYou ? " (you)" : ""}</div>
      <div class="seat-cards">${size} card${size === 1 ? "" : "s"}</div>
      <div class="seat-cards">Tricks: ${tricks}</div>
      ${bidLine ? `<div class="seat-cards">${bidLine}</div>` : ""}
    `;
    return el;
  }

  const center = document.createElement("div");
  center.className = "table-center";
  if (state.phase === "PLAYING" && state.currentTrick) {
    const ledLabel = document.createElement("div");
    ledLabel.textContent = state.ledSuit
      ? `Current trick · ${state.ledSuit} led`
      : "Current trick";
    center.appendChild(ledLabel);
    const trickCards = document.createElement("div");
    trickCards.className = "trick-cards";
    (["N", "E", "S", "W"] as const).forEach((seatKey) => {
      const c = state.currentTrick?.[seatKey];
      const slot = document.createElement("div");
      slot.className = "trick-slot";

      const nameLabel = document.createElement("div");
      nameLabel.className = "trick-slot-name";
      nameLabel.textContent = state.seatNames?.[seatKey] ?? seatKey;
      slot.appendChild(nameLabel);

      if (c) {
        const sym = suitSymbol(c.suit);
        const cardBox = document.createElement("div");
        cardBox.className =
          "playing-card" + (c.suit === "HEARTS" || c.suit === "DIAMONDS" ? " red" : "");
        cardBox.innerHTML = `
          <div class="corner top">${c.rank[0]}${sym}</div>
          <div class="suit-large">${sym}</div>
          <div class="corner bottom">${c.rank[0]}${sym}</div>
        `;
        slot.appendChild(cardBox);
      } else {
        const emptyBox = document.createElement("div");
        emptyBox.className = "trick-slot-empty";
        slot.appendChild(emptyBox);
      }

      trickCards.appendChild(slot);
    });
    center.appendChild(trickCards);
  } else {
    center.textContent = "Trick area";
  }

  tableGrid.appendChild(document.createElement("div"));
  tableGrid.appendChild(seatEl("N", "Top"));
  tableGrid.appendChild(document.createElement("div"));
  tableGrid.appendChild(seatEl("W", "Left"));
  tableGrid.appendChild(center);
  tableGrid.appendChild(seatEl("E", "Right"));
  tableGrid.appendChild(document.createElement("div"));
  tableGrid.appendChild(seatEl("S", "Bottom"));
  tableGrid.appendChild(document.createElement("div"));
  }

  tableFelt.appendChild(tableGrid);
  tableSection.appendChild(tableTitle);
  tableSection.appendChild(tricksInfo);
  if (state.contractSummary) {
    tableSection.appendChild(contractInfo);
  }
  tableSection.appendChild(tableFelt);
  body.appendChild(tableSection);

  // —— Phase / turn info ——
  const phaseInfo = document.createElement("div");
  phaseInfo.className = "table-section";
  phaseInfo.style.marginBottom = "0.5rem";
  const parts: string[] = [];
  const nameForSeat = (s: "N" | "E" | "S" | "W"): string =>
    state.seatNames?.[s] ?? s;
  if (state.phase === "BIDDING") {
    parts.push("Bidding");
    if (state.currentBid) {
      const bidName = nameForSeat(state.currentBid.seat);
      parts.push(`Current: ${state.currentBid.level} ${state.currentBid.bidType} by ${bidName}`);
    } else {
      parts.push("No bids yet");
    }
    if (state.currentTurn) {
      const turnName = nameForSeat(state.currentTurn);
      parts.push(
        state.currentTurn === state.seat ? `Your turn` : `${turnName}'s turn`,
      );
    }
  } else if (state.phase === "PLAYING") {
    parts.push("Playing");
    if (state.playTurn) {
      const playName = nameForSeat(state.playTurn);
      parts.push(
        state.playTurn === state.seat ? `Your turn` : `${playName}'s turn`,
      );
    }
  } else if (state.phase === "EXCHANGE" && state.specialExchange) {
    const declName = state.seatNames?.[state.specialExchange.declarer] ?? state.specialExchange.declarer;
    parts.push("Special hand setup");
    parts.push(
      `${state.specialExchange.contract === "PUT_TWO_DOWN" ? "Put Two Down" : state.specialExchange.contract === "PUT_ONE_DOWN" ? "Put One Down" : "Shoot the Moon"} by ${declName}`,
    );
  } else if (state.phase === "COMPLETE") {
    parts.push("Hand complete");
  } else if (isFirstJack || state.phase === "AWAIT_DEAL") {
    parts.push("First jack — who deals?");
  }
  phaseInfo.innerHTML = `<div class="subtitle" style="margin:0">${parts.join(" · ")}</div>`;
  body.appendChild(phaseInfo);

  // —— Your hand ——
  const handSection = document.createElement("div");
  handSection.className = "table-section";
  const handLabel = document.createElement("div");
  handLabel.className = "section-title";
  handLabel.textContent = "Your hand";
  const handRow = document.createElement("div");
  handRow.className = "playing-cards";

  const sortedHand = [...state.hand].map((c, index) => ({ card: c, index }));

  sortedHand.sort((a, b) => {
    // High/Low have no trump suit; use no-trump order for sorting.
    const trump =
      state.trumpSuit && state.trumpSuit !== "HIGH" && state.trumpSuit !== "LOW"
        ? state.trumpSuit
        : null;

    const suitOrder = (suit: string): number => {
      if (!trump) {
        // Fixed suit order when no trump: CLUBS, DIAMONDS, HEARTS, SPADES.
        return suit === "CLUBS"
          ? 0
          : suit === "DIAMONDS"
          ? 1
          : suit === "HEARTS"
          ? 2
          : 3;
      }
      // Trump suit first, then others in fixed order.
      if (suit === trump) return 0;
      const base = suit === "CLUBS"
        ? 1
        : suit === "DIAMONDS"
        ? 2
        : suit === "HEARTS"
        ? 3
        : 4;
      return suit === trump ? 0 : base;
    };

    const rankValue = (rank: string): number =>
      rank === "ACE" ? 14 : rank === "KING" ? 13 : rank === "QUEEN" ? 12 : 11; // JACK

    const isTrumpJack = (card: TableCard): boolean =>
      trump != null && card.rank === "JACK" && card.suit === trump;

    const sameColorSuit = (suit: string): string | null => {
      if (suit === "HEARTS") return "DIAMONDS";
      if (suit === "DIAMONDS") return "HEARTS";
      if (suit === "CLUBS") return "SPADES";
      if (suit === "SPADES") return "CLUBS";
      return null;
    };

    const isLeftBower = (card: TableCard): boolean =>
      trump != null &&
      card.rank === "JACK" &&
      card.suit === sameColorSuit(trump);

    const trumpValue = (card: TableCard): number => {
      if (!trump) return 0;
      if (isTrumpJack(card)) return 100;
      if (isLeftBower(card)) return 99;
      if (card.suit === trump) return 80 + rankValue(card.rank);
      return 0;
    };

    const aTrump = trumpValue(a.card);
    const bTrump = trumpValue(b.card);
    if (aTrump !== bTrump) return bTrump - aTrump; // higher trump first

    const suitA = suitOrder(a.card.suit);
    const suitB = suitOrder(b.card.suit);
    if (suitA !== suitB) return suitA - suitB;

    return rankValue(b.card.rank) - rankValue(a.card.rank);
  });

  sortedHand.forEach(({ card: c, index }) => {
    const symbol = suitSymbol(c.suit);
    const isRed = c.suit === "HEARTS" || c.suit === "DIAMONDS";
    const cardEl = document.createElement("div");
    cardEl.className = `playing-card${isRed ? " red" : ""}`;
    cardEl.dataset.index = String(index);
    cardEl.innerHTML = `
      <div class="corner top">${c.rank[0]}${symbol}</div>
      <div class="suit-large">${symbol}</div>
      <div class="corner bottom">${c.rank[0]}${symbol}</div>
    `;
    if (callbacks?.onPlayCard && state.phase === "PLAYING" && state.playTurn === state.seat) {
      cardEl.style.cursor = "pointer";
      cardEl.onclick = () => callbacks.onPlayCard?.(index);
    }
    handRow.appendChild(cardEl);
  });

  handSection.appendChild(handLabel);
  handSection.appendChild(handRow);
  if (!isFirstJack) body.appendChild(handSection);

  // —— Special exchange controls (special contracts) ——
  if (state.phase === "EXCHANGE" && state.specialExchange && callbacks?.onSpecialExchange) {
    const ex = state.specialExchange;
    const raw = ex as Record<string, unknown>;
    const trumpSet = (ex.trumpType ?? raw.trump_type) as string | null | undefined;
    const exchangeCountNum = Number(ex.exchangeCount ?? raw.exchange_count ?? 0);

    const exSection = document.createElement("div");
    exSection.className = "table-section";
    const exTitle = document.createElement("div");
    exTitle.className = "section-title";
    exTitle.textContent = "Special hand setup";

    const desc = document.createElement("div");
    desc.className = "subtitle";
    const friendly =
      ex.contract === "PUT_TWO_DOWN"
        ? "Put Two Down"
        : ex.contract === "PUT_ONE_DOWN"
        ? "Put One Down"
        : "Shoot the Moon";

    const isDeclarer = ex.declarer === state.seat;
    const isPartner = ex.partner === state.seat;
    const declarerName = state.seatNames?.[ex.declarer] ?? ex.declarer;
    const partnerName = state.seatNames?.[ex.partner] ?? ex.partner;

    const controls = document.createElement("div");
    controls.className = "button-row";

    const trumpSelect = document.createElement("select");
    trumpSelect.style.width = "auto";
    trumpSelect.style.minWidth = "7rem";
    ["HEARTS", "DIAMONDS", "CLUBS", "SPADES", "HIGH", "LOW"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "HIGH" ? "High" : t === "LOW" ? "Low" : t;
      if (trumpSet && trumpSet === t) {
        opt.selected = true;
      }
      trumpSelect.appendChild(opt);
    });

    if (isDeclarer) {
      if (!trumpSet) {
        desc.textContent = `${friendly} by ${declarerName}. Choose trump first.`;
        const setTrumpBtn = document.createElement("button");
        setTrumpBtn.type = "button";
        setTrumpBtn.className = "button button-primary";
        setTrumpBtn.textContent = "Set trump";
        setTrumpBtn.onclick = () => {
          callbacks.onSpecialExchange?.({
            kind: "set_trump",
            trump: trumpSelect.value,
            discardIndices: [],
          });
        };
        controls.appendChild(trumpSelect);
        controls.appendChild(setTrumpBtn);
      } else if (exchangeCountNum > 0 && state.hand.length === 8) {
        desc.textContent = `${friendly} by ${declarerName}. Select ${exchangeCountNum} card${
          exchangeCountNum === 1 ? "" : "s"
        } to discard.`;
        const discardBtn = document.createElement("button");
        discardBtn.type = "button";
        discardBtn.className = "button button-primary";
        discardBtn.textContent = "Confirm discards";
        discardBtn.onclick = () => {
          const cards = Array.from(
            handRow.querySelectorAll<HTMLDivElement>(".playing-card"),
          );
          const discardIndices: number[] = [];
          cards.forEach((el) => {
            if (el.classList.contains("selected")) {
              const original = el.dataset.index;
              if (original != null) discardIndices.push(Number(original));
            }
          });
          callbacks.onSpecialExchange?.({
            kind: "discard",
            trump: trumpSet ?? trumpSelect.value,
            discardIndices,
          });
        };
        controls.appendChild(discardBtn);
        // Enable selection clicks for declarer only at this stage.
        handRow
          .querySelectorAll<HTMLDivElement>(".playing-card")
          .forEach((el) => {
            el.style.cursor = "pointer";
            el.onclick = () => {
              el.classList.toggle("selected");
            };
          });
      } else {
        desc.textContent = `${friendly} by ${declarerName}. Waiting for ${partnerName} to choose cards.`;
      }
    } else if (isPartner && exchangeCountNum > 0) {
      if (!trumpSet) {
        desc.textContent = `${friendly} by ${declarerName}. Waiting for ${declarerName} to choose trump.`;
      } else if (state.hand.length === 8) {
        desc.textContent = `${friendly} by ${declarerName}. Choose ${exchangeCountNum} card${
          exchangeCountNum === 1 ? "" : "s"
        } to give to ${declarerName}.`;
        const giveBtn = document.createElement("button");
        giveBtn.type = "button";
        giveBtn.className = "button button-primary";
        giveBtn.textContent = "Give cards";
        giveBtn.onclick = () => {
          const cards = Array.from(
            handRow.querySelectorAll<HTMLDivElement>(".playing-card"),
          );
          const giveIndices: number[] = [];
          cards.forEach((el) => {
            if (el.classList.contains("selected")) {
              const original = el.dataset.index;
              if (original != null) giveIndices.push(Number(original));
            }
          });
          callbacks.onSpecialExchange?.({
            kind: "partner_give",
            trump: trumpSet ?? trumpSelect.value,
            discardIndices: giveIndices,
          });
        };
        controls.appendChild(giveBtn);
        handRow
          .querySelectorAll<HTMLDivElement>(".playing-card")
          .forEach((el) => {
            el.style.cursor = "pointer";
            el.onclick = () => {
              el.classList.toggle("selected");
            };
          });
      } else {
        desc.textContent = `${friendly} by ${declarerName}. Waiting for play to begin.`;
      }
    } else {
      if (!trumpSet) {
        desc.textContent = `${friendly} by ${declarerName}. Waiting for ${declarerName} to choose trump.`;
      } else {
        desc.textContent = `${friendly} by ${declarerName}. Exchange in progress.`;
      }
    }

    exSection.appendChild(exTitle);
    exSection.appendChild(desc);
    if (controls.childNodes.length > 0) {
      exSection.appendChild(controls);
    }
    body.appendChild(exSection);
  }

  // —— Bidding controls ——
  if (state.phase === "BIDDING" && callbacks && state.currentTurn === state.seat) {
    const bidSection = document.createElement("div");
    bidSection.className = "table-section";
    const bidTitle = document.createElement("div");
    bidTitle.className = "section-title";
    bidTitle.textContent = "Your bid";
    const controls = document.createElement("div");
    controls.className = "button-row";
    controls.style.position = "relative";
    controls.style.zIndex = "10";

    if (callbacks.onStandardBid) {
      const levelSelect = document.createElement("select");
      levelSelect.style.width = "auto";
      levelSelect.style.minWidth = "4rem";
      for (let i = 1; i <= 8; i += 1) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        levelSelect.appendChild(opt);
      }
      const trumpSelect = document.createElement("select");
      trumpSelect.style.width = "auto";
      trumpSelect.style.minWidth = "7rem";
      ["HEARTS", "DIAMONDS", "CLUBS", "SPADES", "HIGH", "LOW"].forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        trumpSelect.appendChild(opt);
      });
      const bidButton = document.createElement("button");
      bidButton.type = "button";
      bidButton.className = "button button-primary";
      bidButton.textContent = "Bid";
      bidButton.onclick = () => {
        callbacks.onStandardBid?.(Number(levelSelect.value), trumpSelect.value);
      };
      controls.appendChild(levelSelect);
      controls.appendChild(trumpSelect);
      controls.appendChild(bidButton);
    }

    if (callbacks.onSpecialBid) {
      const specials: Array<[string, "PUT_TWO_DOWN" | "PUT_ONE_DOWN" | "SHOOT_MOON"]> = [
        ["Put Two Down", "PUT_TWO_DOWN"],
        ["Put One Down", "PUT_ONE_DOWN"],
        ["Shoot the Moon", "SHOOT_MOON"],
      ];
      specials.forEach(([label, contract]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button button-secondary";
        btn.textContent = label;
        btn.onclick = () => callbacks.onSpecialBid?.(contract);
        btn.style.pointerEvents = "auto";
        controls.appendChild(btn);
      });
    }

    if (callbacks.onPass) {
      const passBtn = document.createElement("button");
      passBtn.type = "button";
      passBtn.className = "button button-secondary";
      passBtn.textContent = "Pass";
      passBtn.onclick = () => callbacks.onPass?.();
      passBtn.style.pointerEvents = "auto";
      controls.appendChild(passBtn);
    }

    bidSection.appendChild(bidTitle);
    bidSection.appendChild(controls);
    body.appendChild(bidSection);
  }

  // —— Dev: force score ——
  if (callbacks?.onForceScore && state.phase === "PLAYING") {
    const devSection = document.createElement("div");
    devSection.className = "dev-section";
    devSection.innerHTML = '<div class="section-title">Dev</div>';
    const scoreRow = document.createElement("div");
    scoreRow.className = "button-row";
    const scoreBtn = document.createElement("button");
    scoreBtn.type = "button";
    scoreBtn.className = "button button-secondary";
    scoreBtn.textContent = "Score hand now";
    scoreBtn.onclick = () => callbacks.onForceScore?.();
    scoreRow.appendChild(scoreBtn);
    devSection.appendChild(scoreRow);
    body.appendChild(devSection);
  }

  // —— Play next hand + Show previous round tricks ——
  if (state.phase === "COMPLETE") {
    const nextSection = document.createElement("div");
    nextSection.className = "table-section";
    nextSection.style.display = "flex";
    nextSection.style.flexWrap = "wrap";
    nextSection.style.gap = "0.5rem";
    nextSection.style.alignItems = "center";
    if (callbacks?.onNextHand) {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "button button-primary";
      nextBtn.textContent = "Play next hand";
      nextBtn.onclick = () => callbacks.onNextHand?.();
      nextSection.appendChild(nextBtn);
    }
    if (
      callbacks?.onShowPreviousTricks &&
      state.completedTricksReview &&
      state.completedTricksReview.length > 0
    ) {
      const reviewBtn = document.createElement("button");
      reviewBtn.type = "button";
      reviewBtn.className = "button";
      reviewBtn.textContent = "Show previous round tricks";
      reviewBtn.onclick = () => callbacks.onShowPreviousTricks?.();
      nextSection.appendChild(reviewBtn);
    }
    body.appendChild(nextSection);
  }

  // —— Previous round tricks review panel (overlay) ——
  if (
    state.showPreviousTricks &&
    state.completedTricksReview &&
    state.completedTricksReview.length > 0
  ) {
    const overlay = document.createElement("div");
    overlay.className = "tricks-review-overlay";
    const panel = document.createElement("div");
    panel.className = "tricks-review-panel";
    const title = document.createElement("h3");
    title.className = "tricks-review-title";
    title.textContent = "Previous hand — tricks in order";
    panel.appendChild(title);
    const nameFor = (s: string) => state.seatNames?.[s as "N" | "E" | "S" | "W"] ?? s;
    state.completedTricksReview.forEach((trick) => {
      const trickBlock = document.createElement("div");
      trickBlock.className = "tricks-review-trick";
      const trickLabel = document.createElement("div");
      trickLabel.className = "tricks-review-trick-label";
      trickLabel.textContent = `Trick ${trick.trick_index}`;
      trickBlock.appendChild(trickLabel);
      const cardsRow = document.createElement("div");
      cardsRow.className = "tricks-review-cards";
      trick.plays.forEach(({ seat, card }) => {
        const cell = document.createElement("div");
        cell.className = "tricks-review-play";
        const isWinner = seat === trick.winner;
        if (isWinner) cell.classList.add("tricks-review-winner");
        const nameEl = document.createElement("div");
        nameEl.className = "tricks-review-play-name";
        nameEl.textContent = nameFor(seat) + (isWinner ? " ✓" : "");
        cell.appendChild(nameEl);
        const cardEl = document.createElement("div");
        cardEl.className = `playing-card tricks-review-card${card.suit === "HEARTS" || card.suit === "DIAMONDS" ? " red" : ""}`;
        const sym = suitSymbol(card.suit);
        cardEl.innerHTML = `
          <div class="corner top">${card.rank[0]}${sym}</div>
          <div class="suit-large">${sym}</div>
          <div class="corner bottom">${card.rank[0]}${sym}</div>
        `;
        cell.appendChild(cardEl);
        cardsRow.appendChild(cell);
      });
      trickBlock.appendChild(cardsRow);
      panel.appendChild(trickBlock);
    });
    const closeRow = document.createElement("div");
    closeRow.className = "tricks-review-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "button";
    closeBtn.textContent = "Close";
    closeBtn.onclick = () => callbacks?.onClosePreviousTricks?.();
    closeRow.appendChild(closeBtn);
    if (callbacks?.onNextHand) {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "button button-primary";
      nextBtn.textContent = "Play next hand";
      nextBtn.onclick = () => {
        callbacks.onClosePreviousTricks?.();
        callbacks.onNextHand?.();
      };
      closeRow.appendChild(nextBtn);
    }
    panel.appendChild(closeRow);
    overlay.appendChild(panel);
    overlay.onclick = (e) => {
      if (e.target === overlay) callbacks?.onClosePreviousTricks?.();
    };
    panel.onclick = (e) => e.stopPropagation();
    root.appendChild(overlay);
  }

  // —— Activity log ——
  const logSection = document.createElement("div");
  logSection.className = "table-section";
  const logLabel = document.createElement("div");
  logLabel.className = "section-title";
  logLabel.textContent = "Activity";
  const logContainer = document.createElement("div");
  logContainer.className = "log";
  state.logs.forEach((line, i) => {
    const row = document.createElement("div");
    const isError = line.startsWith("Error:");
    const isHighlight = line.startsWith("Hand complete") || line.includes(" wins ") || line.startsWith("Bidding team");
    row.className = "log-entry" + (isError ? " error" : isHighlight ? " highlight" : "");
    row.textContent = line;
    logContainer.appendChild(row);
  });
  queueMicrotask(() => {
    logContainer.scrollTop = logContainer.scrollHeight;
  });
  logSection.appendChild(logLabel);
  logSection.appendChild(logContainer);
  body.appendChild(logSection);

  card.appendChild(header);
  card.appendChild(body);
  root.appendChild(card);
}
