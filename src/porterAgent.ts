import browser, { Runtime } from 'webextension-polyfill';
import { Agent, AgentMetadata, Message, MessageConfig, PorterContext, PorterError, PorterErrorType, TargetAgent } from './porter.model';

export class PorterAgent {
    private static instance: PorterAgent | null = null;
    private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 2000; // 2 seconds
    private connectionAttempts = 0;
    private connectionTimer: NodeJS.Timeout | null = null;
    private messageQueue: Array<{message: Message<any>, timestamp: number}> = [];
    private agent: Agent | undefined = undefined;
    private config: MessageConfig | null = null;
    private context: PorterContext | null = null;
    private namespace: string = 'porter';
    private metadata: AgentMetadata | null = null;
    private connections: AgentMetadata[] = [];
    private readonly MAX_QUEUE_SIZE = 1000;
    private readonly MESSAGE_TIMEOUT = 30000;
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

    private handleMessage(port: Runtime.Port, message: any) {
        this.log('handleMessage, message: ', message);
        if (!this.config) {
            if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
                this.warn('Message queue full, dropping message:', message);
                return;
            }
            this.warn('No message handler configured yet, queueing message: ', message);
            this.messageQueue.push({message, timestamp: Date.now()});
            return;
        }
        this.processMessage(port, message);
    }
    
    private processMessage(port: Runtime.Port, message: any) {
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
        
        handler = this.config?.[action];
        if (handler) {
            this.log('Found handler, calling with message');
            handler(message);
        } else {
            this.log(` No handler for message with action: ${action}`);
        }
    }


    public static getInstance(options: { agentContext?: PorterContext, namespace?: string } = {}): PorterAgent {
        if (!PorterAgent.instance || PorterAgent.instance.namespace !== options.namespace) {
            PorterAgent.instance = new PorterAgent(options);
        }
        return PorterAgent.instance;
    }

    private async initializeConnection(): Promise<void> {
        try {
            if (this.connectionTimer) {
                clearTimeout(this.connectionTimer);
            }

            this.connectionTimer = setTimeout(() => {
                this.handleConnectionTimeout();
            }, this.CONNECTION_TIMEOUT);

            const name = `${this.namespace}-${this.context}`;
            this.log('Connecting new port with name: ', name);
            const port = browser.runtime.connect({ name });
            
            // Set up connection promise
            const connectionPromise = new Promise<void>((resolve, reject) => {
                const handleInitialMessage = (message: any) => {
                    if (message.action === 'porter-handshake') {
                        clearTimeout(this.connectionTimer!);
                        port.onMessage.removeListener(handleInitialMessage);
                        resolve();
                    }
                };
                
                port.onMessage.addListener(handleInitialMessage);
            });

            this.agent = { port, data: {} };
            port.onMessage.addListener((message: any) => this.handleMessage(port, message));
            port.onDisconnect.addListener((p) => this.handleDisconnect(p));

            // Wait for handshake or timeout
            await Promise.race([
                connectionPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new PorterError(
                        PorterErrorType.CONNECTION_TIMEOUT,
                        'Connection timed out waiting for handshake'
                    )), this.CONNECTION_TIMEOUT)
                )
            ]);

            this.connectionAttempts = 0; // Reset on successful connection
        } catch (error) {
            this.error('Connection failed:', error);
            await this.handleConnectionFailure(error);
        }
    }
    private async handleConnectionFailure(error: unknown): Promise<void> {
        this.connectionAttempts++;
        
        if (this.connectionAttempts < this.MAX_RETRIES) {
            this.warn(`Connection attempt ${this.connectionAttempts} failed, retrying in ${this.RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
            await this.initializeConnection();
        } else {
            const finalError = new PorterError(
                PorterErrorType.CONNECTION_FAILED,
                'Failed to establish connection after maximum retries',
                { attempts: this.connectionAttempts, originalError: error }
            );
            this.error('Max connection attempts reached:', finalError);
            throw finalError;
        }
    }

    private handleConnectionTimeout() {
        this.error('Connection timed out');
        this.handleDisconnect(this.agent?.port!);
    }

    public onMessage(config: MessageConfig) {
        this.log('Setting message handler config: ', config);
        this.config = config;

        while (this.messageQueue.length > 0) {
            const item = this.messageQueue[0];
            if (Date.now() - item.timestamp > this.MESSAGE_TIMEOUT) {
                this.warn('Message timeout, dropping message: ', this.messageQueue.shift());
                continue;
            }
            this.processMessage(this.agent?.port!, item.message);
            this.messageQueue.shift();
        }
        this.agent?.port?.postMessage({ action: 'porter-messages-established' });
    }

    public post(message: Message<any>, target?: TargetAgent) {
        this.log(`Sending message`, {
            action: message.action,
            target,
            hasPayload: !!message.payload
        });
        if (!this.agent) {
            throw new PorterError(
                PorterErrorType.CONNECTION_FAILED,
                'No agent available to post message'
            );
        }
        if (!this.agent.port) {
            throw new PorterError(
                PorterErrorType.CONNECTION_FAILED,
                'No port available to post message'
            );
        }
        try {
            if (target) {
                message.target = target;
            }
            this.agent.port.postMessage(message);
        } catch (error) {
            throw new PorterError(
                PorterErrorType.MESSAGE_FAILED,
                'Failed to post message',
                { originalError: error, message, target }
            );
        }
    }

    public getPort(): Runtime.Port | undefined {
        return this.agent?.port;
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
        // this.isContentScript()
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
        // this.log('isContentScript: ', !isExtensionPage);
        return !isExtensionPage;
    }

    private log(message: string, ...args: any[]) {
        console.log(`[Porter:${this.context}] ${message}`, ...args);
    }
    private error(message: string, ...args: any[]) {
        console.error(`PorterAgent [${this.namespace}-${this.metadata?.key || ''}], ` + message, ...args);
    }
    private warn(message: string, ...args: any[]) {
        console.warn(`PorterAgent [${this.namespace}-${this.metadata?.key || ''}], ` + message, ...args);
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