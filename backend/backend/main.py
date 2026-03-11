from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import rooms, ws


def create_app() -> FastAPI:
    app = FastAPI(title="Bid Euchre")

    # Allow the Vite dev server to call the API from the browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(rooms.router, prefix="/rooms", tags=["rooms"])
    app.include_router(ws.router, tags=["ws"])

    return app


app = create_app()

