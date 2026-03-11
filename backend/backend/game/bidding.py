from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto


class BidType(Enum):
    HIGH = auto()
    LOW = auto()


class BidLevel(Enum):
    ONE = 1
    TWO = 2
    SHOOT_MOON = 3


@dataclass(frozen=True)
class Bid:
    seat: str  # "N", "E", "S", "W"
    level: BidLevel
    bid_type: BidType

    def is_higher_than(self, other: "Bid | None") -> bool:
        if other is None:
            return True
        # Order primarily by level, then by bid_type (LOW < HIGH).
        if self.level.value != other.level.value:
            return self.level.value > other.level.value
        return self.bid_type.value > other.bid_type.value

