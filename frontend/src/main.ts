import { renderLanding, type LandingState } from "./views/Landing";
import {
  renderLobby,
  type LobbyState,
  type SeatKey,
} from "./views/Lobby";
import { renderTable, type TableState } from "./views/Table";

type View =
  | { kind: "landing"; state: LandingState }
  | { kind: "lobby"; state: LobbyState & { seat: SeatKey } }
  | { kind: "table"; state: TableState };

const API_BASE = "http://localhost:8000";

const app = document.getElementById("app") as HTMLElement;

let ws: WebSocket | null = null;

let currentView: View = {
  kind: "landing",
  state: {
    name: "",
    roomCode: "",
    error: null,
  },
};

function render(): void {
  if (currentView.kind === "landing") {
    renderLanding(app, currentView.state, {
      onCreateRoom: handleCreateRoom,
      onJoinRoom: handleJoinRoom,
    });
  } else if (currentView.kind === "lobby") {
    renderLobby(app, currentView.state, {
      onStartHand: handleStartHand,
      onDevFill: handleDevFill,
    });
  } else if (currentView.kind === "table") {
    renderTable(app, currentView.state, {
      onStandardBid: handleStandardBid,
      onSpecialBid: handleSpecialBid,
      onPass: handlePass,
      onPlayCard: handlePlayCard,
      onForceScore: handleForceScore,
      onNextHand: handleNextHand,
      onSpecialExchange: handleSpecialExchange,
    });
  }
}

async function handleCreateRoom(name: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error("Failed to create room");
    }
    const data: { room_code: string } = await res.json();
    await joinRoom(name, data.room_code);
  } catch (err) {
    console.error(err);
    if (currentView.kind === "landing") {
      currentView.state.error = "Could not create room. Is the backend running?";
      render();
    }
  }
}

async function handleJoinRoom(name: string, roomCode: string): Promise<void> {
  try {
    await joinRoom(name, roomCode);
  } catch (err) {
    console.error(err);
    if (currentView.kind === "landing") {
      currentView.state.error = "Could not join room. Check the code and backend.";
      render();
    }
  }
}

