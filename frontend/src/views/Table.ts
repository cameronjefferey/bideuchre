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

  const card = document.createElement("div");
  card.className = "card";

  // —— Header: room, you, phase, score ——
  const header = document.createElement("div");
  header.className = "card-header";
  const handLabelText =
    state.handNumber && state.handNumber > 0
      ? `Hand ${state.handNumber} of 8`
      : "Hand —";
  const scoreHtml =
    state.scoreNS !== undefined && state.scoreEW !== undefined
      ? `
      <div class="score-team">
        <span class="label">N/S</span>
        <span class="value">${state.scoreNS}</span>
      </div>
      <div class="score-divider"></div>
      <div class="score-team">
        <span class="label">E/W</span>
        <span class="value">${state.scoreEW}</span>
      </div>
    `
      : "";
  header.innerHTML = `
    <div>
      <div class="title">Room ${state.roomCode}</div>
      <div class="subtitle">
        You are <span class="badge badge-you">${state.seat}</span>
        · Dealer: ${state.dealer}
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
  tableTitle.textContent = "Table";
  const tricksInfo = document.createElement("div");
  tricksInfo.className = "subtitle";
  tricksInfo.textContent = `Tricks this hand · N/S ${nsTricks} – ${ewTricks} E/W`;
  const contractInfo = document.createElement("div");
  contractInfo.className = "subtitle";
  if (state.contractSummary) {
    contractInfo.textContent = state.contractSummary;
  }
  const tableFelt = document.createElement("div");
  tableFelt.className = "table-felt";
  const tableGrid = document.createElement("div");
  tableGrid.className = "table-grid";

  function seatEl(seat: "N" | "E" | "S" | "W", position: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "table-seat";
    if (state.lastTrickWinner === seat) {
      el.classList.add("winner-seat");
    }
    const size = state.handSizes[seat] ?? 0;
    const you = state.seat === seat ? " (you)" : "";
    const tricks = state.tricksWon?.[seat] ?? 0;
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
          bidLine = `Bid: ${state.winningBid.level} ${tt}`;
        }
      }
    }
    el.innerHTML = `
      <div class="seat-name">${seat}${you}</div>
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
      if (c) {
        const sym = suitSymbol(c.suit);
        slot.className = "playing-card" + (c.suit === "HEARTS" || c.suit === "DIAMONDS" ? " red" : "");
        slot.innerHTML = `
          <div class="corner top">${c.rank[0]}${sym}</div>
          <div class="suit-large">${sym}</div>
          <div class="corner bottom">${c.rank[0]}${sym}</div>
        `;
      } else {
        slot.className = "trick-slot-empty";
        slot.textContent = seatKey;
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
  if (state.phase === "BIDDING") {
    parts.push("Bidding");
    if (state.currentBid) {
      parts.push(`Current: ${state.currentBid.level} ${state.currentBid.bidType} by ${state.currentBid.seat}`);
    } else {
      parts.push("No bids yet");
    }
    if (state.currentTurn) {
      parts.push(state.currentTurn === state.seat ? `Your turn` : `${state.currentTurn}'s turn`);
    }
  } else if (state.phase === "PLAYING") {
    parts.push("Playing");
    if (state.playTurn) {
      parts.push(state.playTurn === state.seat ? `Your turn` : `${state.playTurn}'s turn`);
    }
  } else if (state.phase === "EXCHANGE" && state.specialExchange) {
    parts.push("Special hand setup");
    parts.push(
      `${state.specialExchange.contract === "PUT_TWO_DOWN" ? "Put Two Down" : state.specialExchange.contract === "PUT_ONE_DOWN" ? "Put One Down" : "Shoot the Moon"} by ${
        state.specialExchange.declarer
      }`,
    );
  } else if (state.phase === "COMPLETE") {
    parts.push("Hand complete");
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
    const trump = state.trumpSuit;

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
    if (callbacks?.onPlayCard && state.phase === "PLAYING") {
      cardEl.style.cursor = "pointer";
      cardEl.onclick = () => callbacks.onPlayCard?.(index);
    } else if (callbacks?.onSpecialExchange && state.phase === "EXCHANGE" && state.specialExchange) {
      cardEl.style.cursor = "pointer";
      cardEl.onclick = () => {
        cardEl.classList.toggle("selected");
      };
    }
    handRow.appendChild(cardEl);
  });

  handSection.appendChild(handLabel);
  handSection.appendChild(handRow);
  body.appendChild(handSection);

  // —— Special exchange controls (special contracts) ——
  if (state.phase === "EXCHANGE" && state.specialExchange && callbacks?.onSpecialExchange) {
    const ex = state.specialExchange;
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
    desc.textContent = `${friendly} by ${ex.declarer}. Choose trump and select ${ex.exchangeCount} card${
      ex.exchangeCount === 1 ? "" : "s"
    } from the declarer's hand to exchange.`;

    const controls = document.createElement("div");
    controls.className = "button-row";

    const trumpSelect = document.createElement("select");
    trumpSelect.style.width = "auto";
    trumpSelect.style.minWidth = "7rem";
    ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (ex.trumpType && ex.trumpType === t) {
        opt.selected = true;
      }
      trumpSelect.appendChild(opt);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "button button-primary";
    confirmBtn.textContent = "Confirm exchange";
    confirmBtn.onclick = () => {
      const cards = Array.from(
        handRow.querySelectorAll<HTMLDivElement>(".playing-card"),
      );
      const discardIndices: number[] = [];
      cards.forEach((el, idx) => {
        if (el.classList.contains("selected")) {
          const original = el.dataset.index;
          if (original != null) discardIndices.push(Number(original));
        }
      });
      // Always send what the user selected; the backend validates the count
      // and will send an error message if it's wrong.
      callbacks.onSpecialExchange?.({
        trump: trumpSelect.value,
        discardIndices,
      });
    };

    controls.appendChild(trumpSelect);
    controls.appendChild(confirmBtn);

    exSection.appendChild(exTitle);
    exSection.appendChild(desc);
    exSection.appendChild(controls);
    body.appendChild(exSection);
  }

  // —— Bidding controls ——
  if (state.phase === "BIDDING" && callbacks) {
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

  // —— Play next hand ——
  if (callbacks?.onNextHand && state.phase === "COMPLETE") {
    const nextSection = document.createElement("div");
    nextSection.className = "table-section";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "button button-primary";
    nextBtn.textContent = "Play next hand";
    nextBtn.onclick = () => callbacks.onNextHand?.();
    nextSection.appendChild(nextBtn);
    body.appendChild(nextSection);
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
    const isHighlight = line.startsWith("Hand complete") || line.startsWith("E wins") || line.startsWith("N wins") || line.startsWith("S wins") || line.startsWith("W wins") || line.startsWith("Bidding team");
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
