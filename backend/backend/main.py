from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import rooms, ws


def create_app() -> FastAPI:
    app = FastAPI(title="Bid Euchre")

    # Allow browser clients (local dev + deployed frontend) to call the API.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(rooms.router, prefix="/rooms", tags=["rooms"])
    app.include_router(ws.router, tags=["ws"])

    return app


app = create_app()

