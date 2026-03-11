from __future__ import annotations

from .bidding import BidLevel


def score_for_all_tricks(level: BidLevel, success: bool) -> int:
    """Return score delta for a contract where all tricks are required.

    Rules (per provided description):
    - Level TWO: +12 for getting all tricks, -12 otherwise.
    - Level ONE: +18 for getting all tricks, -18 otherwise.
    - SHOOT_MOON: +24 for getting all tricks, -24 otherwise.
    """
    if level is BidLevel.TWO:
        return 12 if success else -12
    if level is BidLevel.ONE:
        return 18 if success else -18
    if level is BidLevel.SHOOT_MOON:
        return 24 if success else -24
    raise ValueError(f"Unsupported bid level: {level}")

