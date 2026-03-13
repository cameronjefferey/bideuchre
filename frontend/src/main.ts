import { renderLanding, type LandingState } from "./views/Landing";
import {
  renderLobby,
  type LobbyState,
  type SeatKey,
} from "./views/Lobby";
import { renderTable, type TableState } from "./views/Table";

const API_BASE =
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

function normalizeSpecialExchange(
  raw: Record<string, unknown> | null | undefined
): TableState["specialExchange"] {
  if (!raw) return null;
  return {
    contract: raw.contract as "PUT_TWO_DOWN" | "PUT_ONE_DOWN" | "SHOOT_MOON",
    declarer: raw.declarer as "N" | "E" | "S" | "W",
    partner: raw.partner as "N" | "E" | "S" | "W",
    exchangeCount: Number(raw.exchange_count ?? raw.exchangeCount ?? 0),
    trumpType: (raw.trump_type ?? raw.trumpType) as string | null | undefined,
  };
}

type View =
  | { kind: "landing"; state: LandingState }
  | { kind: "lobby"; state: LobbyState & { seat: SeatKey } }
  | { kind: "table"; state: TableState };

const app = document.getElementById("app") as HTMLElement;

let ws: WebSocket | null = null;

/** True when page is unloading (refresh/navigate); don't show connection lost. */
let pageUnloading = false;
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    pageUnloading = true;
  });
}

/** Set when backend sends hand_started; injected into table state on next state msg. */
let pendingFirstJack: { sequence: Array<{ seat: string; card: { suit: string; rank: string } }>; dealer: string } | null = null;

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
      onBeginGame: handleBeginGame,
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
      onCollectTrick: () => {
        if (currentView.kind === "table") {
          currentView.state.showLastTrick = false;
          render();
        }
      },
      onShowPreviousTricks: () => {
        if (currentView.kind === "table") {
          currentView.state.showPreviousTricks = true;
          render();
        }
      },
      onClosePreviousTricks: () => {
        if (currentView.kind === "table") {
          currentView.state.showPreviousTricks = false;
          render();
        }
      },
      onFirstJackComplete: () => {
        if (currentView.kind === "table") {
          currentView.state.firstJackAnimation = undefined;
          currentView.state.firstJackRevealedIndex = undefined;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "start_hand" }));
            currentView.state.logs.push("Dealing hand…");
          }
          render();
        }
      },
      onFirstJackRevealNext: (nextIndex: number) => {
        if (currentView.kind === "table" && currentView.state.firstJackAnimation) {
          currentView.state.firstJackRevealedIndex = nextIndex;
          render();
        }
      },
      onStartGame: handleStartGame,
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
      currentView.state.error =
        err instanceof Error ? err.message : "Could not join room. Check the code and backend.";
      render();
    }
  }
}

