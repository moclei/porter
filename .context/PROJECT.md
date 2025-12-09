# Porter

> A TypeScript messaging library for Web Extensions that abstracts the complexity of cross-context communication using persistent port connections.

## Quick Reference

| Property | Value |
|----------|-------|
| **Package Name** | `porter-source` |
| **Version** | 1.1.21 |
| **Repository** | [github.com/moclei/porter](https://github.com/moclei/porter) |
| **npm** | [npmjs.com/package/porter-source](https://www.npmjs.com/package/porter-source) |
| **Author** | Marc O'Cleirigh (`moclei` on GitHub, `mocleye` on npm) |
| **License** | ISC |
| **Primary Target** | Chrome (MV3), with theoretical Firefox/Safari/Edge support |

---

## What is Porter?

Porter is a messaging library that provides a robust communication layer between different parts of a Web Extension:

- **Service Worker** (background script in MV3)
- **Content Scripts** (injected into web pages)
- **Popups** (extension popup UI)
- **Sidepanels** (Chrome side panel API)
- **Devtools** (developer tools panels)
- **Options pages**

### The Problem Porter Solves

The Web Extensions API provides low-level messaging primitives (`runtime.sendMessage`, `runtime.connect`), but building reliable communication on top of them is challenging:

1. **MV3 Service Worker Lifecycle** — Service workers can shut down at any moment without notice. Messages sent to a dead service worker are lost.
2. **Connection Tracking** — There's no built-in way to know which contexts are currently connected.
3. **Message Targeting** — Native APIs don't provide easy targeting of specific tabs, frames, or context types.
4. **Context Identification** — Messages don't automatically include rich metadata about their source.

### Porter's Solution

Porter uses persistent port connections (`runtime.connect`) and provides:

- **Automatic Reconnection** — Agents detect when the service worker dies and reconnect automatically
- **Message Queuing** — Messages sent during disconnection are queued and delivered after reconnection
- **Connection Registry** — The service worker maintains a live registry of all connected agents
- **Rich Context Info** — Every message includes the sender's context type, tab ID, and frame ID
- **Flexible Targeting** — Send messages to specific agents, contexts, tabs, or broadcast to all

---

## Architecture

Porter follows a **hub-and-spoke pattern** where the service worker acts as the central hub.

```
┌─────────────────────────────────────────────────────────────┐
│                     Service Worker                          │
│                      (PorterSource)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │AgentManager │  │ConnectionMgr │  │ MessageHandler  │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │                 │                    │
    Port │            Port │               Port │
         │                 │                    │
         ▼                 ▼                    ▼
   ┌──────────┐      ┌──────────┐        ┌──────────┐
   │  Popup   │      │ Content  │        │Sidepanel │
   │ (Agent)  │      │ Script   │        │ (Agent)  │
   │          │      │ (Agent)  │        │          │
   └──────────┘      └──────────┘        └──────────┘
```

### Core Components

#### Source Side (Service Worker)

| Component | Purpose |
|-----------|---------|
| `PorterSource` | Main entry point. Singleton per namespace. Orchestrates all managers. |
| `AgentManager` | Tracks all connected agents. Maintains agent info (ID, location, timestamps). Emits lifecycle events. |
| `ConnectionManager` | Handles incoming port connections. Validates namespace. Performs handshake protocol. |
| `MessageHandler` | Routes incoming messages to registered handlers. Handles message targeting and broadcasting. |

#### Agent Side (Content Scripts, Popups, etc.)

| Component | Purpose |
|-----------|---------|
| `PorterAgent` | Main entry point for clients. Singleton per namespace. |
| `AgentConnectionManager` | Manages the port connection to the service worker. Handles reconnection attempts. |
| `AgentMessageHandler` | Routes messages to registered handlers. Queues messages before handlers are set. |
| `MessageQueue` | Stores messages during disconnection for later delivery. |

---

## Public API

### `source(namespace?, options?)` — Service Worker

```typescript
import { source } from 'porter-source';

const { post, onMessage, on, onConnect, onDisconnect, queryAgents } = source('my-extension', { debug: true });
```

| Method | Description |
|--------|-------------|
| `post(message, target?)` | Send a message. Target can be a location, context, agent ID, or tab ID. |
| `onMessage(config)` | Register message handlers. Returns unsubscribe function. |
| `on(config)` | Alias for `onMessage`. |
| `onConnect(callback)` | Called when an agent connects. |
| `onDisconnect(callback)` | Called when an agent disconnects. |
| `queryAgents(location)` | Find agents matching partial location criteria. |

### `connect(options?)` — Agents

```typescript
import { connect } from 'porter-source';

const { post, onMessage, on, getAgentInfo, onDisconnect, onReconnect } = connect({ namespace: 'my-extension', debug: true });
```

| Method | Description |
|--------|-------------|
| `post(message, target?)` | Send a message to the service worker (or relay to another agent). |
| `onMessage(config)` | Register message handlers (replaces previous handlers). |
| `on(config)` | Add message handlers (accumulates with previous). |
| `getAgentInfo()` | Get this agent's info (ID, location). |
| `onDisconnect(callback)` | Register callback for when connection is lost. Returns unsubscribe function. |
| `onReconnect(callback)` | Register callback for when reconnection succeeds. Returns unsubscribe function. |

### `usePorter(options?)` — React Hook

```typescript
import { usePorter } from 'porter-source/react';

const { post, on, isConnected, isReconnecting, error, agentInfo } = usePorter({
  namespace: 'my-extension',
  onDisconnect: () => console.log('Connection lost'),
  onReconnect: (info) => console.log('Reconnected', info),
});
```

| Return Value | Description |
|--------------|-------------|
| `post` | Function to send messages |
| `on` | Function to register message handlers |
| `isConnected` | `true` when connected to service worker |
| `isReconnecting` | `true` when disconnected and attempting to reconnect |
| `error` | Any connection or message error |
| `agentInfo` | This agent's info (ID, location) |

---

## Message Format

All messages follow this structure:

```typescript
type Message<K> = {
  action: K;           // The message type/action name
  payload?: any;       // Optional data payload
  target?: MessageTarget; // Optional routing target
};
```

### Message Targeting

```typescript
// Target types
type MessageTarget =
  | BrowserLocation   // { context, tabId, frameId }
  | PorterContext     // 'contentscript' | 'popup' | 'sidepanel' | etc.
  | string            // Agent ID
  | number;           // Tab ID (all frames)
```

---

## Connection Lifecycle

1. **Agent calls `connect()`** → Creates port with namespace-prefixed name
2. **Agent sends `porter-init`** → Includes connection ID
3. **Source validates namespace** → Adds agent to registry
4. **Source sends `porter-handshake`** → Includes agent info and current connections
5. **Agent stores its info** → Connection established
6. **Agent sends `porter-messages-established`** → After setting message handlers
7. **On disconnect** → Agent detects, starts reconnection attempts, queues messages

---

## Known Issues & TODOs

### Namespace Confusion
The namespace concept (for partitioning message channels) has caused user confusion. May need to be simplified or made opaque to consumers.

---

## Projects Using Porter

| Project | Relationship |
|---------|--------------|
| [Crann](https://github.com/moclei/crann) | State synchronization library built on Porter (same author) |
| Lensor | Extension that uses Crann, thus Porter indirectly |

---

## Development

### Build Commands

```bash
npm run build          # Full build (types + JS)
npm run build:watch    # Watch mode
npm run test           # Run Jest tests
npm run dev            # Watch + test extension
```

### Release Process

Releases are automated via GitHub Actions (`.github/workflows/release.yml`):

1. Push to `main` or manually trigger workflow
2. Version is bumped (patch by default)
3. Changes pushed with tag
4. GitHub Release created with auto-generated notes
5. Package published to npm

---

## File Structure Overview

```
porter/
├── src/
│   ├── index.ts              # Main exports
│   ├── core/
│   │   ├── PorterSource.ts   # Service worker entry
│   │   └── PorterAgent.ts    # Agent entry
│   ├── managers/
│   │   ├── AgentManager.ts
│   │   ├── ConnectionManager.ts
│   │   ├── MessageHandler.ts
│   │   ├── AgentConnectionManager.ts
│   │   ├── AgentMessageHandler.ts
│   │   └── MessageQueue.ts
│   ├── porter.model.ts       # Types and interfaces
│   ├── porter.utils.ts       # Logger and helpers
│   └── react/
│       ├── index.ts
│       └── usePorter.ts      # React hook
├── dist/                     # Build output
│   ├── cjs/                  # CommonJS
│   ├── esm/                  # ES Modules
│   └── types/                # TypeScript declarations
├── tests/
│   └── extension/            # Test Chrome extension
└── img/
    └── porter_logo.png       # Official logo
```

---

## Branding

Official logo: `img/porter_logo.png`

![Porter Logo](../img/porter_logo.png)

