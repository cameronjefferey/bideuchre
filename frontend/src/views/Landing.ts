export type LandingState = {
  name: string;
  roomCode: string;
  error: string | null;
};

export type LandingCallbacks = {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, roomCode: string) => void;
};

export function renderLanding(
  root: HTMLElement,
  state: LandingState,
  callbacks: LandingCallbacks,
): void {
  root.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  const hero = document.createElement("div");
  hero.className = "landing-hero";
  hero.innerHTML = `
    <div class="title">Bid Euchre</div>
    <div class="subtitle">4-player online · share a room code to play</div>
  `;

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Your name";
  const nameInput = document.createElement("input");
  nameInput.placeholder = "e.g. Alex";
  nameInput.value = state.name;
  nameInput.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    state.name = target.value;
  });

  const grid = document.createElement("div");
  grid.className = "grid grid-2";

  const createCard = document.createElement("div");
  createCard.className = "landing-action-card";
  const createLabel = document.createElement("label");
  createLabel.textContent = "Start a new table";
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "button button-primary";
  createButton.textContent = "Create room";
  createButton.onclick = () => {
    if (!state.name.trim()) {
      state.error = "Please enter your name.";
      renderLanding(root, state, callbacks);
      return;
    }
    callbacks.onCreateRoom(state.name.trim());
  };
  const createRow = document.createElement("div");
  createRow.className = "button-row";
  createRow.appendChild(createButton);
  createCard.appendChild(createLabel);
  createCard.appendChild(createRow);

  const joinCard = document.createElement("div");
  joinCard.className = "landing-action-card";
  const joinLabel = document.createElement("label");
  joinLabel.textContent = "Join with a room code";
  const joinInput = document.createElement("input");
  joinInput.placeholder = "e.g. ABC123";
  joinInput.value = state.roomCode;
  joinInput.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    state.roomCode = target.value.toUpperCase();
  });
  const joinButton = document.createElement("button");
  joinButton.type = "button";
  joinButton.className = "button button-secondary";
  joinButton.textContent = "Join room";
  joinButton.onclick = () => {
    if (!state.name.trim() || !state.roomCode.trim()) {
      state.error = "Enter both your name and a room code.";
      renderLanding(root, state, callbacks);
      return;
    }
    callbacks.onJoinRoom(state.name.trim(), state.roomCode.trim());
  };
  const joinRow = document.createElement("div");
  joinRow.className = "button-row";
  joinRow.appendChild(joinButton);
  joinCard.appendChild(joinLabel);
  joinCard.appendChild(joinInput);
  joinCard.appendChild(joinRow);

  if (state.error) {
    const err = document.createElement("div");
    err.className = "error";
    err.textContent = state.error;
    joinCard.appendChild(err);
  }

  grid.appendChild(createCard);
  grid.appendChild(joinCard);

  const nameSection = document.createElement("div");
  nameSection.className = "table-section";
  nameSection.appendChild(nameLabel);
  nameSection.appendChild(nameInput);

  card.appendChild(hero);
  card.appendChild(nameSection);
  card.appendChild(grid);

  root.appendChild(card);
}
