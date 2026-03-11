# bideuchre
4-player Bid Euchre game with a Python FastAPI backend and a TypeScript browser frontend.

## Getting started

### Backend (API + WebSocket)

From the `backend` directory:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # on Windows: .venv\\Scripts\\activate
pip install -r requirements.txt

uvicorn backend.main:app --reload --port 8000
```

The backend will be available at `http://localhost:8000` and exposes:

- `POST /rooms` – create a room (returns `room_code`)
- `POST /rooms/{room_code}/join` – join a room by code
- `GET /rooms/{room_code}` – get basic room info
- `GET /ws/{room_code}` – WebSocket endpoint for realtime updates

### Frontend (web client)

From the `frontend` directory:

```bash
cd frontend
npm install
npm run dev
```

Then open the URL printed by Vite (typically `http://localhost:5173`) in your browser.

### Basic flow

1. Start the backend (`uvicorn backend.main:app --reload --port 8000`).
2. Start the frontend dev server (`npm run dev` inside `frontend`).
3. In the browser, enter your name and:
   - Click **Create room** to get a new room code.
   - Share that code and have friends **Join room** with the same code.
4. Everyone will see the lobby with the four seats and a simple activity log.

The core game engine (deck, bidding, tricks, scoring) lives under `backend/backend/game/` and will be wired into the WebSocket flow as the next step in development.
