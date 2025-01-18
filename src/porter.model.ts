import browser from 'webextension-polyfill';

export type MessageAction = {
  [key: string]: any;
};

export type Agent = { port?: browser.Runtime.Port; data: any };

export type AgentLocation = {
  index: number;
  subIndex?: number;
};

export type AgentMetadata = {
  key: string;
  connectionType: ConnectContext;
  context: PorterContext;
  location: AgentLocation;
};

export type TargetAgent = {
  context: PorterContext | string;
  location?: AgentLocation;
};

export type PostTarget = {
  context: PorterContext;
  location?: {
    index: number;
    subIndex?: number;
  };
};

export type GetAgentOptions = {
  context?: PorterContext;
  index?: number;
  subIndex?: number;
};

export type Listener<T extends keyof PorterEvent> = (
  arg: PorterEvent[T]
) => void;

export type MessageListener = {
  config: MessageConfig;
  listener: Listener<'onMessage'>;
};

export interface PorterEvent {
  onConnect: AgentMetadata;
  onDisconnect: AgentMetadata;
  onMessagesSet: AgentMetadata;
  onMessage: AgentMetadata & { message: Message<any> };
}

export enum ConnectContext {
  NewTab = 'NewTab',
  NewFrame = 'NewFrame',
  RefreshConnection = 'RefreshConnection',
  NewAgent = 'NewAgent',
}

export enum PorterContext {
  ContentScript = 'contentscript',
  Extension = 'extension',
  Background = 'background',
  Unknown = 'unknown',
}

export enum PorterErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  INVALID_TARGET = 'INVALID_TARGET',
  MESSAGE_FAILED = 'MESSAGE_FAILED',
  INVALID_CONTEXT = 'INVALID_CONTEXT',
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

export type Unsubscribe = () => void;

export type Message<K extends keyof MessageAction> = {
  action: K;
  target?: TargetAgent;
  payload?: MessageAction[K];
};

export type MessageConfig = {
  [K in keyof MessageAction]: (
    message: Message<K>,
    agent?: { key: string; context: PorterContext; location: AgentLocation }
  ) => void;
};
