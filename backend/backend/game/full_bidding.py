from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Dict, List, Optional, Tuple


SEATS: Tuple[str, str, str, str] = ("N", "E", "S", "W")


class TrumpType(Enum):
    HEARTS = auto()
    DIAMONDS = auto()
    CLUBS = auto()
    SPADES = auto()
    HIGH = auto()
    LOW = auto()


class SpecialContract(Enum):
    PUT_TWO_DOWN = auto()
    PUT_ONE_DOWN = auto()
    SHOOT_MOON = auto()


@dataclass(frozen=True)
class StandardBid:
    """A numbered bid with an explicit trump type."""

    level: int  # 1–8 inclusive
    trump: TrumpType


@dataclass(frozen=True)
class SpecialBid:
    """A special contract (no trump chosen yet)."""

    contract: SpecialContract


Bid = StandardBid | SpecialBid


class ActionType(Enum):
    BID = auto()
    PASS = auto()


@dataclass(frozen=True)
class PlayerAction:
    """A single player's decision on their turn."""

    seat: str  # "N", "E", "S", "W"
    kind: ActionType
    bid: Optional[Bid] = None  # required when kind is BID


@dataclass
class PlayerBidRecord:
    """Record of what each player did during bidding."""

    seat: str
    action: ActionType
    bid: Optional[Bid] = None


@dataclass
class BiddingState:
    dealer: str
    turn_order: List[str]
    current_index: int = 0
    highest_bid: Optional[Bid] = None
    highest_bidder: Optional[str] = None
    history: List[PlayerBidRecord] = field(default_factory=list)
    done: bool = False


@dataclass
class BiddingResult:
    winning_player: Optional[str]
    winning_bid: Optional[Bid]
    numeric_level: Optional[int]
    trump_type: Optional[TrumpType]
    is_special_contract: bool
    requires_trump_selection: bool
    history: List[PlayerBidRecord]


def _seat_index(seat: str) -> int:
    try:
        return SEATS.index(seat)
    except ValueError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Invalid seat: {seat!r}") from exc


def bidding_turn_order(dealer: str) -> List[str]:
    """Return the fixed bidding order starting left of dealer, ending with dealer."""
    dealer_idx = _seat_index(dealer)
    # Left of dealer, then next, then next, then dealer last.
    return [
        SEATS[(dealer_idx + 1) % 4],
        SEATS[(dealer_idx + 2) % 4],
        SEATS[(dealer_idx + 3) % 4],
        dealer,
    ]


def start_bidding(dealer: str) -> BiddingState:
    """Create initial bidding state for a hand with the given dealer."""
    order = bidding_turn_order(dealer)
    return BiddingState(dealer=dealer, turn_order=order)


def _bid_rank(bid: Bid) -> int:
    """Return the rank of a bid according to the hierarchy.

    1–8  -> 1–8
    Put Two Down  -> 9
    Put One Down  -> 10
    Shoot the Moon -> 11
    """
    if isinstance(bid, StandardBid):
        if not 1 <= bid.level <= 8:
            raise ValueError("Standard bid level must be between 1 and 8.")
        return bid.level

    # Special contracts
    mapping = {
        SpecialContract.PUT_TWO_DOWN: 9,
        SpecialContract.PUT_ONE_DOWN: 10,
        SpecialContract.SHOOT_MOON: 11,
    }
    return mapping[bid.contract]


def _is_special(bid: Bid) -> bool:
    return isinstance(bid, SpecialBid)


def _validate_action_for_turn(state: BiddingState, action: PlayerAction) -> None:
    if state.done:
        raise ValueError("Bidding is already complete.")

    expected_seat = state.turn_order[state.current_index]
    if action.seat != expected_seat:
        raise ValueError(f"It is {expected_seat}'s turn to act, not {action.seat}.")

    if action.kind is ActionType.BID and action.bid is None:
        raise ValueError("BID action must include a bid.")
    if action.kind is ActionType.PASS and action.bid is not None:
        raise ValueError("PASS action must not include a bid.")


def _validate_bid_against_current(
    state: BiddingState,
    seat: str,
    bid: Bid,
) -> None:
    """Enforce hierarchy and dealer matching rules."""
    current = state.highest_bid
    if current is None:
        # Any legal bid is fine as opening bid.
        return

    new_rank = _bid_rank(bid)
    current_rank = _bid_rank(current)

    if _is_special(current) and _is_special(bid) and new_rank == current_rank:
        # Matching a special contract is only allowed for the dealer.
        if seat != state.dealer:
            raise ValueError(
                "Only the dealer may match an existing special bid at the same level."
            )
        # Dealer matching the same special contract is allowed.
        return

    if new_rank <= current_rank:
        raise ValueError("New bid must be higher in the bid hierarchy than current bid.")


def apply_action(state: BiddingState, action: PlayerAction) -> None:
    """Apply a player's action and advance the bidding state.

    Raises ValueError on any rule violation.
    """
    _validate_action_for_turn(state, action)

    if action.kind is ActionType.BID:
        assert action.bid is not None  # for type checkers
        _validate_bid_against_current(state, action.seat, action.bid)

        state.highest_bid = action.bid
        state.highest_bidder = action.seat
        state.history.append(
            PlayerBidRecord(seat=action.seat, action=ActionType.BID, bid=action.bid)
        )
    else:
        # PASS
        state.history.append(
            PlayerBidRecord(seat=action.seat, action=ActionType.PASS, bid=None)
        )

    # Advance turn or mark bidding as complete.
    if state.current_index == len(state.turn_order) - 1:
        # Dealer has just acted; bidding is done.
        state.done = True
    else:
        state.current_index += 1


def finalise_bidding(state: BiddingState) -> BiddingResult:
    """Produce the final bidding result after all four players have acted."""
    if not state.done:
        raise ValueError("Bidding is not yet complete.")

    winning_player = state.highest_bidder
    winning_bid = state.highest_bid

    if winning_player is None or winning_bid is None:
        # All players passed – this situation can be handled by the caller.
        return BiddingResult(
            winning_player=None,
            winning_bid=None,
            numeric_level=None,
            trump_type=None,
            is_special_contract=False,
            requires_trump_selection=False,
            history=list(state.history),
        )

    if isinstance(winning_bid, StandardBid):
        return BiddingResult(
            winning_player=winning_player,
            winning_bid=winning_bid,
            numeric_level=winning_bid.level,
            trump_type=winning_bid.trump,
            is_special_contract=False,
            requires_trump_selection=False,
            history=list(state.history),
        )

    # Special contract: no trump chosen yet, declarer must select later.
    return BiddingResult(
        winning_player=winning_player,
        winning_bid=winning_bid,
        numeric_level=None,
        trump_type=None,
        is_special_contract=True,
        requires_trump_selection=True,
        history=list(state.history),
    )


__all__ = [
    "SEATS",
    "TrumpType",
    "SpecialContract",
    "StandardBid",
    "SpecialBid",
    "Bid",
    "ActionType",
    "PlayerAction",
    "PlayerBidRecord",
    "BiddingState",
    "BiddingResult",
    "bidding_turn_order",
    "start_bidding",
    "apply_action",
    "finalise_bidding",
]

