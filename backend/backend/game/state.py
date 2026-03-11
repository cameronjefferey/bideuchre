from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Dict, List, Optional, Tuple

from .bidding import Bid
from .cards import Card, Suit


class Phase(Enum):
    DEALING = auto()
    BIDDING = auto()
    EXCHANGE = auto()
    PLAYING = auto()
    SCORING = auto()
    COMPLETE = auto()


SEATS: Tuple[str, str, str, str] = ("N", "E", "S", "W")


@dataclass
class Player:
    seat: str
    name: str


@dataclass
class Trick:
    leader: str
    plays: List[Tuple[str, Card]] = field(default_factory=list)

    @property
    def led_suit(self) -> Optional[Suit]:
        if not self.plays:
            return None
        return self.plays[0][1].suit


@dataclass
class GameState:
    players: Dict[str, Player]
    hands: Dict[str, List[Card]]
    dealer: str
    phase: Phase
    current_bid: Optional[Bid] = None
    current_turn: Optional[str] = None
    trump: Optional[Suit] = None
    alone_seat: Optional[str] = None
    current_trick: Optional[Trick] = None
    completed_tricks: List[Trick] = field(default_factory=list)
    tricks_won: Dict[str, int] = field(default_factory=dict)

