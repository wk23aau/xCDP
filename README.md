# Browser Perception & Control Plane

A real-time browser automation system that streams structured page state from a Chrome extension to a backend, enabling low-latency model-driven browser control.

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌─────────────────┐
│  Chrome         │ ←───────────────→  │  Backend        │ ←───────────────→  │  REPL Bridge    │
│  Extension      │     /extension     │  Server         │     /repl          │  / Your Model   │
│                 │                    │                 │                    │                 │
│  • ActionMap    │                    │  • World State  │                    │  • CLI          │
│  • Watchers     │    Telemetry →     │  • Policy       │    Commands →      │  • API          │
│  • Executor     │    ← Commands      │  • Gateway      │    ← State         │  • Integration  │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
# Install all dependencies
cd extension && npm install
cd ../backend && npm install
cd ../repl-bridge && npm install
```

### 2. Build the Extension

```bash
cd extension
npm run build
```

### 3. Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder

### 4. Start the Backend

```bash
cd backend
npm run dev
```

You should see:
```
╔══════════════════════════════════════════════════════════════╗
║     Browser Perception Backend Started                       ║
╠══════════════════════════════════════════════════════════════╣
║  WebSocket (Extension): ws://localhost:9333/extension        ║
║  WebSocket (REPL):      ws://localhost:9333/repl             ║
║  HTTP API:              http://localhost:9333                ║
╚══════════════════════════════════════════════════════════════╝
```

### 5. Use the CLI

```bash
cd repl-bridge
npm run dev
```

Example session:
```
● [no tab] > tabs
Connected Tabs:
  [123] https://example.com (45 candidates)

● [no tab] > use 123
✓ Using tab 123

● [123] > list button
Candidates (8): (filter: "button")
  button       Sign In                                  a_1f
  button       Submit                                   a_2a
  ...

● [123] > click a_1f
✓ Command cmd_1706540123456_abc1 - verify
    Visible: true, Hit OK: true
```

## Programmatic API

```typescript
import { PerceptionBridge } from './repl-bridge/src/bridge';

const bridge = new PerceptionBridge();
await bridge.connect();

// List tabs
const tabs = await bridge.listTabs();
console.log(tabs);

// Get candidates
const candidates = await bridge.query(tabId, 'search text');

// Click element
await bridge.click(tabId, 'element_id');

// Type into input
await bridge.type(tabId, 'input_id', 'Hello World');

// Convenience: click by text
await bridge.clickText(tabId, 'Sign In');

// Convenience: type into field by label
await bridge.typeInto(tabId, 'Email', 'user@example.com');
```

## HTTP API

The backend also exposes REST endpoints:

- `GET /status` - Server status and world summary
- `GET /tabs` - List connected tabs
- `GET /tabs/:id/candidates` - Get candidates for tab
- `GET /tabs/:id/search?q=text` - Search candidates
- `POST /command` - Execute command
- `GET /policy` - Get current policy
- `POST /policy` - Update policy

## DevTools Panel

Open Chrome DevTools on any page with the extension loaded and look for the "ActionMap" panel. It shows:

- All interactive candidates with their IDs
- Filter by text or role
- Execute commands directly
- View command logs

## Policy Configuration

The backend includes a safety layer:

```typescript
// Update via HTTP
POST /policy
{
  "domainMode": "allowlist",
  "domainList": ["example.com", "myapp.com"],
  "blockPaymentActions": true,
  "blockDeleteActions": true,
  "maxCommandsPerSecond": 10,
  "maxCommandsPerMinute": 300
}
```

## Data Model

### ActionCandidate

Each interactive element is represented as:

```json
{
  "id": "a_1f",
  "rect": { "x": 412, "y": 188, "w": 126, "h": 36 },
  "rectN": { "x": 0.38, "y": 0.17, "w": 0.11, "h": 0.03 },
  "role": "button",
  "tag": "button",
  "name": "Sign in",
  "aria": "Sign in",
  "state": { "disabled": false, "expanded": false, "checked": false },
  "ctx": { "inModal": false, "inNav": true, "depth": 8 },
  "styleHint": { "isPrimary": true, "isDanger": false, "cursorPointer": true },
  "hit": { "cx": 475, "cy": 206 },
  "occluded": false
}
```

### Commands

Available command types:
- `click` - Click element
- `type` - Type text into element
- `hover` - Hover over element
- `scroll` - Scroll page or element
- `focus` - Focus element
- `select` - Select option in dropdown
- `move_mouse` - Move cursor (with trajectory)
- `query` - Search for elements

## Project Structure

```
CDP-REPL/
├── extension/               # Chrome MV3 Extension
│   ├── manifest.json
│   ├── src/
│   │   ├── content/         # ActionMap, watchers, executor
│   │   ├── background/      # Service worker, transport
│   │   └── shared/          # Protocol types
│   ├── devtools/            # DevTools panel
│   └── scripts/             # Build scripts
│
├── backend/                 # Node.js Backend
│   ├── src/
│   │   ├── server.ts        # Fastify + WebSocket server
│   │   ├── world-state.ts   # In-memory state store
│   │   ├── policy.ts        # Safety layer
│   │   └── protocol.ts      # Type definitions
│   └── package.json
│
└── repl-bridge/             # REPL Bridge
    ├── src/
    │   ├── bridge.ts        # WebSocket client + API
    │   └── cli.ts           # Interactive CLI
    └── package.json
```

## License

MIT
