<br>
![Porter](./img/porter-logo.png)
<br>

`npm i porter`

Porter scales from a simple sendMessage replacement to an enterprise message and state synchronization system with full Typescript support.

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

    }
})
```

### Create derived atoms with computed values

A new read-only atom can be created from existing atoms by passing a read
function as the first argument. `get` allows you to fetch the contextual value
of any atom.

```jsx
const doubledCountAtom = atom((get) => get(countAtom) * 2)

function DoubleCounter() {
  const [doubledCount] = useAtom(doubledCountAtom)
  return <h2>{doubledCount}</h2>
}
```

### Creating an atom from multiple atoms

You can combine multiple atoms to create a derived atom.

```jsx
const count1 = atom(1)
const count2 = atom(2)
const count3 = atom(3)

const sum = atom((get) => get(count1) + get(count2) + get(count3))
```

Or if you like fp patterns ...

```jsx
const atoms = [count1, count2, count3, ...otherAtoms]
const sum = atom((get) => atoms.map(get).reduce((acc, count) => acc + count))
```

### Derived async atoms [<img src="https://img.shields.io/badge/-needs_suspense-black" alt="needs suspense" />](https://react.dev/reference/react/Suspense)

You can make the read function an async function too.

```jsx
const urlAtom = atom('https://json.host.com')
const fetchUrlAtom = atom(async (get) => {
  const response = await fetch(get(urlAtom))
  return await response.json()
})

function Status() {
  // Re-renders the component after urlAtom is changed and the async function above concludes
  const [json] = useAtom(fetchUrlAtom)
  ...
```

### You can create a writable derived atom

Specify a write function at the second argument. `get` will return the current
value of an atom. `set` will update the value of an atom.

```jsx
const decrementCountAtom = atom(
  (get) => get(countAtom),
  (get, set, _arg) => set(countAtom, get(countAtom) - 1)
)

function Counter() {
  const [count, decrement] = useAtom(decrementCountAtom)
  return (
    <h1>
      {count}
      <button onClick={decrement}>Decrease</button>
      ...
```

### Write only derived atoms

Just do not define a read function.

```jsx
const multiplyCountAtom = atom(null, (get, set, by) =>
  set(countAtom, get(countAtom) * by),
)

function Controls() {
  const [, multiply] = useAtom(multiplyCountAtom)
  return <button onClick={() => multiply(3)}>triple</button>
}
```

### Async actions

Just make the write function an async function and call `set` when you're ready.

```jsx
const fetchCountAtom = atom(
  (get) => get(countAtom),
  async (_get, set, url) => {
    const response = await fetch(url)
    set(countAtom, (await response.json()).count)
  }
)

function Controls() {
  const [count, compute] = useAtom(fetchCountAtom)
  return (
    <button onClick={() => compute('http://count.host.com')}>compute</button>
    ...
```

## Links

- [website](https://jotai.org)
- [documentation](https://jotai.org/docs)
- [course](https://egghead.io/courses/manage-application-state-with-jotai-atoms-2c3a29f0)