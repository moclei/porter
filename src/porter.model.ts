import browser from 'webextension-polyfill';

export type Agent = { port?: browser.Runtime.Port; data: any };

export type GetAgentOptions = {
    context?: PorterContext;
    index?: number;
    subIndex?: number;
};
export type MessageAction = {
    [key: string]: any;
}

export type AgentLocation = {
    index: number;
    subIndex?: number;
}

export type Listener<T extends keyof PorterEvents> = (arg: PorterEvents[T]) => void;

export type MessageListener = {
    config: MessageConfig;
    listener: Listener<'onMessage'>;
}

export type AgentMetadata = {
    key: string;
    connectionType: ConnectContext;
    context: PorterContext;
    location: AgentLocation;
}
export interface PorterEvents {
    onConnect: AgentMetadata;
    onDisconnect: AgentMetadata;
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
    Devtools = 'devtools',
    Sidepanel = 'Sidepanel',
    Options = 'options',
    Popup = 'popup',
    Background = 'background',
    Unknown = 'unknown',
}

export type Message<K extends keyof MessageAction> = {
    action: K;
    payload?: MessageAction[K];
}

export type MessageConfig = {
    [K in keyof MessageAction]: (
        message: Message<K>,
        agent?: { key: string, context: PorterContext, location: AgentLocation }
    ) => void
};

export type PortDetails = {
    tabId: number;
    frameId: number;
    url?: string;
    tag: string;
}