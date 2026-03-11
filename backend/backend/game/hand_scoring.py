from __future__ import annotations

from typing import Tuple

from .state import GameState
from .full_bidding import (
    BiddingResult,
    StandardBid,
    SpecialBid,
    SpecialContract,
)


NS_SEATS = {"N", "S"}
EW_SEATS = {"E", "W"}


def compute_team_score_deltas(
    state: GameState,
    bidding_result: BiddingResult,
) -> Tuple[int, int]:
    """Return (ns_delta, ew_delta) for a completed hand.

    Scoring rules (from user spec):
    - Partnerships: N/S vs E/W.
    - Number bids 1–8:
      - If declarer side wins X tricks (X >= bid level), they get X points.
      - The other side gets the number of tricks they win.
      - In all cases for 1–8 contracts, the total points for the hand is 8.
    - Special contracts (Put Two Down, Put One Down, Shoot the Moon):
      - Declarer must take all 8 tricks to succeed.
      - If success:
        - Declarer side gets +12 / +18 / +24 (depending on contract).
        - Defenders get 0.
      - If failure:
        - Declarer side gets -12 / -18 / -24.
        - Defenders get the number of tricks they won.
    """
    tricks = state.tricks_won
    ns_tricks = tricks.get("N", 0) + tricks.get("S", 0)
    ew_tricks = tricks.get("E", 0) + tricks.get("W", 0)

    if bidding_result.winning_player is None or bidding_result.winning_bid is None:
        # All passed: just award trick points.
        return ns_tricks, ew_tricks

    declarer_seat = bidding_result.winning_player
    declarer_ns = declarer_seat in NS_SEATS

    if isinstance(bidding_result.winning_bid, StandardBid):
        # Numbered contract:
        # - If declarer makes the bid, they get the number of tricks they won.
        # - If they miss, they lose their bid level in points (negative),
        #   and defenders still get the number of tricks they won.
        bid_level = bidding_result.winning_bid.level
        dec_tricks = ns_tricks if declarer_ns else ew_tricks
        def_tricks = ew_tricks if declarer_ns else ns_tricks
        if dec_tricks >= bid_level:
            dec_points = dec_tricks
            def_points = def_tricks
        else:
            dec_points = -bid_level  # did not make bid: lose your bid
            def_points = def_tricks
    else:
        # Special contract.
        contract = bidding_result.winning_bid.contract
        if contract is SpecialContract.PUT_TWO_DOWN:
            base = 12
        elif contract is SpecialContract.PUT_ONE_DOWN:
            base = 18
        elif contract is SpecialContract.SHOOT_MOON:
            base = 24
        else:  # pragma: no cover - defensive
            base = 0

        dec_tricks = ns_tricks if declarer_ns else ew_tricks
        def_tricks = ew_tricks if declarer_ns else ns_tricks
        success = dec_tricks == 8

        if success:
            dec_points = base
            def_points = 0
        else:
            dec_points = -base
            def_points = def_tricks

    if declarer_ns:
        ns_delta = dec_points
        ew_delta = def_points
    else:
        ns_delta = def_points
        ew_delta = dec_points

    return ns_delta, ew_delta


__all__ = ["compute_team_score_deltas"]