async function joinRoom(name: string, roomCode: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error("Failed to join room");
  }
  const data: { seat: SeatKey; room_code: string } = await res.json();

  // Fetch room summary so we can show the lobby.
  const roomRes = await fetch(`${API_BASE}/rooms/${roomCode}`);
  if (!roomRes.ok) {
    throw new Error("Failed to load room");
  }
  const roomData: { code: string; seats: Record<SeatKey, string> } =
    await roomRes.json();

  currentView = {
    kind: "lobby",
    state: {
      roomCode: roomData.code,
      seats: {
        N: roomData.seats["N"] ?? null,
        E: roomData.seats["E"] ?? null,
        S: roomData.seats["S"] ?? null,
        W: roomData.seats["W"] ?? null,
      },
      seat: data.seat,
      logs: [`You joined seat ${data.seat} as ${name}.`],
    },
  };

  // Establish WebSocket connection for this room.
  ws = new WebSocket(`ws://localhost:8000/ws/${roomCode}/${data.seat}`);
  ws.onopen = () => {
    console.log("WebSocket connected");
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "connected") {
      if (currentView.kind === "lobby") {
        currentView.state.logs.push("Connected to table.");
        // Update seats if provided.
        if (msg.room?.seats) {
          currentView.state.seats = {
            N: msg.room.seats["N"] ?? null,
            E: msg.room.seats["E"] ?? null,
            S: msg.room.seats["S"] ?? null,
            W: msg.room.seats["W"] ?? null,
          };
        }
        if (msg.state) {
          // If a hand already exists when we connect, jump straight to table.
          currentView = {
            kind: "table",
            state: {
              roomCode: currentView.state.roomCode,
              seat: currentView.state.seat,
              phase: msg.state.phase,
              dealer: msg.state.dealer,
              hand: msg.state.hand ?? [],
              handSizes: msg.state.hand_sizes ?? {
                N: 0,
                E: 0,
                S: 0,
                W: 0,
              },
              currentTurn: msg.state.current_turn ?? null,
              currentBid: msg.state.current_bid ?? null,
              playTurn: msg.state.play_turn ?? null,
              currentTrick: msg.state.current_trick ?? undefined,
              scoreNS: msg.state.score_ns,
              scoreEW: msg.state.score_ew,
              handNumber: msg.state.hand_number,
              contractSummary: msg.state.bidding_summary ?? null,
              trumpSuit: msg.state.trump_suit ?? null,
              ledSuit: msg.state.led_suit ?? null,
              winningBid: msg.state.winning_bid ?? null,
              specialExchange: msg.state.special_exchange ?? null,
              logs: [`Existing hand. Phase=${msg.state.phase}, dealer=${msg.state.dealer}`],
            },
          };
        }
        render();
      }
    } else if (msg.type === "state") {
      // New hand or updated state: show the table with your hand.
      if (currentView.kind === "lobby") {
            currentView = {
          kind: "table",
          state: {
            roomCode: currentView.state.roomCode,
            seat: currentView.state.seat,
            phase: msg.state.phase,
            dealer: msg.state.dealer,
            hand: msg.state.hand ?? [],
            handSizes: msg.state.hand_sizes ?? {
              N: 0,
              E: 0,
              S: 0,
              W: 0,
            },
            currentTurn: msg.state.current_turn ?? null,
            currentBid: msg.state.current_bid ?? null,
            scoreNS: msg.state.score_ns,
            scoreEW: msg.state.score_ew,
            handNumber: msg.state.hand_number,
            contractSummary: msg.state.bidding_summary ?? null,
            trumpSuit: msg.state.trump_suit ?? null,
            ledSuit: msg.state.led_suit ?? null,
            winningBid: msg.state.winning_bid ?? null,
            specialExchange: msg.state.special_exchange ?? null,
            logs: [
              `New hand dealt. Phase=${msg.state.phase}, dealer=${msg.state.dealer}`,
            ],
          },
        };
      } else if (currentView.kind === "table") {
        // Track trick counts so we can show running totals and highlight
        // the winner of the most recent trick.
        const prevTricksWon = currentView.state.tricksWon;
        const nextTricksWon = msg.state.tricks_won as
          | Record<SeatKey, number>
          | undefined;

        currentView.state.phase = msg.state.phase;
        currentView.state.dealer = msg.state.dealer;
        currentView.state.hand = msg.state.hand ?? [];
        currentView.state.handSizes =
          msg.state.hand_sizes ??
          ({
            N: 0,
            E: 0,
            S: 0,
            W: 0,
          } as TableState["handSizes"]);
        currentView.state.currentTurn = msg.state.current_turn ?? null;
        currentView.state.currentBid = msg.state.current_bid ?? null;
        currentView.state.playTurn = msg.state.play_turn ?? null;
        currentView.state.currentTrick = msg.state.current_trick ?? undefined;
        if (msg.state.score_ns !== undefined) currentView.state.scoreNS = msg.state.score_ns;
        if (msg.state.score_ew !== undefined) currentView.state.scoreEW = msg.state.score_ew;
        if (msg.state.hand_number !== undefined) currentView.state.handNumber = msg.state.hand_number;
        currentView.state.contractSummary = msg.state.bidding_summary ?? currentView.state.contractSummary;
        if (msg.state.trump_suit !== undefined) currentView.state.trumpSuit = msg.state.trump_suit;
        if (msg.state.led_suit !== undefined) currentView.state.ledSuit = msg.state.led_suit;
        if (msg.state.winning_bid !== undefined) currentView.state.winningBid = msg.state.winning_bid;
        currentView.state.specialExchange = msg.state.special_exchange ?? null;
        currentView.state.tricksWon = nextTricksWon;

        // Detect which seat just won a trick by looking at the delta.
        let lastTrickWinner: SeatKey | null = null;
        if (prevTricksWon && nextTricksWon) {
          (["N", "E", "S", "W"] as SeatKey[]).forEach((s) => {
            if (nextTricksWon[s] > (prevTricksWon[s] ?? 0)) {
              lastTrickWinner = s;
            }
          });
        }
        currentView.state.lastTrickWinner = lastTrickWinner;

        const wb = msg.state.winning_bid
          ? JSON.stringify(msg.state.winning_bid)
          : "none";
        currentView.state.logs.push(
          `State update. Phase=${msg.state.phase}, dealer=${msg.state.dealer}, winning_bid=${wb}`,
        );
      }
      render();
    } else if (msg.type === "bidding_complete") {
      if (currentView.kind === "table") {
        if (msg.summary) {
          currentView.state.logs.push(msg.summary);
        } else {
          currentView.state.logs.push("Bidding complete.");
        }
        // Phase will be updated via subsequent state message.
        render();
      }
    } else if (msg.type === "hand_complete") {
      if (currentView.kind === "table") {
        if (msg.summary) {
          currentView.state.logs.push(msg.summary);
        } else {
          currentView.state.logs.push("Hand complete.");
        }
        render();
      }
    } else if (msg.type === "debug") {
      const text =
        typeof msg.message === "string"
          ? msg.message
          : JSON.stringify(msg.message);
      if (currentView.kind === "table") {
        currentView.state.logs.push(`Debug: ${text}`);
        render();
      } else if (currentView.kind === "lobby") {
        currentView.state.logs.push(`Debug: ${text}`);
        render();
      }
    } else if (msg.type === "error") {
      const message = typeof msg.message === "string" ? msg.message : "Unknown error";
      if (currentView.kind === "table") {
        currentView.state.logs.push(`Error: ${message}`);
        render();
      } else if (currentView.kind === "lobby") {
        currentView.state.logs.push(`Error: ${message}`);
        render();
      } else if (currentView.kind === "landing") {
        currentView.state.error = message;
        render();
      }
    } else if (msg.type === "echo") {
      currentView.state.logs.push(`Echo: ${JSON.stringify(msg.payload)}`);
      render();
    }
  };
  ws.onclose = () => {
    ws = null;
    if (currentView.kind === "lobby" || currentView.kind === "table") {
      currentView.state.logs.push("Disconnected from table.");
      render();
    }
  };

  render();
}

