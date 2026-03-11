from __future__ import annotations

from typing import Dict, List, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.rooms import room_manager
from ..game.engine import deal_new_hand, start_play, play_card
from ..game.state import GameState, Phase, SEATS
from ..game.cards import Suit, card_is_trump
from ..game.full_bidding import (
    ActionType,
    BiddingResult,
    BiddingState,
    PlayerAction,
    SpecialBid,
    SpecialContract,
    StandardBid,
    TrumpType,
    finalise_bidding,
    start_bidding,
)
from ..game.hand_scoring import compute_team_score_deltas


router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        # room_code -> list of (websocket, seat)
        self._connections: Dict[str, List[Tuple[WebSocket, str]]] = {}

    async def connect(self, room_code: str, seat: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(room_code, []).append((websocket, seat))

    def disconnect(self, room_code: str, websocket: WebSocket) -> None:
        if room_code in self._connections:
            self._connections[room_code] = [
                (ws, seat)
                for (ws, seat) in self._connections[room_code]
                if ws is not websocket
            ]
            if not self._connections[room_code]:
                del self._connections[room_code]

    async def send_to_all(self, room_code: str, message: dict) -> None:
        for ws, _ in self._connections.get(room_code, []):
            await ws.send_json(message)

    async def broadcast_state(
        self,
        room_code: str,
        state: GameState,
        bidding_state: BiddingState | None,
        bidding_result: BiddingResult | None,
    ) -> None:
        room = room_manager.get_room(room_code)
        score_ns = room.score_ns if room else 0
        score_ew = room.score_ew if room else 0
        hand_number = room.hand_number if room else 0

        for ws, seat in self._connections.get(room_code, []):
            await ws.send_json(
                {
                    "type": "state",
                    "state": _serialize_state_for_seat(
                        state,
                        viewing_seat=seat,
                        bidding_state=bidding_state,
                        bidding_result=bidding_result,
                        score_ns=score_ns,
                        score_ew=score_ew,
                        hand_number=hand_number,
                    ),
                }
            )


connection_manager = ConnectionManager()


def _serialize_state_for_seat(
    state: GameState,
    viewing_seat: str,
    bidding_state: BiddingState | None,
    bidding_result: BiddingResult | None,
    score_ns: int,
    score_ew: int,
    hand_number: int,
) -> dict:
    current_turn: str | None = None
    current_bid: dict | None = None

    if bidding_state is not None and not bidding_state.done:
        current_turn = bidding_state.turn_order[bidding_state.current_index]
        if bidding_state.highest_bid is not None and bidding_state.highest_bidder:
            bid = bidding_state.highest_bid
            seat = bidding_state.highest_bidder
            if isinstance(bid, StandardBid):
                current_bid = {
                    "seat": seat,
                    "level": str(bid.level),
                    "bidType": bid.trump.name,
                }
            else:  # SpecialBid
                current_bid = {
                    "seat": seat,
                    "level": bid.contract.name,
                    "bidType": "",
                }

    bidding_summary: str | None = None
    winning_bid_info: Dict[str, object] | None = None
    if bidding_result is not None:
        if bidding_result.winning_player is None:
            bidding_summary = "All players passed. No contract."
        elif bidding_result.is_special_contract:
            # Map to readable labels.
            contract = bidding_result.winning_bid.contract  # type: ignore[union-attr]
            label = {
                SpecialContract.PUT_TWO_DOWN: "Put Two Down",
                SpecialContract.PUT_ONE_DOWN: "Put One Down",
                SpecialContract.SHOOT_MOON: "Shoot the Moon",
            }[contract]
            bidding_summary = (
                f"{bidding_result.winning_player} wins with special contract {label}."
            )
            winning_bid_info = {
                "seat": bidding_result.winning_player,
                "label": label,
            }
        else:
            assert bidding_result.numeric_level is not None
            assert bidding_result.trump_type is not None
            bidding_summary = (
                f"{bidding_result.winning_player} wins with "
                f"{bidding_result.numeric_level} {bidding_result.trump_type.name.title()}."
            )
            winning_bid_info = {
                "seat": bidding_result.winning_player,
                "level": bidding_result.numeric_level,
                "trump_type": bidding_result.trump_type.name,
            }

    play_turn: str | None = None
    current_trick: Dict[str, dict] | None = None
    if state.phase is Phase.PLAYING and state.current_trick is not None:
        # Determine whose turn to play next, skipping the declarer's partner
        # when an \"alone\" special contract is in effect.
        skip_seat: str | None = None
        if state.alone_seat is not None:
            partner_map = {"N": "S", "S": "N", "E": "W", "W": "E"}
            skip_seat = partner_map[state.alone_seat]

        if not state.current_trick.plays:
            play_turn = state.current_trick.leader
            if skip_seat is not None and play_turn == skip_seat:
                idx = SEATS.index(play_turn)
                play_turn = SEATS[(idx + 1) % 4]
        else:
            last_seat = state.current_trick.plays[-1][0]
            idx = SEATS.index(last_seat)
            while True:
                idx = (idx + 1) % 4
                candidate = SEATS[idx]
                if candidate != skip_seat:
                    play_turn = candidate
                    break

        current_trick = {}
        for seat, card in state.current_trick.plays:
            current_trick[seat] = card.to_dict()

    # In dev mode we want a single client to be able to drive all seats.
    # During BIDDING, show the hand of the player whose turn it is to bid.
    # During PLAYING, show the current player's hand so you can see and choose
    # legal cards for whichever seat is acting.
    hand_owner = viewing_seat
    if state.phase is Phase.BIDDING and bidding_state is not None and not bidding_state.done:
        hand_owner = bidding_state.turn_order[bidding_state.current_index]
    if state.phase is Phase.PLAYING and play_turn is not None:
        hand_owner = play_turn
    # During EXCHANGE for a special contract, always show the declarer's hand.
    if (
        state.phase is Phase.EXCHANGE
        and bidding_result is not None
        and bidding_result.is_special_contract
        and bidding_result.winning_player is not None
    ):
        hand_owner = bidding_result.winning_player

    special_exchange: Dict[str, object] | None = None
    led_suit_display: str | None = None
    if (
        state.phase is Phase.EXCHANGE
        and bidding_result is not None
        and bidding_result.is_special_contract
        and bidding_result.winning_bid is not None
        and bidding_result.winning_player is not None
    ):
        contract = bidding_result.winning_bid.contract  # type: ignore[union-attr]
        declarer = bidding_result.winning_player
        partner_map = {"N": "S", "S": "N", "E": "W", "W": "E"}
        partner = partner_map[declarer]
        if contract is SpecialContract.PUT_TWO_DOWN:
            exchange_count = 2
        elif contract is SpecialContract.PUT_ONE_DOWN:
            exchange_count = 1
        else:
            exchange_count = 0
        special_exchange = {
            "contract": contract.name,
            "declarer": declarer,
            "partner": partner,
            "exchange_count": exchange_count,
            "trump_type": bidding_result.trump_type.name
            if bidding_result.trump_type is not None
            else None,
        }

    # Determine a user-friendly description of what suit was led in the
    # current trick. If the first card is trump (including bowers), we
    # say trump was led; otherwise we use its printed suit.
    if state.current_trick is not None and state.current_trick.plays:
        first_card = state.current_trick.plays[0][1]
        if state.trump is not None and card_is_trump(first_card, state.trump):
            led_suit_display = state.trump.name.title()
        else:
            led_suit_display = first_card.suit.name.title()

    return {
        "phase": state.phase.name,
        "dealer": state.dealer,
        "tricks_won": state.tricks_won,
        "hand": [card.to_dict() for card in state.hands[hand_owner]],
        "hand_sizes": {seat: len(hand) for seat, hand in state.hands.items()},
        "viewing_seat": viewing_seat,
        "current_turn": current_turn,
        "current_bid": current_bid,
        "bidding_summary": bidding_summary,
        "play_turn": play_turn,
        "current_trick": current_trick,
        "score_ns": score_ns,
        "score_ew": score_ew,
        "hand_number": hand_number,
        "special_exchange": special_exchange,
        "trump_suit": state.trump.name if state.trump is not None else None,
        "led_suit": led_suit_display,
        "winning_bid": winning_bid_info,
    }


@router.websocket("/ws/{room_code}/{seat}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, seat: str) -> None:
    # For now, just ensure the room exists and echo basic state changes.
    room = room_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=1008)
        return
    if seat not in room.players:
        await websocket.close(code=1008)
        return

    await connection_manager.connect(room_code, seat, websocket)
    initial: dict = {"type": "connected", "room": room.to_public_dict(), "seat": seat}
    if room.game_state is not None:
        initial["state"] = _serialize_state_for_seat(
            room.game_state,
            seat,
            room.bidding_state,
            room.bidding_result,
            room.score_ns,
            room.score_ew,
            room.hand_number,
        )
    await websocket.send_json(initial)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "start_hand":
                if len(room.players) != 4:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Need 4 players to start a hand.",
                        }
                    )
                    continue

                player_names = {s: info.name for s, info in room.players.items()}
                # For now, always let North deal first.
                room.game_state = deal_new_hand(player_names, dealer="N")
                room.hand_number += 1
                # Start bidding for this hand.
                room.bidding_state = start_bidding(dealer="N")
                room.bidding_result = None
                await connection_manager.broadcast_state(
                    room_code, room.game_state, room.bidding_state, room.bidding_result
                )
            elif msg_type in {"bid_standard", "bid_special", "pass"}:
                if room.game_state is None or room.bidding_state is None:
                    await websocket.send_json(
                        {"type": "error", "message": "No active hand to bid on."}
                    )
                    continue
                if room.game_state.phase is not Phase.BIDDING:
                    await websocket.send_json(
                        {"type": "error", "message": "Not in bidding phase."}
                    )
                    continue

                # For development convenience, use the bidding state's current seat
                # as the actor, regardless of which client sends the message.
                current_seat = room.bidding_state.turn_order[
                    room.bidding_state.current_index
                ]

                try:
                    if msg_type == "pass":
                        action = PlayerAction(
                            seat=current_seat,
                            kind=ActionType.PASS,
                            bid=None,
                        )
                    elif msg_type == "bid_standard":
                        level = int(data.get("level"))
                        trump_raw = str(data.get("trump"))
                        trump = TrumpType[trump_raw]
                        bid = StandardBid(level=level, trump=trump)
                        action = PlayerAction(
                            seat=current_seat,
                            kind=ActionType.BID,
                            bid=bid,
                        )
                    else:  # "bid_special"
                        contract_raw = str(data.get("contract"))
                        contract = SpecialContract[contract_raw]
                        bid = SpecialBid(contract=contract)
                        action = PlayerAction(
                            seat=current_seat,
                            kind=ActionType.BID,
                            bid=bid,
                        )

                    from ..game.full_bidding import apply_action  # local import

                    apply_action(room.bidding_state, action)
                except Exception as exc:  # noqa: BLE001
                    await websocket.send_json(
                        {"type": "error", "message": str(exc)}
                    )
                    continue

                # If bidding finished, compute result and move to playing placeholder.
                if room.bidding_state.done:
                    room.bidding_result = finalise_bidding(room.bidding_state)

                    # If there is a numbered bid with a suit trump, start play immediately.
                    if (
                        room.bidding_result.winning_bid is not None
                        and not room.bidding_result.is_special_contract
                        and room.bidding_result.trump_type
                        in {
                            TrumpType.HEARTS,
                            TrumpType.DIAMONDS,
                            TrumpType.CLUBS,
                            TrumpType.SPADES,
                        }
                    ):
                        trump_map = {
                            TrumpType.HEARTS: Suit.HEARTS,
                            TrumpType.DIAMONDS: Suit.DIAMONDS,
                            TrumpType.CLUBS: Suit.CLUBS,
                            TrumpType.SPADES: Suit.SPADES,
                        }
                        trump_suit = trump_map[room.bidding_result.trump_type]
                        leader = room.bidding_result.winning_player
                        assert leader is not None
                        start_play(room.game_state, trump=trump_suit, leader=leader)
                    elif (
                        room.bidding_result.winning_bid is not None
                        and room.bidding_result.is_special_contract
                        and room.game_state is not None
                    ):
                        # For special contracts, enter an EXCHANGE phase. The declarer
                        # will pick trump and choose cards to exchange via a separate
                        # \"special_exchange\" WebSocket message.
                        room.game_state.phase = Phase.EXCHANGE

                    # Announce the winning bid.
                    if room.bidding_result is None:
                        bidding_summary = "Bidding complete."
                    elif room.bidding_result.winning_player is None:
                        bidding_summary = "All players passed. No contract."
                    elif room.bidding_result.is_special_contract:
                        contract = room.bidding_result.winning_bid.contract  # type: ignore[union-attr]
                        label = {
                            SpecialContract.PUT_TWO_DOWN: "Put Two Down",
                            SpecialContract.PUT_ONE_DOWN: "Put One Down",
                            SpecialContract.SHOOT_MOON: "Shoot the Moon",
                        }[contract]
                        bidding_summary = (
                            f"{room.bidding_result.winning_player} wins with special contract {label}."
                        )
                    else:
                        assert room.bidding_result.numeric_level is not None
                        assert room.bidding_result.trump_type is not None
                        bidding_summary = (
                            f"{room.bidding_result.winning_player} wins with "
                            f"{room.bidding_result.numeric_level} {room.bidding_result.trump_type.name.title()}."
                        )

                    await connection_manager.send_to_all(
                        room_code,
                        {
                            "type": "bidding_complete",
                            "summary": bidding_summary,
                        },
                    )

                await connection_manager.broadcast_state(
                    room_code, room.game_state, room.bidding_state, room.bidding_result
                )
            elif msg_type == "play_card":
                if room.game_state is None:
                    await websocket.send_json(
                        {"type": "error", "message": "No active hand."}
                    )
                    continue
                if room.game_state.phase is not Phase.PLAYING:
                    await websocket.send_json(
                        {"type": "error", "message": "Not in playing phase."}
                    )
                    continue
                try:
                    index = int(data.get("index"))
                    # Determine which seat should act next in play, just like in
                    # _serialize_state_for_seat. This allows a single dev client
                    # to drive all four seats.
                    if room.game_state.current_trick is None:
                        raise ValueError("No active trick.")
                    # Determine whose turn it is, skipping the declarer's partner
                    # when playing an "alone" special contract.
                    skip_seat: str | None = None
                    if room.game_state.alone_seat is not None:
                        partner_map = {"N": "S", "S": "N", "E": "W", "W": "E"}
                        skip_seat = partner_map[room.game_state.alone_seat]

                    if not room.game_state.current_trick.plays:
                        current_seat = room.game_state.current_trick.leader
                        if skip_seat is not None and current_seat == skip_seat:
                            # If leader would be the skipped partner (shouldn't
                            # normally happen), advance once.
                            idx = SEATS.index(current_seat)
                            current_seat = SEATS[(idx + 1) % 4]
                    else:
                        last_seat = room.game_state.current_trick.plays[-1][0]
                        idx = SEATS.index(last_seat)
                        while True:
                            idx = (idx + 1) % 4
                            candidate = SEATS[idx]
                            if candidate != skip_seat:
                                current_seat = candidate
                                break

                    hand = room.game_state.hands[current_seat]
                    if not (0 <= index < len(hand)):
                        raise ValueError("Invalid card index.")
                    card = hand[index]
                    play_card(room.game_state, current_seat, card)
                except Exception as exc:  # noqa: BLE001
                    await websocket.send_json(
                        {"type": "error", "message": str(exc)}
                    )
                    continue

                # Debug: send current trick / hand info after each play.
                try:
                    debug_info = {
                        "phase": room.game_state.phase.name,
                        "completed_tricks": len(room.game_state.completed_tricks),
                        "hand_sizes": {
                            s: len(h) for s, h in room.game_state.hands.items()
                        },
                    }
                    await connection_manager.send_to_all(
                        room_code,
                        {
                            "type": "debug",
                            "message": f"After play_card: {debug_info}",
                        },
                    )
                except Exception:
                    # Debug logging should never break the game flow.
                    pass

                # If that play completed the hand, compute and apply scores.
                # A hand is complete after 8 tricks (32 cards) have been played.
                if (
                    len(room.game_state.completed_tricks) == 8
                    and room.game_state.phase is not Phase.COMPLETE
                ):
                    if room.bidding_result is not None:
                        ns_delta, ew_delta = compute_team_score_deltas(
                            room.game_state, room.bidding_result
                        )
                        room.score_ns += ns_delta
                        room.score_ew += ew_delta
                        tw = room.game_state.tricks_won
                        bid_team = "E/W" if room.bidding_result.winning_player in ("E", "W") else "N/S"
                        bid_tricks = (tw.get("E", 0) + tw.get("W", 0)) if bid_team == "E/W" else (tw.get("N", 0) + tw.get("S", 0))
                        summary = (
                            f"Hand complete. Bidding team {bid_team} made {bid_tricks} tricks: "
                            f"N/S {ns_delta:+} (total {room.score_ns}), E/W {ew_delta:+} (total {room.score_ew})."
                        )
                    else:
                        summary = "Hand complete (no contract)."

                    # Move to COMPLETE so no more cards can be played.
                    room.game_state.phase = Phase.COMPLETE

                    # Extra debug logging for scoring.
                    try:
                        score_debug = {
                            "completed_tricks": len(room.game_state.completed_tricks),
                            "tricks_won": room.game_state.tricks_won,
                            "score_ns": room.score_ns,
                            "score_ew": room.score_ew,
                        }
                        await connection_manager.send_to_all(
                            room_code,
                            {
                                "type": "debug",
                                "message": f"Scoring applied: {score_debug}",
                            },
                        )
                    except Exception:
                        pass

                    await connection_manager.send_to_all(
                        room_code,
                        {
                            "type": "hand_complete",
                            "summary": summary,
                        },
                    )

                await connection_manager.broadcast_state(
                    room_code, room.game_state, room.bidding_state, room.bidding_result
                )
            elif msg_type == "special_exchange":
                if room.game_state is None or room.bidding_result is None:
                    await websocket.send_json(
                        {"type": "error", "message": "No active special contract."}
                    )
                    continue
                if (
                    room.game_state.phase is not Phase.EXCHANGE
                    or not room.bidding_result.is_special_contract
                    or room.bidding_result.winning_bid is None
                    or room.bidding_result.winning_player is None
                ):
                    await websocket.send_json(
                        {"type": "error", "message": "Not in special exchange phase."}
                    )
                    continue

                contract = room.bidding_result.winning_bid.contract  # type: ignore[union-attr]
                # Debug: log the incoming special exchange request.
                try:
                        await connection_manager.send_to_all(
                            room_code,
                            {
                                "type": "debug",
                                "message": (
                                    "special_exchange received: "
                                    f"trump={data.get('trump')}, "
                                    f"discard_indices={data.get('discard_indices')}, "
                                    f"contract={contract.name}, "
                                    f"phase={room.game_state.phase.name}"
                                ),
                            },
                        )
                except Exception:
                    pass
                declarer = room.bidding_result.winning_player
                partner_map = {"N": "S", "S": "N", "E": "W", "W": "E"}
                partner = partner_map[declarer]

                exchange_count = 0
                if contract is SpecialContract.PUT_TWO_DOWN:
                    exchange_count = 2
                elif contract is SpecialContract.PUT_ONE_DOWN:
                    exchange_count = 1
                else:
                    exchange_count = 0  # Shoot the Moon: no exchange

                trump_raw = str(data.get("trump"))
                try:
                    trump_type = TrumpType[trump_raw]
                except KeyError:
                    await websocket.send_json(
                        {"type": "error", "message": "Invalid trump for special contract."}
                    )
                    continue
                if trump_type not in {
                    TrumpType.HEARTS,
                    TrumpType.DIAMONDS,
                    TrumpType.CLUBS,
                    TrumpType.SPADES,
                }:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Special contracts currently support suit trump only.",
                        }
                    )
                    continue

                # Update bidding result with chosen trump.
                room.bidding_result.trump_type = trump_type

                # Declarer chooses which of their cards to exchange; partner cards are
                # taken from the front of their hand as a simple dev shortcut.
                discard_indices = data.get("discard_indices", [])
                if not isinstance(discard_indices, list):
                    await websocket.send_json(
                        {"type": "error", "message": "discard_indices must be a list."}
                    )
                    continue
                try:
                    discard_indices_int = [int(i) for i in discard_indices]
                except (TypeError, ValueError):
                    await websocket.send_json(
                        {"type": "error", "message": "discard_indices must be integers."}
                    )
                    continue

                if len(discard_indices_int) != exchange_count:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Must choose {exchange_count} cards to discard.",
                        }
                    )
                    continue

                if exchange_count > 0:
                    dec_hand = room.game_state.hands[declarer]
                    partner_hand = room.game_state.hands[partner]

                    # Collect declarer's chosen cards.
                    try:
                        sorted_idx = sorted(set(discard_indices_int))
                        give_from_dec = [dec_hand[i] for i in sorted_idx]
                    except IndexError:
                        await websocket.send_json(
                            {"type": "error", "message": "Invalid discard index."}
                        )
                        continue

                    # Remove chosen cards from declarer, and take first cards from partner.
                    for i in reversed(sorted_idx):
                        del dec_hand[i]
                    give_from_partner = partner_hand[:exchange_count]

                    # Declarer ends with 8 cards; partner's cards become dead.
                    room.game_state.hands[declarer] = dec_hand + give_from_partner

                # Partner sits out entirely in special \"alone\" contracts: their cards
                # are not played and are effectively removed from the hand.
                room.game_state.hands[partner] = []

                # Map chosen trump to a concrete suit and start play, marking declarer as alone.
                trump_map = {
                    TrumpType.HEARTS: Suit.HEARTS,
                    TrumpType.DIAMONDS: Suit.DIAMONDS,
                    TrumpType.CLUBS: Suit.CLUBS,
                    TrumpType.SPADES: Suit.SPADES,
                }
                trump_suit = trump_map[trump_type]
                start_play(
                    room.game_state,
                    trump=trump_suit,
                    leader=declarer,
                    alone_seat=declarer,
                )

                # Debug: log the result of the special exchange.
                try:
                    ex_debug = {
                        "phase": room.game_state.phase.name,
                        "trump_type": room.bidding_result.trump_type.name
                        if room.bidding_result and room.bidding_result.trump_type
                        else None,
                        "declarer": declarer,
                        "partner": partner,
                        "declarer_hand_size": len(room.game_state.hands[declarer]),
                        "partner_hand_size": len(room.game_state.hands[partner]),
                    }
                    await connection_manager.send_to_all(
                        room_code,
                        {
                            "type": "debug",
                            "message": f"special_exchange applied: {ex_debug}",
                        },
                    )
                except Exception:
                    pass

                await connection_manager.broadcast_state(
                    room_code, room.game_state, room.bidding_state, room.bidding_result
                )
            elif msg_type == "force_score":
                if room.game_state is None:
                    await websocket.send_json(
                        {"type": "error", "message": "No active hand."}
                    )
                    continue
                if room.bidding_result is None:
                    await websocket.send_json(
                        {"type": "error", "message": "No bidding result for this hand."}
                    )
                    continue
                # Compute and apply scores based on current state, regardless of phase.
                ns_delta, ew_delta = compute_team_score_deltas(
                    room.game_state, room.bidding_result
                )
                room.score_ns += ns_delta
                room.score_ew += ew_delta
                tw = room.game_state.tricks_won
                bid_team = "E/W" if room.bidding_result.winning_player in ("E", "W") else "N/S"
                bid_tricks = (tw.get("E", 0) + tw.get("W", 0)) if bid_team == "E/W" else (tw.get("N", 0) + tw.get("S", 0))
                summary = (
                    f"Hand complete (forced). Bidding team {bid_team} made {bid_tricks} tricks: "
                    f"N/S {ns_delta:+} (total {room.score_ns}), E/W {ew_delta:+} (total {room.score_ew})."
                )
                room.game_state.phase = Phase.COMPLETE
                await connection_manager.send_to_all(
                    room_code,
                    {
                        "type": "hand_complete",
                        "summary": summary,
                    },
                )
            else:
                # Fallback: echo unknown messages for debugging.
                await connection_manager.send_to_all(
                    room_code, {"type": "echo", "payload": data}
                )
    except WebSocketDisconnect:
        connection_manager.disconnect(room_code, websocket)

