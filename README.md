# Porter

![porter_logo](img/porter_logo.png)

A powerful messaging library for Web Extensions that provides a robust communication system between different parts of your extension (Service Worker, Content Scripts, Popups, Sidepanels, etc.).

## Table of Contents

- [Features](#features)
- [Why Porter?](#why-porter)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Set up the Service Worker (Source)](#1-set-up-the-service-worker-source)
  - [Set up Content Scripts or Other Contexts (Agents)](#2-set-up-content-scripts-or-other-contexts-agents)
  - [Rich Context Information](#rich-context-information)
  - [Using Porter with React](#using-porter-with-react)
- [Advanced Usage](#advanced-usage)
  - [Message Targeting](#message-targeting)
  - [Automatic Reconnection](#automatic-reconnection)
  - [Async Message Handlers](#async-message-handlers)
- [API Reference](#api-reference)
  - [Source API](#source-api)
  - [Agent API](#agent-api)
- [Message Format](#message-format)
- [Message Targeting Types](#message-targeting-types)
  - [BrowserLocation](#browserlocation)
  - [MessageTarget](#messagetarget)
- [Browser Support](#browser-support)
- [License](#license)
- [Contributing](#contributing)

## Features

- **TypeScript Support**: Full type safety and autocompletion
- **Minimal Size**: Less than 8kb (gzipped)
- **Reliable Communication**: Built-in message queuing and reconnection handling
- **Context-Aware**: Automatically identifies and manages different extension contexts
- **Flexible Targeting**: Send messages to specific contexts, tabs, or frames
- **Modern API**: Promise-based and async/await friendly
- **MV3 Compatible**: Works with Manifest V3 extensions
- **Rich Context Information**: Provides detailed information about message sources and targets

## Why Porter?

While Web Extensions provide native messaging APIs (`Runtime.sendMessage` and `Tabs.sendMessage`), Porter offers several significant advantages:

### 1. Connection Management

- **Automatic Connection Tracking**: Porter maintains a live registry of all connected contexts (content scripts, popups, sidepanels, etc.)
- **Connection State Awareness**: Know exactly which parts of your extension are connected and available
- **Automatic Reconnection**: Handles service worker shutdowns and reconnections automatically
- **Message Queueing**: Messages are queued when connections are lost and automatically resent when reconnected

### 2. Context-Aware Messaging

- **Rich Context Information**: Get detailed information about message sources (tab ID, frame ID, context type)
- **Flexible Targeting**: Send messages to specific contexts, tabs, or frames without complex tab querying
- **Frame Support**: Native messaging doesn't provide frame-level targeting, which Porter handles automatically

### 3. Developer Experience

- **TypeScript Support**: Full type safety and autocompletion for messages and handlers
- **Structured Messages**: Enforces a consistent message format (`{ action, payload }`)
- **React Integration**: Built-in hook that handles connection lifecycle and state management
- **Simplified API**: No need to manage ports manually or handle connection setup/teardown

### 4. Performance & Reliability

- **Persistent Connections**: Uses long-lived ports instead of one-off messages
- **Message Queueing**: Prevents message loss during service worker shutdowns
- **Automatic Retries**: Handles connection issues and message delivery failures
- **Efficient Targeting**: No need to query tabs or maintain connection lists manually

### 5. Cross-Browser Compatibility

- **Consistent API**: Works the same way across Chrome, Firefox, Safari, and Edge
- **Manifest V3 Ready**: Built for modern extension architectures
- **Polyfill Support**: Works with `webextension-polyfill` for broader compatibility

### 6. Best Practices

- **Enforced Patterns**: Guides developers toward reliable messaging patterns
- **Error Handling**: Built-in error handling and logging
- **Debugging Support**: Rich context information helps with debugging
- **Connection Lifecycle**: Proper handling of component mounting/unmounting

While native messaging APIs can work for simple cases, Porter provides a more robust, developer-friendly solution that handles the complexities of extension messaging automatically.

## Installation

```bash
npm install porter-source
```

## Quick Start

### 1. Set up the Service Worker (Source)

```typescript
// service-worker.ts
import { source } from 'porter-source';

// Create Porter functions
const { post, onMessage, onConnect, onDisconnect } = source('my-extension');

// Set up message handlers
onMessage({
  // Handle messages from any agent
  updateState: (message, agent) => {
    console.log(`Received state update from ${agent.location.context}`);
    // Process the message
  },

  // Handle messages from specific contexts
  popupAction: (message, agent) => {
    if (agent.location.context === 'Popup') {
      // Handle popup-specific action
    }
  },
});

// Send messages to agents
post(
  { action: 'stateChanged', payload: { newState: 'updated' } },
  { context: 'ContentScript' } // Send to all content scripts
);
```

### 2. Set up Content Scripts or Other Contexts (Agents)

```typescript
// content-script.ts
import { connect } from 'porter-source';

// Connect to the Porter source
const { post, onMessage, getAgentInfo } = connect({
  namespace: 'my-extension',
});

// Set up message handlers
onMessage({
  stateUpdate: (message) => {
    // Handle state updates
  },
});

// Send messages to the service worker
post({ action: 'updateState', payload: { newValue: 123 } });
```

### Rich Context Information

Porter provides detailed information about message sources and targets through the `AgentInfo` type, which includes information that Web Extensions don't provide by default:

```typescript
type AgentInfo = {
  id: string; // Unique identifier for the agent
  location: {
    context: PorterContext; // The type of context (ContentScript, Popup, etc.)
    tabId: number; // The tab ID
    frameId: number; // The frame ID within the tab
    url?: string; // The URL of the page (if applicable)
  };
};
```

This information is automatically provided with every message:

```typescript
// In your service worker
onMessage({
  handleMessage: (message, agent) => {
    console.log(
      `Message from ${agent.location.context} in tab ${agent.location.tabId}`
    );
    if (agent.location.frameId > 0) {
      console.log(`Message from an iframe (frame ${agent.location.frameId})`);
    }
  },
});

// In your content script
const { post, onMessage, getAgentInfo } = connect({
  namespace: 'my-extension',
  onReady: (status) => {
    // Access your own agent information
    const myInfo = status.agent;
    console.log(
      `Connected as ${myInfo.location.context} in tab ${myInfo.location.tabId}`
    );
  },
});
```

This rich context information helps you:

- Identify the source of messages
- Target specific contexts or frames
- Handle messages differently based on their origin
- Debug communication issues more effectively

### Using Porter with React

Porter provides a custom hook `usePorter` that makes it easy to use Porter in React components across different extension contexts:

```typescript
// In any React component (popup, sidepanel, content script, etc.)
import { usePorter } from 'porter-source';

function MyComponent() {
  const { post, setMessage, isConnected, error, agentInfo } = usePorter({
    namespace: 'my-extension',
    // Optionally specify the context if you want to override auto-detection
    agentContext: 'Popup', // or 'ContentScript', 'Sidepanel', etc.
  });

  // Set up message handlers
  useEffect(() => {
    setMessage({
      stateUpdate: (message) => {
        console.log('Received state update:', message.payload);
      },
    });
  }, [setMessage]);

  // Send messages
  const handleClick = () => {
    post({ action: 'updateState', payload: { newValue: 123 } });
  };

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  if (!isConnected) {
    return <div>Connecting to Porter...</div>;
  }

  return (
    <div>
      <p>Connected as: {agentInfo?.location.context}</p>
      <p>Tab ID: {agentInfo?.location.tabId}</p>
      <button onClick={handleClick}>Update State</button>
    </div>
  );
}
```

The `usePorter` hook provides:

- `post`: Function to send messages
- `setMessage`: Function to set up message handlers
- `isConnected`: Boolean indicating connection status
- `error`: Any connection or message errors
- `agentInfo`: Information about the current agent's context

The hook automatically:

- Connects to Porter when the component mounts
- Handles reconnection if the service worker becomes inactive
- Provides connection status and error handling
- Gives you access to the agent's context information

You can use this hook in any React component, regardless of where it's mounted in your extension. Porter will automatically detect the correct context (popup, sidepanel, content script, etc.) based on the component's location.

## Advanced Usage

### Message Targeting

Porter provides flexible message targeting:

```typescript
// Send to all content scripts
post(message, { context: 'ContentScript' });

// Send to a specific tab
post(message, {
  context: 'ContentScript',
  location: { tabId: 123 },
});

// Send to a specific frame
post(message, {
  context: 'ContentScript',
  location: { tabId: 123, frameId: 0 },
});

// Send to popup
post(message, { context: 'Popup' });

// Send to sidepanel
post(message, { context: 'Sidepanel' });
```

### Automatic Reconnection

Porter automatically handles service worker shutdowns and reconnections:

```typescript
// In your content script
const { post, onMessage } = connect({
  namespace: 'my-extension',
});

// Messages are automatically queued if the service worker is inactive
// and will be sent once it reconnects
post({ action: 'updateState', payload: { newValue: 123 } });
```

### Async Message Handlers

Porter supports async message handlers:

```typescript
// In your service worker
onMessage({
  processData: async (message, agent) => {
    const result = await someAsyncOperation(message.payload);
    post({ action: 'processComplete', payload: result }, agent.location);
  },
});
```

## API Reference

### Source API

```typescript
const {
  post,
  onMessage,
  onConnect,
  onDisconnect,
  queryAgents
} = source(namespace: string);

// Send messages
post(message: Message, target?: MessageTarget);

// Handle incoming messages
onMessage(handlers: MessageHandlers);

// Handle agent connections
onConnect(callback: (agent: AgentInfo) => void);

// Handle agent disconnections
onDisconnect(callback: (agent: AgentInfo) => void);

// Query connected agents
queryAgents(query: Partial<BrowserLocation>): Agent[];
```

### Agent API

```typescript
const {
  post,
  onMessage,
  getAgentInfo
} = connect(options: ConnectOptions);

// Send messages
post(message: Message, target?: MessageTarget);

// Set up message handlers
onMessage(handlers: MessageHandlers);

// Get agent information
getAgentInfo(): AgentInfo | null;
```

## Message Format

All messages follow this format:

```typescript
type Message = {
  action: string;
  payload: any;
};
```

## Message Targeting Types

Porter provides flexible message targeting through two main types:

### BrowserLocation

`BrowserLocation` represents a specific location in your extension:

```typescript
type BrowserLocation = {
  context: PorterContext; // The type of context (ContentScript, Popup, etc.)
  tabId: number; // The tab ID
  frameId: number; // The frame ID within the tab
};
```

This type is used when you need to target a specific location, such as a particular content script in a specific tab and frame.

### MessageTarget

`MessageTarget` is a union type that provides multiple ways to target messages:

```typescript
type MessageTarget =
  | BrowserLocation // Target a specific location
  | PorterContext // Target all agents in a specific context
  | string // Target agent by unique id
  | number; // Target by tab ID
```

This flexibility allows you to:

1. Target specific locations:

```typescript
post(message, {
  context: 'ContentScript',
  tabId: 123,
  frameId: 0,
});
```

2. Target all agents in a context:

```typescript
post(message, 'ContentScript'); // Send to all content scripts
```

3. Target specific agents:

```typescript
post(message, 'agent-123'); // Send to a specific agent
```

4. Target all agents in a tab:

```typescript
post(message, 123); // Send to all agents in tab 123
```

The distinction between `BrowserLocation` and `MessageTarget` is that:

- `BrowserLocation` is a specific location with all required fields
- `MessageTarget` is more flexible, allowing you to target messages in different ways depending on your needs

## Browser Support

Porter supports all major browsers that implement the Web Extensions API:

- Chrome/Chromium
- Firefox
- Safari
- Edge

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
