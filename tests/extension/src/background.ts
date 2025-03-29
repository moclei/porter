import { source, Message, Agent, AgentInfo } from 'porter-source';

// Log service worker startup
console.log(
  '[Porter:Test:BG] Service worker started at:',
  new Date().toISOString()
);

// Configure side panel to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

let originalTabId: number | null = null;
let isShutdown = false;

const { post, onMessage, onConnect, onDisconnect, onMessagesSet } = source();

onMessage({
  'test-echo': (message, agent) => {
    if (!agent) {
      console.error(
        '[Porter:Test:BG] No agent metadata provided for echo response'
      );
      return;
    }
    console.log('[Porter:Test:BG] Echoing message back to:', agent.id);
    post({ action: 'echo-response', payload: message.payload }, agent.id);
  },
  'test-broadcast': (message) => {
    post({ action: 'broadcast-message', payload: message.payload });
  },
});

// Store original tab ID when side panel is opened
chrome.sidePanel.open = ((originalOpen) => {
  return async (options) => {
    if (options.tabId) {
      originalTabId = options.tabId;
    }
    return originalOpen(options);
  };
})(chrome.sidePanel.open);

// Reset when the side panel is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === originalTabId) {
    originalTabId = null;
  }
});

// Handle tab switching
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!originalTabId) return;

  if (tabId === originalTabId) {
    // Enable side panel on original tab
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: true,
      path: 'sidepanel/sidepanel.html',
    });
  } else {
    // Disable side panel on other tabs
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false,
    });
  }
});

onConnect((agent) => {
  console.log('[Porter:Test:BG] Agent connected:', agent);
  isShutdown = false;
});

onDisconnect((agent) => {
  console.log('[Porter:Test:BG] Agent disconnected:', agent);
  if (!isShutdown) {
    console.log('[Porter:Test:BG] Unexpected disconnection detected');
  }
});
