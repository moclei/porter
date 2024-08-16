import browser, { Runtime, Tabs } from 'webextension-polyfill';
import { AgentLocation, AgentMetadata, ConnectContext, Listener, Message, MessageConfig, MessageListener, PorterEvent } from './porter.model';
import { Agent, PorterContext } from './porter.model';
import { isServiceWorker } from './porter.utils';

export class PorterSource {
    private static instance: PorterSource | null = null;
    private agents: Map<string, Agent> = new Map();
    private contextCounters: Map<PorterContext, number> = new Map();
    private listeners: Map<keyof PorterEvent, Set<Listener<keyof PorterEvent>>> = new Map();
    private messageListeners: Set<MessageListener> = new Set();

    private constructor(private porterNamespace: string = 'porter') {
        if (!isServiceWorker()) {
            console.warn('PorterSource: Can only create porter source in service worker');
        }
        browser.runtime.onConnect.addListener(this.handleConnection.bind(this));
    }

    public static getInstance(porterNamespace: string = 'porter'): PorterSource {
        if (!PorterSource.instance) {
            PorterSource.instance = new PorterSource(porterNamespace);
        }
        return PorterSource.instance;
    }

    public onConnect(listener: Listener<'onConnect'>) {
        return this.addListener('onConnect', listener);
    }

    public onDisconnect(listener: Listener<'onDisconnect'>) {
        return this.addListener('onDisconnect', listener);
    }

