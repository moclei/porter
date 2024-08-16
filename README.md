
![porter_logo](img/porter_logo.png)

`npm i porter-source`

Porter scales from a simple Web Extensions sendMessage replacement to an enterprise message and state synchronization system with full Typescript support.

- Minimal size (< 8kb)
- Utilities for managing ports, messages and senders.
- Faster and less memory than message sending
- Many scenarios available -- Sidepanel, Devtools, Popup, and of course Content Scripts

Examples: Coming soon.

### First, create a Porter Source

Porter can be sourced anywhere, but the Service Worker usually makes the most sense.


```typescript
// service worker environment
import { source } from 'porter-source'

const [post, setMessages, onConnect] = source();

// set up message handlers for incoming messages
setMessages({
    hello_porter: (message, agentMetadata) => {
        console.log('Hello porter heard with message: ', message);
        // messages come with some convenience info
        console.log(`Hello porter came from: ${agentMetadata.key}, frameId: ${agentMetadata.frameId}, tabId: ${agentMetadata.tabId} `);
    },
    foo: (message, {key}) => {
        // send back a message using the port from the message received
        post({action: 'bar'}, key)
    }
});
// Messages are in the format {action: string, payload: any}
const message = {action: 'hello-agent', payload: { value: 3 }}
// targets are in the format {context: PorterContext | string, location?: {AgentLocation}}
// where PorterContext is 
type PorterContext = {
    'ContentScript'
    'Devtools',
    'Sidepanel',
    'Unknown'
}
// Or you can call it whatever you want with a string.

// send a message to a particular frame
const target = {context: PorterContext.ContentScript, location: {index: 1, subIndex: 123}}
post(message, target);

// send a message to all content scripts
const target = {context: PorterContext.ContentScript}
post(message, target);

// send a message to all frames for a tab
const tabId = 123;
const target = {context: PorterContext.ContentScript, location: {index: tabId}}
post(message, target);

// Similarly can target other contexts:
const target = {context: PorterContext.Devtools}
post(message, target);

// Or when you receive a message, can respond back to that sender without needing to know the particulars:
setMessages({
    from_devtools: (message, {key}) => {
        post({'hello_back'}, key)
    },
});

```

### Use Porter in your 'Agents', that is, your Content Scripts, Sidepanels, Devtools, Popups, etc.

```typescript
import { connect } from 'porter-source'

const [post, setMessages] = new connect()

// Just like the source Porter, we set up any message listeners we may want.
setMessages({
    bar: (message, port) => {
        // woohoo
    }
});

// And send messages to the source
post({action: 'foo'});

// Or bypass the service worker and send a message directly to another target
post({action: 'foo'}, PorterContext.Devtools);
```

### Async actions

Just make the onMessage handler function an async function, in either the agent or the source.

```typescript
// Usual setup, except we can make individual message handlers async
porter.onMessage({
    bar: async (message, agentMetadata) => {
        // await myFunction() {}
    }
});

```



### Structure of messages

Porter prescribes the following message format:

```typescript
type Message = {
    action: string;
    payload: any;
}

so a message will look like:

const message = {action: 'message-name', payload: {/*any shape*/}}
```