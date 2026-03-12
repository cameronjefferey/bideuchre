export type SeatKey = "N" | "E" | "S" | "W";

export type LobbyState = {
  roomCode: string;
  seats: Record<SeatKey, string | null>;
  logs: string[];
  connectionLost?: boolean;
};

export type LobbyCallbacks = {
  onStartHand?: () => void;
  onDevFill?: () => void;
};

export function renderLobby(
  root: HTMLElement,
  state: LobbyState,
  callbacks?: LobbyCallbacks,
): void {
  root.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  if (state.connectionLost) {
    const banner = document.createElement("div");
    banner.className = "connection-lost-banner";
    banner.textContent = "Connection lost. Refresh the page to rejoin.";
    card.appendChild(banner);
  }

  const header = document.createElement("div");
  header.className = "card-header";
  const pill = document.createElement("div");
  pill.className = "pill room-code-pill";
  pill.innerHTML = `
    <span>Room code</span>
    <strong class="room-code-display">${state.roomCode}</strong>
  `;
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "button button-secondary";
  copyBtn.textContent = "Copy";
  copyBtn.style.marginLeft = "0.5rem";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(state.roomCode).then(
      () => { copyBtn.textContent = "Copied!"; setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500); },
      () => {},
    );
  };
  header.innerHTML = `
    <div>
      <div class="title">Lobby</div>
      <div class="subtitle">Share the room code so others can join. When all four seats are filled, click <strong>Deal new hand</strong> to start.</div>
    </div>
  `;
  pill.appendChild(copyBtn);
  header.appendChild(pill);

  const body = document.createElement("div");
  body.className = "grid grid-2";

  const seatsCard = document.createElement("div");
  const seatsLabel = document.createElement("div");
  seatsLabel.className = "section-title";
  seatsLabel.textContent = "Seats (N · E · S · W)";
  const seatsGrid = document.createElement("div");
  seatsGrid.className = "seats lobby-seats";

  (["N", "E", "S", "W"] as SeatKey[]).forEach((seatKey) => {
    const seat = document.createElement("div");
    seat.className = "seat" + (state.seats[seatKey] ? " filled" : "");
    const name = state.seats[seatKey];
    seat.innerHTML = `
      <span>${seatKey}</span>
      <small>${name ?? "Empty"}</small>
    `;
    seatsGrid.appendChild(seat);
  });

  seatsCard.appendChild(seatsLabel);
  seatsCard.appendChild(seatsGrid);

  const logCard = document.createElement("div");
  const logLabel = document.createElement("div");
  logLabel.className = "section-title";
  logLabel.textContent = "Activity";
  const logContainer = document.createElement("div");
  logContainer.className = "log";
  state.logs.forEach((line) => {
    const row = document.createElement("div");
    row.className = "log-entry";
    row.textContent = line;
    logContainer.appendChild(row);
  });

  logCard.appendChild(logLabel);
  logCard.appendChild(logContainer);

  const filledCount = (["N", "E", "S", "W"] as SeatKey[]).filter(
    (s) => state.seats[s],
  ).length;
  const canStart = filledCount === 4;

  if (callbacks?.onStartHand || callbacks?.onDevFill) {
    const controls = document.createElement("div");
    controls.className = "button-row";
    controls.style.marginTop = "1rem";
    if (callbacks?.onStartHand) {
      const startButton = document.createElement("button");
      startButton.type = "button";
      startButton.className = "button button-primary";
      startButton.textContent = "Deal new hand";
      startButton.disabled = !canStart;
      startButton.onclick = () => callbacks.onStartHand?.();
      controls.appendChild(startButton);
      if (!canStart) {
        const hint = document.createElement("span");
        hint.className = "subtitle";
        hint.style.marginLeft = "0.5rem";
        hint.style.color = "var(--text-muted, #94a3b8)";
        hint.textContent = `(${filledCount}/4 players)`;
        controls.appendChild(hint);
      }
    }
    if (callbacks?.onDevFill) {
      const fillButton = document.createElement("button");
      fillButton.type = "button";
      fillButton.className = "button button-secondary";
      fillButton.textContent = "Dev: fill empty seats";
      fillButton.onclick = () => callbacks.onDevFill?.();
      controls.appendChild(fillButton);
    }
    logCard.appendChild(controls);
  }

  body.appendChild(seatsCard);
  body.appendChild(logCard);

  card.appendChild(header);
  card.appendChild(body);

  root.appendChild(card);
}