async function joinRoom(name: string, roomCode: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch (err) {
    throw new Error("Cannot reach backend. Check VITE_BACKEND_URL and that the backend is running.");
  }
  if (!res.ok) {
    const msg = res.status === 404 ? "Room not found. Check the code or create a new room." : `Join failed (${res.status}).`;
    throw new Error(msg);
  }
  const data: { seat: SeatKey; room_code: string } = await res.json();

  // Fetch room summary so we can show the lobby.
  const roomRes = await fetch(`${API_BASE}/rooms/${roomCode}`);
  if (!roomRes.ok) {
    throw new Error(roomRes.status === 404 ? "Room not found." : `Load room failed (${roomRes.status}).`);
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
  const wsBase = API_BASE.replace(/^http/, "ws").replace(/\/$/, "");
  ws = new WebSocket(`${wsBase}/ws/${roomCode}/${data.seat}`);
  ws.onopen = () => {
    console.log("WebSocket connected");
    if (currentView.kind === "lobby" || currentView.kind === "table") {
      (currentView.state as { connectionLost?: boolean }).connectionLost = false;
      render();
    }
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
              seatNames: msg.state.seat_names ?? currentView.state.seats,
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
              specialExchange: normalizeSpecialExchange(msg.state.special_exchange),
              completedTricksReview: msg.state.completed_tricks_review,
              lastCompletedTrick: msg.state.last_completed_trick ?? undefined,
              logs: [`Existing hand. Phase=${msg.state.phase}, dealer=${msg.state.dealer}`],
            },
          };
        }
        render();
      }
    } else if (msg.type === "state") {
      // New hand or updated state: show the table with your hand.
      if (currentView.kind === "lobby") {
        const tableState: TableState = {
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
          seatNames: msg.state.seat_names ?? currentView.state.seats,
          currentTurn: msg.state.current_turn ?? null,
          currentBid: msg.state.current_bid ?? null,
          scoreNS: msg.state.score_ns,
          scoreEW: msg.state.score_ew,
          handNumber: msg.state.hand_number,
          contractSummary: msg.state.bidding_summary ?? null,
          trumpSuit: msg.state.trump_suit ?? null,
          ledSuit: msg.state.led_suit ?? null,
          winningBid: msg.state.winning_bid ?? null,
          specialExchange: normalizeSpecialExchange(msg.state.special_exchange),
          tricksWon:
            (msg.state.tricks_won as TableState["tricksWon"]) ?? {
              N: 0,
              E: 0,
              S: 0,
              W: 0,
            },
          lastCompletedTrick: undefined,
          showLastTrick: false,
          logs: [
            `New hand dealt. Phase=${msg.state.phase}, dealer=${msg.state.dealer}`,
          ],
        };
        if (pendingFirstJack) {
          tableState.firstJackAnimation = pendingFirstJack;
          pendingFirstJack = null;
        }
        currentView = { kind: "table", state: tableState };
      } else if (currentView.kind === "table") {
        if (pendingFirstJack) {
          currentView.state.firstJackAnimation = pendingFirstJack;
          pendingFirstJack = null;
        }
        // Track trick counts so we can show running totals and highlight
        // the winner of the most recent trick.
        const prevTricksWon = currentView.state.tricksWon;
        const prevTrick = currentView.state.currentTrick;
        const nextTricksWon = msg.state.tricks_won as
          | Record<SeatKey, number>
          | undefined;

        currentView.state.phase = msg.state.phase;
        currentView.state.dealer = msg.state.dealer;
        currentView.state.hand = msg.state.hand ?? [];
        if (msg.state.phase === "BIDDING" || msg.state.phase === "PLAYING") {
          currentView.state.firstJackAnimation = undefined;
          currentView.state.firstJackRevealedIndex = undefined;
        }
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
        const nextSpecial = normalizeSpecialExchange(msg.state.special_exchange);
        if (nextSpecial) {
          currentView.state.specialExchange = nextSpecial;
        } else if (msg.state.phase !== "EXCHANGE" || !currentView.state.specialExchange) {
          currentView.state.specialExchange = null;
        }
        // else stay in EXCHANGE with no special_exchange in message: keep existing so partner keeps trump
        if (msg.state.seat_names !== undefined) {
          currentView.state.seatNames = msg.state.seat_names;
        }
        if (msg.state.completed_tricks_review !== undefined) {
          currentView.state.completedTricksReview = msg.state.completed_tricks_review;
        }
        if (msg.state.last_completed_trick !== undefined) {
          currentView.state.lastCompletedTrick = msg.state.last_completed_trick as TableState["currentTrick"];
        }
        currentView.state.tricksWon = nextTricksWon;

        // Detect trick completion: previous trick had 3–4 cards, new trick is empty or missing.
        const prevCount = prevTrick
          ? Object.keys(prevTrick).length
          : 0;
        const newCount = currentView.state.currentTrick
          ? Object.keys(currentView.state.currentTrick).length
          : 0;
        if (
          msg.state.phase === "PLAYING" &&
          prevCount >= 3 &&
          (newCount === 0 || !currentView.state.currentTrick)
        ) {
          // Prefer the server-provided full last_completed_trick (which always
          // has all cards), but fall back to the previous client-side trick if
          // running against an older backend.
          const fromServer = msg.state.last_completed_trick as
            | TableState["currentTrick"]
            | undefined;
          currentView.state.lastCompletedTrick =
            fromServer ?? (prevTrick as TableState["currentTrick"]);
          currentView.state.showLastTrick = true;
        }
        // As soon as the next trick actually starts (a new card is played),
        // hide the "last trick" overlay for everyone so all seats see the
        // live trick instead of being stuck on the previous one.
        if (msg.state.phase === "PLAYING" && newCount > 0) {
          currentView.state.showLastTrick = false;
        }
        if (msg.state.phase !== "PLAYING") {
          currentView.state.showLastTrick = false;
        }

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
    } else if (msg.type === "room_update") {
      if (currentView.kind === "lobby") {
        if (msg.room?.seats) {
          currentView.state.seats = {
            N: msg.room.seats["N"] ?? null,
            E: msg.room.seats["E"] ?? null,
            S: msg.room.seats["S"] ?? null,
            W: msg.room.seats["W"] ?? null,
          };
          render();
        }
      } else if (currentView.kind === "table") {
        if (msg.room?.seats) {
          currentView.state.seatNames = {
            N: msg.room.seats["N"] ?? null,
            E: msg.room.seats["E"] ?? null,
            S: msg.room.seats["S"] ?? null,
            W: msg.room.seats["W"] ?? null,
          };
          render();
        }
      }
    } else if (msg.type === "hand_started") {
      if (msg.first_jack && typeof msg.first_jack === "object") {
        const firstJack = {
          sequence: Array.isArray(msg.first_jack.sequence) ? msg.first_jack.sequence : [],
          dealer: String(msg.first_jack.dealer ?? "N"),
        };
        if (currentView.kind === "lobby") {
          // Original flow: coming straight from the lobby into the first-jack
          // animation. Create a fresh table view.
          currentView = {
            kind: "table",
            state: {
              roomCode: currentView.state.roomCode,
              seat: currentView.state.seat,
              phase: "AWAIT_DEAL",
              dealer: firstJack.dealer,
              hand: [],
              handSizes: { N: 0, E: 0, S: 0, W: 0 },
              seatNames: {
                N: currentView.state.seats.N,
                E: currentView.state.seats.E,
                S: currentView.state.seats.S,
                W: currentView.state.seats.W,
              },
              firstJackAnimation: firstJack,
              firstJackRevealedIndex: 0,
              logs: [...currentView.state.logs, "First jack — who deals?"],
            },
          };
          render();
        } else if (currentView.kind === "table") {
          // New flow: players are already \"around the table\" in AWAIT_DEAL and
          // click Start game. Inject the first-jack animation into the existing
          // table state immediately so they see \"First jack — who deals?\".
          currentView.state.phase = "AWAIT_DEAL";
          currentView.state.dealer = firstJack.dealer;
          currentView.state.firstJackAnimation = firstJack;
          currentView.state.firstJackRevealedIndex = 0;
          currentView.state.logs.push("First jack — who deals?");
          render();
        } else {
          // Any other view (very unlikely): stash and apply on next state.
          pendingFirstJack = firstJack;
        }
      }
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
    if (pageUnloading) return;
    if (currentView.kind === "lobby" || currentView.kind === "table") {
      (currentView.state as { connectionLost?: boolean }).connectionLost = true;
      currentView.state.logs.push("Disconnected from table.");
      render();
    }
  };

  render();
}

