
![porter_logo](img/porter_logo.png)

`npm i porter`

Porter scales from a simple Web Extensions sendMessage replacement to an enterprise message and state synchronization system with full Typescript support.

- Minimal size (< 8kb)
- Utilities for managing ports, messages and senders.
- Faster and less memory than message sending
- Many scenarios available -- Sidebar, Devtools, Popup, and of course Content Scripts
- Can split content scripts out by frameId for ultimately granular message passing.

Examples: Coming soon.

### First, create a Porter Source

Porter can be sourced anywhere, but the Service Worker usually makes the most sense.


```typescript
// service worker
import { Porter } from 'porter'

const porter = new Porter();

// set up message handlers for incoming messages
porter.onMessage({
    hello_porter: (message, port, senderDetails) => {
        console.log('Hello porter heard with message: ', message);
        // messages come with some convenience info
        console.log(`Hello porter came from tabId: ${senderDetails.tabId}, frameId: ${senderDetails.frameId}, url: tabId: ${senderDetails.url} `);
    },
    foo: (message, port) => {
        // send back a message using the port from the message received
        port.post({action: 'bar'})
    }
});

// send a message to a particular content-script
porter.post({tabId: 12, frameId: 0}, {action: 'hello-target', payload: { value: 3 }});


// or send a message to a connected 'agent' such as a sidebar
porter.post(PorterContext.Sidebar, {action: 'hello-sidebar', payload: {}})

```

### Use Porter in your 'Agents', that is, your Content Scripts, Sidebars, Devtools, Popups, etc.

```typescript
import { PorterAgent } from 'porter'

const porter = new PorterAgent(PorterContext.ContentScript)

// Just like the source Porter, we set up any message listeners we may want.
porter.onMessage({
    bar: (message, port) => {
        // woohoo
    }
});

// And send messages to the source
porter.post({action: 'foo'});
```

### Async actions

Just make the onMessage handler function an async function, in either the agent or the source.

```typescript
// Usual setup, except we can make individual message handlers async
porter.onMessage({
    bar: async (message, port) => {
        // await myFunction() {}
    }
});

```
