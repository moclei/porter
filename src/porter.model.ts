import browser from 'webextension-polyfill';

export type Agent = { port?: browser.Runtime.Port; data: any };

export type MessageAction = {
    [key: string]: any;
}

export enum PorterContext {
    ContentScript = 'contentscroipt',
    Devtools = 'devtools',
    Sidebar = 'sidebar',
    Options = 'options',
    Popup = 'popup',
    Background = 'background',
}

export type Message<K extends keyof MessageAction> = {
    action: K;
    payload: MessageAction[K];
}

export type MessageConfig = Partial<{
    [K in keyof MessageAction]: (
        message: Message<K>,
        port: browser.Runtime.Port,
        senderDetails: PortDetails) => void
}>;

export type PortDetails = {
    tabId: number;
    frameId: number;
    url?: string;
    tag: string;
}