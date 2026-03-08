# StudyNHelp — AI Tutoring Assistant

A floating, paste-and-run AI tutoring assistant that helps you work through assignments step-by-step. Paste the bundled assistant.js into your browser console on any assignment page to open a movable, resizable tutor panel.

## What This Does
- ✅ Chat with a tutor that gives hints first, asks questions, and only reveals final answers when you ask
- ✅ Analyze highlighted/pasted questions into problem type, concepts, strategy, steps, and hints
- ✅ Built-in TI‑84 style calculator and lightweight graphing engine (pan/zoom)
- ✅ Page scanner that detects likely question blocks and highlights them
- ✅ Privacy-first: no student data stored by default; backend uses OpenAI when a key is provided

## Screenshots / Preview
The assistant injects a floating dark panel into the current page with tabs for Chat, Analyzer, Calculator, Graphing, and Scanner. It sits on the right side by default and can be dragged anywhere.

## Requirements
- Backend: Python 3.11+, FastAPI 0.110+, Uvicorn 0.27+
- Frontend: Node.js 18+ (https://nodejs.org) for building the bundle using esbuild
- Docker (optional) for containerized deployment
- OpenAI API key (optional for dev; required for real AI): https://platform.openai.com/

## Setup — Step by Step
Step 1: Open your terminal (Command Prompt on Windows, Terminal on Mac)
Step 2: Clone or open this folder
Step 3: Install backend dependencies
  pip install -r requirements.txt
  You should see packages install without errors.
Step 4: Install frontend tools
  cd frontend && npm install && cd -
  You should see "added XXX packages" when it's done.
Step 5: Create your environment file
  cp .env.example .env
Step 6: Start backend locally
  uvicorn backend.main:app --host 0.0.0.0 --port 8080
  You should see: "Uvicorn running on http://0.0.0.0:8080"
Step 7: Build frontend bundle
  cd frontend && npm run build && cd -
  You should see assistant.js in frontend/.
Step 8: Use the assistant in your browser
  Open DevTools Console on your assignment page and run:
    (async()=>{const s=document.createElement('script');s.src='http://localhost:8080/assistant.js';document.head.appendChild(s);setTimeout(()=>window.StudyNHelpBootstrap&&window.StudyNHelpBootstrap(),600);})();
  Or copy the contents of frontend/assistant.js and paste into the console, then run StudyNHelpBootstrap().

## Configuration
Create a .env file in the project root (do not commit real keys):
OPENAI_API_KEY= YOUR_API_KEY_HERE  # Get this from https://platform.openai.com/
OPENAI_MODEL=gpt-5-mini-2025-08-07  # Default primary model
SEARCH_MODEL=gpt-4o-mini-search-preview-2025-03-11  # Optional search model
AI_SEARCH_ENABLED=false  # set true to enable search augmentation
PORT=8080

## How to Run
- Backend: `uvicorn backend.main:app --host 0.0.0.0 --port 8080`
- Frontend: `cd frontend && npm run build` then use frontend/assistant.js in your browser console
You should see: Tutor UI appears with tabs, and Chat works (mock mode without OPENAI_API_KEY).

## How to Use
- Chat: Type your question. Use toolbar for Next Step / Explain More / Show Hints / Reveal Answer.
- Analyzer: Highlight text on the page, click Capture, then Analyze.
- Calculator: Enter expressions and press =. Use functions like sin(), cos(), tan(), sqrt(), log(), ln().
- Graphing: Enter functions like `y=x^2; y=sin(x)` and click Plot. Pan with mouse, scroll to zoom.
- Scanner: Click Scan Page to detect likely question blocks. Hover to preview highlight; click to lock.

## Project Structure
studynhelp/
├── backend/
│   ├── main.py            # FastAPI app, endpoints, rate limits, body size guard
│   ├── ai_engine.py       # OpenAI orchestration with mock fallback and search
│   ├── calculator_engine.py # TI‑84 style safe calculator engine
│   └── tests/             # Unit + integration tests
├── frontend/
│   ├── src/               # Modular dev source (vanilla ES modules)
│   │   ├── core/          # DOM, networking, state
│   │   └── ui/            # Panel, Chat, Analyzer, Calculator, Graph, Scanner
│   ├── package.json       # esbuild bundling to assistant.js
│   └── assistant.js       # Built file (created by `npm run build`)
├── Dockerfile             # Container for Railway or any Docker host
├── railway.json           # Railway settings
├── requirements.txt       # Python dependencies
├── Makefile               # Helper commands
├── .env.example           # Template for env vars (no real keys)
└── README.md              # This file

## Troubleshooting
- If you see ModuleNotFoundError: run `pip install -r requirements.txt` again
- If port 8080 is busy: set a different PORT when launching uvicorn
- If assistant.js doesn’t load: run `cd frontend && npm run build` and ensure you paste the latest
- Network errors in Chat: check backend server is running and CORS is allowed
- On older pages, scanning may mis-detect; use Analyzer manual paste as fallback

## License
MIT — Free to use.
