import { source, Message, Agent } from 'porter-source';

const [post, onMessage, onConnect, onDisconnect, onMessagesSet] = source();

// Test different message patterns
onMessage({
  'test-echo': (message, agent) => {
    if (!agent) {
        console.error('[Porter:Test:BG] No agent metadata provided for echo response');
        return;
    }
    console.log('[Porter:Test:BG] Echoing message back to:', agent.key);
    post({ action: 'echo-response', payload: message.payload }, agent);
  },
  'test-broadcast': (message) => {
    post(
            { action: 'echo-response', payload: message.payload }
        );
  }
});

onConnect((agent) => {
  console.log('Agent connected:', agent);
});

onDisconnect((agent) => {
  console.log('Agent disconnected:', agent);
});