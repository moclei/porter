import browser, { Runtime } from 'webextension-polyfill';
import { Agent, AgentMetadata, Message, MessageConfig, PorterContext, TargetAgent } from './porter.model';

export class PorterAgent {
    private static instance: PorterAgent | null = null;
    private agent: Agent | undefined = undefined;
    private config: MessageConfig | null = null;
    private context: PorterContext | null = null;
    private namespace: string = 'porter';
    private metadata: AgentMetadata | null = null;
    private connections: AgentMetadata[] = [];
    private internalHandlers: MessageConfig = {
        'porter-error': (message: Message<any>) => {
            this.error('internalHandlers, error message received: ', message);
        },
        'porter-disconnect': (message: Message<any>) => {
            this.log('internalHandler, disconnect message received: ', message);
        },
        'porter-handshake': (message: Message<any>) => {
            this.log('internalHandlers, handshake message received: ', message);
            this.handleHandshake(message);
        },
    }


    private constructor(options: { agentContext?: PorterContext, namespace?: string } = {}) {
        this.namespace = options.namespace ?? this.namespace;
        this.context = options.agentContext ?? this.determineContext();
        this.log('Initializing with options: ', options);
        this.initializeConnection();
    }

    public static getInstance(options: { agentContext?: PorterContext, namespace?: string } = {}): PorterAgent {
        if (!PorterAgent.instance || PorterAgent.instance.namespace !== options.namespace) {
            PorterAgent.instance = new PorterAgent(options);
        }
        return PorterAgent.instance;
    }

    private initializeConnection() {
        const name = `${this.namespace}-${this.context}`;
        this.log('Connecting new port with name: ', name);
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
            this.warn('No agent available to post message');
            return;
        }
        if (!this.agent.port) {
            this.warn('No port available to post message');
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
        this.log('handleMessage, message: ', message);

        if (!this.config) {
            this.warn('No message handler configured, message: ', message);
            return;
        }

        this.log('handleMessage, config: ', this.config);
        const action = message.action;
        let handler;
        if (message.action.startsWith('porter')) {
            handler = this.internalHandlers[action];
            if (handler) {
                handler(message);
            } else {
                this.error(' No internal handler for message with action: ', action);
            }
            return;
        }
        handler = this.config[action];

        if (handler) {
            this.log('Found handler, calling with message');
            handler(message);
        } else {
            this.log(` No handler for message with action: ${action}`);
        }
    }

    private handleHandshake(message: Message<any>) {
        this.log('handleHandshake, message: ', message);
        const { meta, currentConnections } = message.payload;
        this.metadata = meta;
        this.connections = currentConnections;
    }

    private handleDisconnect(port: Runtime.Port) {
        this.log('handleDisconnect: ');
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
        this.log('isContentScript: ', !isExtensionPage);
        return !isExtensionPage;
    }

    private log(message: string, ...args: any[]) {
        console.log(`PorterAgent ${this.namespace} ${this.metadata?.key || ''}: ` + message, ...args);
    }
    private error(message: string, ...args: any[]) {
        console.error(`PorterAgent ${this.namespace} ${this.metadata?.key || ''}: ` + message, ...args);
    }
    private warn(message: string, ...args: any[]) {
        console.warn(`PorterAgent ${this.namespace} ${this.metadata?.key || ''}: ` + message, ...args);
    }
}



export function connect(options?: { agentContext?: PorterContext, namespace?: string }): [
    (message: Message<any>, target?: TargetAgent) => void,
    (config: MessageConfig) => void
] {
    console.log('PorterAgent connect() heard with options: ', options);
    const porterInstance = PorterAgent.getInstance(options);
    return [porterInstance?.post.bind(porterInstance), porterInstance.onMessage.bind(porterInstance)];
}