function handleBeginGame(): void {
  if (currentView.kind === "lobby") {
    // Move everyone from the lobby into the shared table view without
    // actually starting the game yet. From there, a separate \"Start game\"
    // action will trigger the dealer / first‑jack process.
    currentView = {
      kind: "table",
      state: {
        roomCode: currentView.state.roomCode,
        seat: currentView.state.seat,
        phase: "AWAIT_DEAL",
        dealer: currentView.state.seat,
        hand: [],
        handSizes: {
          N: 0,
          E: 0,
          S: 0,
          W: 0,
        },
        seatNames: currentView.state.seats,
        currentTurn: null,
        currentBid: null,
        logs: [
          ...currentView.state.logs,
          "All players are at the table. When you're ready, start the game to decide the dealer.",
        ],
      },
    };
    render();
  }
}

function handleStartGame(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot start game: not connected to table.");
      render();
    }
    return;
  }
  ws.send(JSON.stringify({ type: "begin_game" }));
  if (currentView.kind === "table") {
    currentView.state.logs.push("Starting game…");
    render();
  }
}

function handleStartHand(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (currentView.kind === "table") {
      currentView.state.logs.push("Cannot deal: not connected to table.");
      render();
    }
    return;
  }
  ws.send(JSON.stringify({ type: "start_hand" }));
  if (currentView.kind === "table") {
    currentView.state.showPreviousTricks = false;
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
    currentView.state.showPreviousTricks = false;
    currentView.state.logs.push("Requested next hand.");
    render();
  }
}

function handleSpecialExchange(payload: {
  kind: "set_trump" | "discard" | "partner_give";
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
  if (payload.kind === "set_trump") {
    ws.send(
      JSON.stringify({
        type: "special_set_trump",
        trump: payload.trump,
      }),
    );
  } else if (payload.kind === "discard") {
    ws.send(
      JSON.stringify({
        type: "special_discard",
        discard_indices: payload.discardIndices,
      }),
    );
  } else if (payload.kind === "partner_give") {
    ws.send(
      JSON.stringify({
        type: "special_partner_give",
        give_indices: payload.discardIndices,
      }),
    );
  }
  if (currentView.kind === "table") {
    currentView.state.logs.push(
      `Special contract action: ${payload.kind}, trump=${payload.trump}, indices=[${payload.discardIndices.join(",")}].`,
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

