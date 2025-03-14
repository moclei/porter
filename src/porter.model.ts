import browser from 'webextension-polyfill';

export type AgentId = string;

export enum PorterContext {
  ContentScript = 'contentscript',
  Extension = 'extension',
  Popup = 'popup',
  Sidepanel = 'sidepanel',
  Devtools = 'devtools',
  Options = 'options',
  Unknown = 'unknown',
}

// Describes how the connection was established
export enum ConnectionType {
  NewTab = 'new-tab',
  NewFrame = 'new-frame',
  Refresh = 'refresh',
  NewExtensionContext = 'new-extension-context',
}

// export interface AgentLocation {
//   context: PorterContext;
//   tabId?: number;
//   frameId?: number;
//   customIdentifier?: string;
// }

export interface AgentInfo {
  id: AgentId;
  location: BrowserLocation;
  createdAt: number;
  lastActiveAt: number;
}

export type Agent = {
  port?: browser.Runtime.Port;
  info: AgentInfo;
};

// export type AgentTarget = {
//   id?: AgentId;
//   context?: PorterContext;
//   location?: AgentLocation;
// };

export type BrowserLocation = {
  context: PorterContext;
  tabId: number;
  frameId: number;
};

export type MessageTarget =
  | BrowserLocation // Target a specific location
  | PorterContext // Target all agents in a specific context
  | string // Target agent by unique id (advanced)
  | number; // Target a content script by tabId (all frames)

export type Unsubscribe = () => void;

export type Message<K extends keyof MessageAction> = {
  action: K;
  target?: MessageTarget;
  payload?: MessageAction[K];
};

export type MessageAction = {
  [key: string]: any;
};

export type Listener<T extends keyof PorterEvent> = (
  arg: PorterEvent[T]
) => void;

export type MessageListener = {
  config: MessageConfig;
  listener: Listener<'onMessage'>;
};

export type MessageConfig = {
  [K in keyof MessageAction]: (message: Message<K>, info?: AgentInfo) => void;
};

// export type GetAgentOptions = {
//   context?: PorterContext;
//   index?: number;
//   subIndex?: number;
// };

export interface PorterEvent {
  onConnect: AgentInfo;
  onDisconnect: AgentInfo;
  onMessagesSet: AgentInfo;
  onMessage: AgentInfo & { message: Message<any> };
}

export enum PorterErrorType {
  CONNECTION_FAILED = 'connection-failed',
  CONNECTION_TIMEOUT = 'connection-timeout',
  INVALID_TARGET = 'invalid-target',
  MESSAGE_FAILED = 'message-failed',
  INVALID_CONTEXT = 'invalid-context',
  INVALID_PORT = 'invalid-port',
}

export class PorterError extends Error {
  constructor(
    public type: PorterErrorType,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'PorterError';
  }
}
