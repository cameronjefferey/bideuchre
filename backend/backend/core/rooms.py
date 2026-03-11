from __future__ import annotations

import secrets
import string
from dataclasses import dataclass, field
from typing import Dict, Optional

from ..game.state import GameState
from ..game.full_bidding import BiddingState, BiddingResult


SEATS = ("N", "E", "S", "W")


def _generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


@dataclass
class PlayerInfo:
    name: str


@dataclass
class Room:
    code: str
    players: Dict[str, PlayerInfo] = field(default_factory=dict)  # seat -> info
    game_state: Optional[GameState] = None
    bidding_state: Optional[BiddingState] = None
    bidding_result: Optional[BiddingResult] = None
    score_ns: int = 0
    score_ew: int = 0
    hand_number: int = 0  # 1–8 in a full game

    def join(self, name: str, preferred_seat: Optional[str] = None) -> str:
        seats = list(SEATS)
        if preferred_seat is not None and preferred_seat in seats and preferred_seat not in self.players:
            seat = preferred_seat
        else:
            try:
                seat = next(s for s in seats if s not in self.players)
            except StopIteration as exc:
                raise ValueError("Room is full") from exc

        self.players[seat] = PlayerInfo(name=name)
        return seat

    def to_public_dict(self) -> dict:
        return {
            "code": self.code,
            "seats": {seat: info.name for seat, info in self.players.items()},
        }


class RoomManager:
    def __init__(self) -> None:
        self._rooms: Dict[str, Room] = {}

    def create_room(self) -> Room:
        while True:
            code = _generate_room_code()
            if code not in self._rooms:
                break
        room = Room(code=code)
        self._rooms[code] = room
        return room

    def get_room(self, code: str) -> Optional[Room]:
        return self._rooms.get(code)


room_manager = RoomManager()

