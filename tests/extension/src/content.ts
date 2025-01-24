import { connect } from 'porter-source';

const [post, onMessage, getAgentMetadata] = connect();

// Set up test message handlers
onMessage({
  'echo-response': (message) => {
    console.log('Received echo:', message.payload);
    console.log('Agent metadata:', getAgentMetadata());
  },
  'broadcast-message': (message) => {
    console.log('Received broadcast:', message.payload);
  },
});

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
