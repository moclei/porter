import { connect } from 'porter-source';

const [post, onMessage, getAgentMetadata] = connect();

// Set up test message handlers
onMessage({
  'echo-response': (message) => {
    console.log('[Porter:Test:CS] Received echo:', message.payload);
    console.log('[Porter:Test:CS] Agent metadata:', getAgentMetadata());
  },
  'broadcast-message': (message) => {
    console.log('[Porter:Test:CS] Received broadcast:', message.payload);
  },
  'status-response': (message) => {
    console.log('[Porter:Test:CS] Service worker status:', message.payload);
  },
});

// Comment out existing tests to keep service worker logs clean
/*
let messageCount = 0;
let lastMessageTime = Date.now();
let isReconnecting = false;

// Run tests automatically
function runTests() {
  // Test basic messaging
  post({ action: 'test-echo', payload: 'Hello!' });

  // Test broadcasting
  post({ action: 'test-broadcast', payload: 'Broadcast test' });

  // Test error handling
  try {
    post({ action: 'non-existent' });
  } catch (error) {
    console.log('Expected error caught:', error);
  }
}

setTimeout(runTests, 1000); // Give time for connection to establish
*/
