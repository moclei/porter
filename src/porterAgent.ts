import browser, { Extension, Runtime } from 'webextension-polyfill';
import { Agent, Message, MessageConfig, PorterContext, TargetAgent } from './porter.model';
// import { log } from './porter.utils';

export class PorterAgent {
    private static instance: PorterAgent | null = null;
    private agent: Agent | undefined = undefined;
    private config: MessageConfig | null = null;
    private context: PorterContext | null = null;
    private namespace: string = 'porter';


    private constructor(options: { agentContext?: PorterContext, namespace?: string } = {}) {
        this.namespace = options.namespace ?? this.namespace;
        this.context = options.agentContext ?? this.determineContext();
        this.initializeConnection();
    }

    public static getInstance(options: { agentContext?: PorterContext, namespace?: string } = {}): PorterAgent {
        if (!PorterAgent.instance) {
            PorterAgent.instance = new PorterAgent(options);
        }
        return PorterAgent.instance;
    }

    private initializeConnection() {
        const name = `${this.namespace}-${this.context}`;
        const port = browser.runtime.connect({ name });
        this.agent = { port, data: {} };
        port.onMessage.addListener((message: any) => this.handleMessage(port, message));
        port.onDisconnect.addListener(() => this.handleDisconnect(port));
    }

    public onMessage(config: MessageConfig) {
        this.config = config;
    }

    public post(message: Message<any>, target?: TargetAgent) {
        if (!this.agent) {
            console.warn('Porter: No agent available to post message');
            return;
        }
        if (!this.agent.port) {
            console.warn('Porter: No port available to post message');
            return;
        }
        if (target) {
            message.target = target;
        }
        this.agent.port.postMessage(message);
    }

    public getPort(): Runtime.Port | undefined {
        return this.agent?.port;
    }

    private handleMessage(port: Runtime.Port, message: any) {
        console.warn('Porter: handleMessage ', message, port);
        if (!this.config) {
            console.warn('Porter: No message handler configured, message: ', message);
            return;
        }

        console.log('Porter, port and message: ', port, message);
        const action = message.action;
        const handler = this.config[action];

        if (handler) {
            handler(message);
        } else {
            console.log('Porter, port and message: ', port, { action: 'error', payload: `No handler for message with action: ${action}` });
        }
    }

    private handleDisconnect(port: Runtime.Port) {
        console.log('Porter, port and message: ', port, { action: 'disconnect', payload: `Porter: Disconnected from ${port.name}` });
        delete this.agent?.port;
    }

    private determineContext(): PorterContext {
        this.isContentScript()
        if (this.isDevtools()) {
            return PorterContext.Devtools;
        } else if (this.isSidePanel()) {
            return PorterContext.Sidepanel;
        } else if (this.isContentScript()) {
            return PorterContext.ContentScript;
        } else {
            return PorterContext.Unknown;
        }
    }

    private isDevtools() {
        // console.log('Porter, isDevtools, browser.devtools !== undefined  ', browser.devtools !== undefined);
        // console.log('Porter, isDevtools, window.origin.startsWith(devtools://)  ', window.origin.startsWith('devtools://'));
        // console.log('Porter, isDevtools, window.origin: ', window.origin);
        // console.log('Porter, isDevtools, window.location: ', window.location);
        // console.log('Porter, isDevtools, window: ', window);
        return browser.devtools !== undefined;
    }

    private isSidePanel() {
        // console.log('Porter, isSidePanel: ', chrome !== undefined && chrome.sidePanel !== undefined && window.origin.startsWith('chrome-extension://'));
        // console.log('Porter, isSidePanel, chrome !== undefined ? ', chrome !== undefined);
        // console.log('Porter, isSidePanel, chrome.sidePanel !== undefined  ? ', chrome.sidePanel !== undefined);
        // console.log('Porter, isSidePanel, window.origin.startsWith(chrome-extension://)  ? ', window.origin.startsWith('chrome-extension://'));
        return chrome !== undefined && chrome.sidePanel !== undefined && window.origin.startsWith('chrome-extension://');
    }

    private isContentScript() {
        const isExtensionPage = window.location.protocol === 'chrome-extension:';
        console.log('Porter, isContentScript: ', !isExtensionPage);
        return !isExtensionPage;
    }
}



export function connect(options?: { agentContext?: PorterContext, namespace?: string }): [
    (message: Message<any>, target?: TargetAgent) => void,
    (config: MessageConfig) => void
] {
    const porterInstance = PorterAgent.getInstance(options);
    return [porterInstance?.post.bind(porterInstance), porterInstance.onMessage.bind(porterInstance)];
}