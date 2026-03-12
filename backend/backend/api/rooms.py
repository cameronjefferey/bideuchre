from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.rooms import room_manager
from .ws import connection_manager


router = APIRouter()


class CreateRoomResponse(BaseModel):
    room_code: str


class JoinRoomRequest(BaseModel):
    name: str
    seat: str | None = None


class JoinRoomResponse(BaseModel):
    room_code: str
    seat: str


@router.post("/", response_model=CreateRoomResponse)
def create_room() -> CreateRoomResponse:
    room = room_manager.create_room()
    return CreateRoomResponse(room_code=room.code)


@router.post("/{room_code}/join", response_model=JoinRoomResponse)
async def join_room(room_code: str, body: JoinRoomRequest) -> JoinRoomResponse:
    room = room_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    seat = room.join(body.name, preferred_seat=body.seat)
    # Tell any connected clients that the seat map changed.
    await connection_manager.broadcast_room_update(room_code)
    return JoinRoomResponse(room_code=room.code, seat=seat)


@router.get("/{room_code}")
def get_room(room_code: str):
    room = room_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room.to_public_dict()


@router.post("/{room_code}/dev-fill")
def dev_fill_room(room_code: str):
    """Development helper: fill all empty seats with dummy players.

    This is not meant for production use, but makes it easy to test with
    a full table from a single browser during development.
    """
    room = room_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    dummy_names = {
        "N": "NorthBot",
        "E": "EastBot",
        "S": "SouthBot",
        "W": "WestBot",
    }
    for seat, name in dummy_names.items():
        if seat not in room.players:
            room.join(name, preferred_seat=seat)

    return room.to_public_dict()