    public addListener<T extends keyof PorterEvent>(event: T, listener: Listener<T>) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener as Listener<keyof PorterEvent>);

        return () => {
            this.listeners.get(event)?.delete(listener as Listener<keyof PorterEvent>);
        };
    }

    public onMessage(config: MessageConfig) {
        const messageListener: MessageListener = {
            config,
            listener: (event: PorterEvent['onMessage']) => {
                const handler = config[event.message.action];
                if (handler) {
                    handler(event.message, { key: event.key, context: event.context, location: event.location });
                }
            }
        }
        this.messageListeners.add(messageListener);

        return () => {
            this.messageListeners.delete(messageListener);
        };
    }

    private emitMessage(messageEvent: PorterEvent['onMessage']) {
        console.log('PorterSource, message: ', messageEvent);
        if (!!messageEvent.message.target) {
            const { context, location } = messageEvent.message.target;
            if (location) {
                this.post(messageEvent.message, context as PorterContext, location);
            } else {
                this.post(messageEvent.message, context);
            }
        }
        this.messageListeners.forEach(({ listener }) => listener(messageEvent as PorterEvent['onMessage']));
    }

    private emit<T extends keyof PorterEvent>(event: T, arg: PorterEvent[T]) {
        console.log('Porter emitMessage: ', arg);
        this.listeners.get(event)?.forEach(listener => (listener as Listener<T>)(arg));
    }

    public getAgent(options: {
        index?: number;
        subIndex?: number;
        context: PorterContext
    } = { context: PorterContext.ContentScript }): Agent | Agent[] | null {

        if (options.index === undefined) {
            // Return all agents for a context if no index provided. Defaults to content script.
            return this.getAgentsByPrefix(options.context);
        }
        if (options.context === PorterContext.ContentScript) {
            if (options.subIndex === undefined) {
                // Return all agents for the given tab (index)
                return this.getAgentsByPrefix(`${options.context}:${options.index}`);
            }
            // Return a specific content script agent
            return this.agents.get(`${options.context}:${options.index}:${options.subIndex}`) || null;
        }
        // For non-ContentScript contexts, return the specific agent
        return this.agents.get(`${options.context}:${options.index}`) || null;
    }

    private getAgentsByContext(context: PorterContext): Agent[] {
        return Array.from(this.agents.entries())
            .filter(([key, _]) => key.startsWith(`${context}:`))
            .map(([_, agent]) => agent);
    }

    private getAgentsByPrefix(prefix: string): Agent[] {
        return Array.from(this.agents.entries())
            .filter(([key, _]) => key.startsWith(`${prefix}:`))
            .map(([_, agent]) => agent);
    }

    public post(message: Message<any>, context: PorterContext): void;
    public post(message: Message<any>, key: string): void;
    public post(message: Message<any>, context: PorterContext, location: Partial<AgentLocation>): void;
    public post(
        message: Message<any>,
        contextOrKey: PorterContext | string,
        location?: Partial<AgentLocation>
    ): void {
        if (this.isPorterContext(contextOrKey)) {
            if (!location) {
                // Post to all agents of this context
                this.postToAgents(message, (agentKey) => agentKey.startsWith(`${contextOrKey}:`));
            } else if (location.index !== undefined) {
                if (contextOrKey === PorterContext.ContentScript && location.subIndex !== undefined) {
                    // Post to specific content script
                    const key = this.getKey(contextOrKey, location.index, location.subIndex);
                    this.postToAgents(message, (agentKey) => agentKey === key);
                } else {
                    // Post to all agents with matching context and index
                    const partialKey = `${contextOrKey}:${location.index}`;
                    this.postToAgents(message, (agentKey) => agentKey.startsWith(partialKey));
                }
            } else {
                console.warn('Invalid location provided for post method');
            }
        } else {
            // Assume it's a key (partial or full)
            this.postToAgents(message, (agentKey) => agentKey.startsWith(contextOrKey));
        }
    }

    private postToAgents(message: Message<any>, keyFilter: (key: string) => boolean): void {
        let agentFound = false;
        this.agents.forEach((agent, key) => {
            if (keyFilter(key) && agent.port) {
                agent.port.postMessage(message);
                agentFound = true;
            }
        });
        if (!agentFound) {
            console.warn('No matching agents found for the given criteria');
        }
    }

    public getData(key: string): any {
        return this.agents.get(key)?.data || {};
    }

    public setData(key: string, data: any) {
        const agent = this.agents.get(key);
        if (agent) {
            agent.data = data;
        } else {
            console.warn('PorterSource: agent does not exist to set data on: ', key);
        }
    }

    private handleConnection(port: Runtime.Port) {
        console.log('Handling connection for port:', port.name);
        if (!port.name) {
            console.warn('PorterSource: Port name not provided');
            return;
        }
        console.log("PorterSource: isContentScript? ", this.isContentScript(port));
        const connectCtx = port.name.split('-');
        console.log('Connect context:', connectCtx);
        if (connectCtx.length === 3) {
            //Todo: Add relay connections
            console.warn('PorterSource: Relay connections not yet supported');
        } else if (connectCtx.length === 2) {
            this.addAgent(port, connectCtx[1] as PorterContext);
        } else {
            console.warn('PorterSource: Invalid port name');
        }
        this.printAgents();
    }

    private isContentScript(port: Runtime.Port) {
        if (!port.sender) return false;
        const hasFrame = port.sender.tab && port.sender.tab.id !== undefined && port.sender.frameId !== undefined;
        if (!hasFrame) return false;
        if (!(port.sender as any).origin) return false;

        const contentPage = !(port.sender as any)!.origin.startsWith('chrome-extension://') && !(port.sender as any)!.tab!.url?.startsWith('moz-extension://');
        return contentPage;
    }

    private addAgent(port: Runtime.Port, context: PorterContext) {
        console.log('PorterSource: Adding context agent. port and context: ', port, context);
        let adjustedContext = context;
        let index = 0;
        let subIndex;
        let connectContext: ConnectContext;
        if (context === PorterContext.Sidepanel && port.sender?.tab?.id !== undefined) {
            adjustedContext = PorterContext.Unknown;
        }
        if (port.sender && port.sender.tab !== undefined) {
            index = port.sender.tab.id || 0
            subIndex = port.sender?.frameId || 0;

            const tabAgents = Array.from(this.agents.keys())
                .filter(k => k.startsWith(`${adjustedContext}:${index}:`));

            if (tabAgents.length === 0) {
                connectContext = ConnectContext.NewTab;
            } else if (!tabAgents.includes(`${adjustedContext}:${index}:${subIndex}`)) {
                connectContext = ConnectContext.NewFrame;
            } else {
                connectContext = ConnectContext.RefreshConnection;
            }
        } else {
            index = (this.contextCounters.get(adjustedContext) || 0) + 1;
            this.contextCounters.set(adjustedContext, index + 1);
            connectContext = ConnectContext.NewAgent
        }

        const agentKey = this.getKey(adjustedContext, index, subIndex);
        console.log('PorterSource: Adding context agent, agentKey: ', agentKey);
        this.setupAgent(port, adjustedContext, agentKey, connectContext, { index, subIndex });
    }

    private setupAgent(port: Runtime.Port, porterContext: PorterContext, key: string, connectContext: ConnectContext, location: { index: number, subIndex?: number }) {
        const agent = { port, data: null };
        this.agents.set(key, agent);
        const agentMetadata = { key, connectionType: connectContext, context: porterContext, location }
        this.emit('onConnect', agentMetadata);
        port.onMessage.addListener((message: any) => this.handleMessage(message, agentMetadata));
        port.onDisconnect.addListener(() => this.handleDisconnect(agentMetadata));
    }

    private handleMessage(message: any, agentMetadata: AgentMetadata) {

        this.emitMessage({ ...agentMetadata, message })
    }
    private handleDisconnect(agentMetadata: AgentMetadata) {
        console.log('PorterSource, disconnected from agent: ', agentMetadata);
        this.emit('onDisconnect', agentMetadata);
        this.agents.delete(agentMetadata.key);
        if (!agentMetadata.location || !agentMetadata.location.subIndex) {
            this.reindexContextAgents(agentMetadata.context);
        }
    }

    private reindexContextAgents(context: PorterContext) {
        const relevantAgents = this.getAgentsByContext(context);
        relevantAgents.forEach((agent, index) => {
            const oldKey = Array.from(this.agents.entries()).find(([_, a]) => a === agent)?.[0];
            if (oldKey) {
                this.agents.delete(oldKey);
                const newKey = this.getKey(context, index);
                this.agents.set(newKey, agent);
            }
        });
        this.contextCounters.set(context, relevantAgents.length);
    }

    private getKey(context: PorterContext, index: number, subIndex?: number): string {
        console.log("PorterSurce: Getting key for context, index, subIndex: ", context, index, subIndex);
        return `${context}:${index}` + (subIndex ? `:${subIndex}` : '');
    }

    private isPorterContext(value: PorterContext | string): value is PorterContext {
        return Object.values(PorterContext).includes(value as PorterContext);
    }

    private printAgents() {
        console.log('PorterSource: Agents are: ', this.agents);
    }
}

export function source(porterNamespace: string = 'porter'): [
    (message: Message<any>, contextOrKey: PorterContext | string, location?: Partial<AgentLocation>) => void,
    (config: MessageConfig) => () => void,
    (listener: Listener<'onConnect'>) => () => void,
    (listener: Listener<'onDisconnect'>) => () => void,
] {
    const instance = PorterSource.getInstance(porterNamespace);
    return [
        instance.post.bind(instance),
        instance.onMessage.bind(instance),
        instance.onConnect.bind(instance),
        instance.onDisconnect.bind(instance),
    ];
}