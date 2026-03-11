from __future__ import annotations

import random
from typing import Dict, List

from .bidding import Bid, BidLevel, BidType
from .cards import Card, Suit, double_euchre_deck_without_9s_10s, trick_winner, card_is_trump
from .scoring import score_for_all_tricks
from .state import GameState, Phase, SEATS, Player, Trick


def deal_new_hand(player_names: Dict[str, str], dealer: str) -> GameState:
    if set(player_names.keys()) != set(SEATS):
        raise ValueError("player_names must contain N, E, S, W")

    deck = double_euchre_deck_without_9s_10s()
    random.shuffle(deck)

    hands: Dict[str, List[Card]] = {seat: [] for seat in SEATS}
    # 8 cards to each of 4 players -> 32 cards
    for i, card in enumerate(deck):
        seat = SEATS[i % 4]
        hands[seat].append(card)

    players = {seat: Player(seat=seat, name=name) for seat, name in player_names.items()}
    tricks_won = {seat: 0 for seat in SEATS}

    # Bidding starts with the player to the left of the dealer.
    first_bidder_index = (SEATS.index(dealer) + 1) % 4
    first_bidder = SEATS[first_bidder_index]

    return GameState(
        players=players,
        hands=hands,
        dealer=dealer,
        phase=Phase.BIDDING,
        current_turn=first_bidder,
        tricks_won=tricks_won,
    )


def apply_bid(state: GameState, bid: Bid) -> None:
    """Apply a bid from the current player and advance turn."""
    if state.phase is not Phase.BIDDING:
        raise ValueError("Not in bidding phase")
    if state.current_turn is None:
        raise ValueError("No current bidder")
    if bid.seat != state.current_turn:
        raise ValueError("It is not this seat's turn to bid")
    if not bid.is_higher_than(state.current_bid):
        raise ValueError("Bid must be higher than current bid")
    state.current_bid = bid
    # Advance to next seat in order.
    next_index = (SEATS.index(bid.seat) + 1) % 4
    state.current_turn = SEATS[next_index]


def start_play(
    state: GameState,
    trump: Suit,
    leader: str,
    alone_seat: str | None = None,
) -> None:
    """Begin the playing phase for a completed contract.

    The leader is the winning bidder's seat.
    """
    state.trump = trump
    state.alone_seat = alone_seat
    state.current_trick = Trick(leader=leader)
    state.phase = Phase.PLAYING


def play_card(state: GameState, seat: str, card: Card) -> None:
    if state.phase is not Phase.PLAYING or state.current_trick is None:
        raise ValueError("Not in trick-playing phase")

    hand = state.hands[seat]
    if card not in hand:
        raise ValueError("Card not in hand")

    # Enforce following suit where possible, treating left/right bowers as trump.
    # The first card of the trick establishes the led "logical" suit:
    # - If it is trump (including bowers), the led suit is trump.
    # - Otherwise, it is that card's printed suit.
    if state.current_trick.plays and state.trump is not None:
        first_card = state.current_trick.plays[0][1]

        def logical_suit(c: Card) -> Suit:
            return state.trump if card_is_trump(c, state.trump) else c.suit

        led_suit = logical_suit(first_card)
        if logical_suit(card) is not led_suit:
            if any(logical_suit(c) is led_suit for c in hand):
                raise ValueError("Must follow suit if able")

    hand.remove(card)
    state.current_trick.plays.append((seat, card))

    # If trick complete, determine winner and start next trick or scoring.
    # In an "alone" contract, the declarer's partner sits out, so each trick
    # only has 3 cards instead of 4.
    expected_plays = 4
    if state.alone_seat is not None:
        partner_map = {"N": "S", "S": "N", "E": "W", "W": "E"}
        partner = partner_map[state.alone_seat]
        # When the partner has no cards (sitting out), we expect 3 plays.
        if not state.hands.get(partner):
            expected_plays = 3

    if len(state.current_trick.plays) == expected_plays:
        assert state.trump is not None
        # Determine logical led suit for winner calculation (same rules as above).
        first_card = state.current_trick.plays[0][1]

        def logical_suit(c: Card) -> Suit:
            return state.trump if card_is_trump(c, state.trump) else c.suit

        led_suit = logical_suit(first_card)
        _, cards = zip(*state.current_trick.plays)
        winner_index = trick_winner(cards, trump=state.trump, led_suit=led_suit)
        winner_seat = state.current_trick.plays[winner_index][0]

        state.completed_tricks.append(state.current_trick)
        state.tricks_won[winner_seat] += 1

        # If all cards are played, move to scoring.
        if all(not h for h in state.hands.values()):
            state.phase = Phase.SCORING
            state.current_trick = None
        else:
            state.current_trick = Trick(leader=winner_seat)


def compute_score_delta(state: GameState) -> int:
    """Compute score delta for the declaring side based on tricks won."""
    if state.current_bid is None:
        raise ValueError("No contract to score")
    total_tricks = len(state.completed_tricks)
    bidder_seat = state.current_bid.seat
    # Partnership: N/S vs E/W.
    ns = {"N", "S"}
    ew = {"E", "W"}

    if bidder_seat in ns:
        declaring = ns
    else:
        declaring = ew

    tricks_won = sum(state.tricks_won[s] for s in declaring)
    success = tricks_won == total_tricks
    return score_for_all_tricks(state.current_bid.level, success)


__all__ = [
    "deal_new_hand",
    "start_play",
    "play_card",
    "compute_score_delta",
    "Bid",
    "BidLevel",
    "BidType",
    "Suit",
    "Card",
    "GameState",
    "Phase",
]