function handleStartHand(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "lobby") {
      currentView.state.logs.push("Cannot deal: not connected to table.");
      render();
    }
    return;
  }
  ws.send(JSON.stringify({ type: "start_hand" }));
  if (currentView.kind === "lobby") {
    currentView.state.logs.push("Requested new hand.");
    render();
  }
}

function handleStandardBid(level: number, trump: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot bid: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "bid_standard",
      level,
      trump,
    }),
  );
}

function handleSpecialBid(
  contract: "PUT_TWO_DOWN" | "PUT_ONE_DOWN" | "SHOOT_MOON",
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot bid: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "bid_special",
      contract,
    }),
  );
}

function handlePass(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot pass: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "pass",
    }),
  );
}

function handlePlayCard(index: number): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot play: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "play_card",
      index,
    }),
  );
}

function handleForceScore(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot score: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "force_score",
    }),
  );
}

function handleNextHand(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot start next hand: not connected to table.");
      render();
    }
    return;
  }
  ws.send(JSON.stringify({ type: "start_hand" }));
  if (currentView.kind === "table") {
    currentView.state.logs.push("Requested next hand.");
    render();
  }
}

function handleSpecialExchange(payload: {
  trump: string;
  discardIndices: number[];
}): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot exchange: not connected to table.");
      render();
    }
    return;
  }
  ws.send(
    JSON.stringify({
      type: "special_exchange",
      trump: payload.trump,
      discard_indices: payload.discardIndices,
    }),
  );
  if (currentView.kind === "table") {
    currentView.state.logs.push(
      `Submitting special exchange: trump=${payload.trump}, discards=[${payload.discardIndices.join(",")}].`,
    );
    render();
  }
}

async function handleDevFill(): Promise<void> {
  if (currentView.kind !== "lobby") return;
  try {
    const code = currentView.state.roomCode;
    const res = await fetch(`${API_BASE}/rooms/${code}/dev-fill`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error("Failed to fill room");
    }
    const data: { seats: Record<SeatKey, string> } = await res.json();
    currentView.state.seats = {
      N: data.seats["N"] ?? null,
      E: data.seats["E"] ?? null,
      S: data.seats["S"] ?? null,
      W: data.seats["W"] ?? null,
    };
    currentView.state.logs.push("Dev-filled empty seats with bots.");
    render();
  } catch (err) {
    console.error(err);
    if (currentView.kind === "lobby") {
      currentView.state.logs.push("Failed to dev-fill seats.");
      render();
    }
  }
}

render();

