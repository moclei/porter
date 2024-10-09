import browser, { Runtime } from 'webextension-polyfill';
import { AgentMetadata, ConnectContext, Listener, Message, MessageConfig, MessageListener, PorterEvent, PostTarget } from './porter.model';
import { Agent, PorterContext } from './porter.model';
import { isServiceWorker } from './porter.utils';

export class PorterSource {
    private static instance: PorterSource | null = null;
    private agents: Map<string, Agent> = new Map();
    private contextCounters: Map<PorterContext, number> = new Map();
    private listeners: Map<keyof PorterEvent, Set<Listener<keyof PorterEvent>>> = new Map();
    private messageListeners: Set<MessageListener> = new Set();
    private initializationHandler: MessageConfig = {
        'porter-messages-established': (message: Message<any>, agent) => {
            if (!agent || !agent.key) return;
            const agentMetadata = this.getMetadata(agent.key);
            if (!agentMetadata) return;
            this.instanceLog('internalHandlers, established message received: ', agent!.key, message);
            this.emit('onMessagesSet', agentMetadata);
        }
    };

    private constructor(private namespace: string = 'porter') {
        if (!isServiceWorker()) {
            this.warn('Constructor aborting: Can only create in a service worker');
        }
        this.log('Constructing');
        browser.runtime.onConnect.addListener(this.handleConnection.bind(this));
        this.onMessage(this.initializationHandler);
    }

    public static getInstance(namespace: string = 'porter'): PorterSource {
        console.log(`PorterSource [${namespace}-static-core] getting instance`);
        if (!PorterSource.instance || PorterSource.instance.namespace !== namespace) {
            console.log(`PorterSource [${namespace}-static-core] Creating new instance!`);
            PorterSource.instance = new PorterSource(namespace);
        } else {
            console.log(`PorterSource [${namespace}-static-core] Returning existing instance!`);
        }
        return PorterSource.instance;
    }

    public onConnect(listener: Listener<'onConnect'>) {
        return this.addListener('onConnect', listener);
    }

    public onMessagesSet(listener: Listener<'onMessagesSet'>) {
        return this.addListener('onMessagesSet', listener);
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
                    this.instanceLog('onMessage, calling handler. Message: ', event.key, event.message);
                    handler(event.message, { key: event.key, context: event.context, location: event.location });
                } else {
                    this.instanceLog('onMessage, no handler found. Message: ', event.key, event.message);
                }
            }
        }
        this.messageListeners.add(messageListener);

        return () => {
            this.messageListeners.delete(messageListener);
        };
    }

    // Dispatches incoming messages, either to a registered listener on the source, or to a specific agent
    // if a target was specified (calling this a relay)
    private emitMessage(messageEvent: PorterEvent['onMessage']) {
        this.instanceLog('Message heard: ', messageEvent.key, messageEvent.message);
        if (!!messageEvent.message.target) {
            this.instanceLog('Message had a relay target: ', messageEvent.key, messageEvent.message.target);
            // This is a relay message.
            const { context, location } = messageEvent.message.target;
            if (location) {
                this.post(messageEvent.message, { context: context as PorterContext, ...location });
            } else {
                this.post(messageEvent.message, { context: context as PorterContext });
            }
        }
        this.instanceLog('Message was to the service worker, notifying attached onMessage listeners. ', messageEvent.key);
        this.messageListeners.forEach(({ listener }) => listener(messageEvent as PorterEvent['onMessage']));
    }

    private emit<T extends keyof PorterEvent>(event: T, arg: PorterEvent[T]) {
        this.log('emit with arg ', arg);
        this.listeners.get(event)?.forEach(listener => (listener as Listener<T>)(arg));
    }

    public getAgent(options: {
        index?: number;
        subIndex?: number;
        context: PorterContext
    } = { context: PorterContext.ContentScript }): Agent | Agent[] | null {

        if (options.index === undefined) {
            this.log('Getting agent by prefix: ', options.context);
            // Return all agents for a context if no index provided. Defaults to content script.
            return this.getAgentsByPrefix(options.context);
        }
        if (options.context === PorterContext.ContentScript) {

            if (options.subIndex === undefined) {
                this.log('Getting agent by prefix: ', `${options.context}:${options.index}`);
                return this.getAgentsByPrefix(`${options.context}:${options.index}`);
            }

            // Return a specific content script agent
            this.log('Getting specific agent by prefix: ', `${options.context}:${options.index}:${options.subIndex}`);
            return this.agents.get(`${options.context}:${options.index}:${options.subIndex}`) || null;
        }
        // For non-ContentScript contexts, return the specific agent
        this.log('Getting specific agent by prefix: ', `${options.context}:${options.index}`);
        return this.agents.get(`${options.context}:${options.index}`) || null;
    }

    private getAgentsNames(): string[] {
        return Array.from(this.agents.keys());
    }

    private getAgentsMetadata(): AgentMetadata[] {
        return Array.from(this.agents.keys()).map(key => this.getMetadata(key)).filter(meta => meta !== null) as AgentMetadata[];
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

    private broadcastMessage(message: Message<any>): void {
        this.agents.forEach(agent => {
            if (agent.port) {
                agent.port.postMessage(message);
            }
        });
    }

    public post(message: Message<any>, target?: PostTarget): void {
        this.log('Post request received for message: ', message);
        if (target === undefined) {
            // Broadcast to all agents
            this.broadcastMessage(message);
        } else if (typeof target === 'number') {
            // Post to specific tab (content script at frameId 0)
            this.log('Posting to tab#: ', target);
            this.postToTab(message, target);
        } else if (typeof target === 'string') {
            // Post to specific agent by key
            this.log('Posting to agent with key: ', target);
            this.postToKey(message, target);
        } else {
            // Post based on options object
            this.log('Posting to target: ', target);
            this.postWithOptions(message, target);
        }
    }

    private postToTab(message: Message<any>, tabId: number): void {
        const key = `${PorterContext.ContentScript}:${tabId}:0`;
        this.postToKey(message, key);
    }

    // Requires a specified context. Since the other overloads from the public post method
    // assume a content-script context, this method can be inferred to be non-content-script.
    private postWithOptions(message: Message<any>, options: PostTarget & object): void {
        let key = this.getKey(options.context, options.index, options.subIndex);
        this.postToKey(message, key);
    }


    private postToKey(message: Message<any>, key: string): void {
        const agent = this.agents.get(key);
        if (agent?.port) {
            agent.port.postMessage(message);
        } else {
            this.warn(`No agent found for key: ${key}. Agents are: `, Array.from(this.agents.keys()));
        }
    }

    public getData(key: string): any {
        return this.agents.get(key)?.data || {};
    }

    public getMetadata(key: string): AgentMetadata | null {
        const agent = this.agents.get(key);
        if (!agent) return null;
        // based on the key being in the format `${context}:${index}` + (subIndex ? `:${subIndex}` : '') we want to return an object with context, index, and subIndex
        const [context, index, subIndex] = key.split(':');
        return {
            key,
            connectionType: ConnectContext.NewAgent, // Todo: this cannot be determined from the key. Should we bother trying to determine it?
            context: context as PorterContext,
            location: {
                index: parseInt(index),
                subIndex: subIndex ? parseInt(subIndex) : undefined
            }
        };
    }

    // Todo: Feels messy that we have both AgentMetadata and PostTarget. Should we consolidate?
    public getTarget(agentMetadata: AgentMetadata): PostTarget | null {
        return {
            context: agentMetadata.context as PorterContext,
            index: agentMetadata.location.index,
            subIndex: agentMetadata.location.subIndex ?? undefined
        }
    };

    public setData(key: string, data: any) {
        const agent = this.agents.get(key);
        if (agent) {
            agent.data = data;
        } else {
            this.warn('agent does not exist to set data on: ', key);
        }
    }

    private handleConnection(port: Runtime.Port) {
        this.log('Handling connection for port:', port.name);
        if (!port.name) {
            this.warn('Port name not provided');
            return;
        }
        const connectCtx = port.name.split('-');
        if (connectCtx.length < 2) {
            this.warn('Invalid port name (not a porter port)');
            return;
        }
        if (connectCtx[0] !== this.namespace) {
            this.warn('Namespace mismatch, ignoring connection');
            return;
        }
        this.log('Context of connection:', connectCtx);
        if (connectCtx.length === 3) {
            //Todo: Add relay connections
            this.warn('Relay connections not yet supported');
        } else if (connectCtx.length === 2) {
            this.addAgent(port, connectCtx[1] as PorterContext);
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
        let adjustedContext = context;
        let index = 0;
        let subIndex;
        let connectContext: ConnectContext;
        if (context === PorterContext.Sidepanel && port.sender?.tab?.id !== undefined) {
            this.log(`Adjusting the context to Unknown`);
            adjustedContext = PorterContext.Unknown;
        }
        if (port.sender && port.sender.tab !== undefined) {
            index = port.sender.tab.id || 0
            subIndex = port.sender?.frameId || 0;
            this.log(`Searching for agent with similar name: ${adjustedContext}:${index}`);
            const tabAgents = Array.from(this.agents.keys())
                .filter(k => k.startsWith(`${adjustedContext}:${index}:`));

            if (tabAgents.length === 0) {
                this.log(`No similar agents found, this is a new one.`);
                connectContext = ConnectContext.NewTab;
            } else if (!tabAgents.includes(`${adjustedContext}:${index}:${subIndex}`)) {
                this.log(`Similar parent agent found, calling this a new frame`);
                connectContext = ConnectContext.NewFrame;
            } else {
                this.log(`This exact agent name existed already, calling this a refreshed connection.`);
                connectContext = ConnectContext.RefreshConnection;
            }
        } else {
            this.log(`Adding agent that did not have a tab id`);
            index = (this.contextCounters.get(adjustedContext) || 0);
            this.contextCounters.set(adjustedContext, index + 1);
            connectContext = ConnectContext.NewAgent
        }
        const agentKey = this.getKey(adjustedContext, index, subIndex);
        this.instanceLog('Agent key determined. Moving on to setup', agentKey);
        this.setupAgent(port, adjustedContext, agentKey, connectContext, { index, subIndex });
    }

    private setupAgent(port: Runtime.Port, porterContext: PorterContext, key: string, connectContext: ConnectContext, location: { index: number, subIndex?: number }) {
        const agent = { port, data: null };
        this.agents.set(key, agent);
        const agentMetadata: AgentMetadata = { key, connectionType: connectContext, context: porterContext, location };
        this.instanceLog('Sending onConnect event to listeners. ', key);
        this.confirmConnection(port, agentMetadata);
        this.instanceLog('Adding onMessage and onDisconnect listeners. ', key);
        port.onMessage.addListener((message: any) => this.handleMessage(message, agentMetadata));
        port.onDisconnect.addListener(() => this.handleDisconnect(agentMetadata));
        this.instanceLog('Setup complete. ', key);
        this.emit('onConnect', agentMetadata);
    }

    private confirmConnection(port: Runtime.Port, agentMeta: AgentMetadata) {
        this.instanceLog('Sending confirmation message back to initiator ', agentMeta.key);
        port.postMessage({ action: 'porter-handshake', payload: { meta: agentMeta, currentConnections: this.getAgentsMetadata() } });
    }

    // Handles messages incomng from ports
    private handleMessage(message: any, agentMetadata: AgentMetadata) {
        this.emitMessage({ ...agentMetadata, message })
    }

    private handleDisconnect(agentMetadata: AgentMetadata) {
        this.instanceLog('Handling disconnected agent.', agentMetadata.key);
        this.emit('onDisconnect', agentMetadata);
        this.agents.delete(agentMetadata.key);
        this.instanceLog('Deleting agent agent.', agentMetadata.key);
        if (!agentMetadata.location || !agentMetadata.location.subIndex) {
            this.reindexContextAgents(agentMetadata.context);
        }
    }

    private reindexContextAgents(context: PorterContext) {
        this.log('Reindexing agents for context: ', context);
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


    // Todo: This is a standalone function, should be worked into getAgent
    public buildAgentKey(context: PorterContext, index: number, subIndex?: number): string {
        if (subIndex === undefined) {
            if (context === PorterContext.ContentScript) {
                return `${context}:${index}:0`;
            }
            return `${context}:${index}`;
        }
        // Return a specific content script agent
        return `${context}:${index}:${subIndex}`;
    }

    private getKey(context: PorterContext, index: number = 0, subIndex?: number): string {
        this.log("Getting key for context, index, subIndex: ", context, index, subIndex);
        return `${context}:${index}` + (subIndex !== undefined ? `:${subIndex}` : ':0');
    }

    private isPorterContext(value: PorterContext | string): value is PorterContext {
        return Object.values(PorterContext).includes(value as PorterContext);
    }

    private printAgents() {
        this.log('Agents are: ', this.agents);
    }

    private log(message: string, ...args: any[]) {
        console.log(`PorterSource [${this.namespace}-core]: ` + message, ...args);
    }
    private instanceLog(message: string, key: string, ...args: any[]) {
        console.log(`PorterSource [${this.namespace}-${key}], ` + message, ...args);
    }
    private error(message: string, ...args: any[]) {
        console.error(`PorterSource [${this.namespace}-core], ` + message, ...args);
    }
    private warn(message: string, ...args: any[]) {
        console.warn(`PorterSource [${this.namespace}-core], ` + message, ...args);
    }
}

export function source(namespace: string = 'porter'): [
    (message: Message<any>, target?: PostTarget) => void,
    (config: MessageConfig) => () => void,
    (listener: Listener<'onConnect'>) => () => void,
    (listener: Listener<'onDisconnect'>) => () => void,
    (listener: Listener<'onMessagesSet'>) => () => void,
] {
    const instance = PorterSource.getInstance(namespace);
    return [
        instance.post.bind(instance),
        instance.onMessage.bind(instance),
        instance.onConnect.bind(instance),
        instance.onDisconnect.bind(instance),
        instance.onMessagesSet.bind(instance)
    ];
}

export function getMetadata(key: string): AgentMetadata | null {
    return PorterSource.getInstance().getMetadata(key);
}

export function getTarget(agentMetadata: AgentMetadata): PostTarget | null {
    return PorterSource.getInstance().getTarget(agentMetadata);
}

export function getKey(options: {
    index: number;
    subIndex?: number;
    context: PorterContext
}): string | null {
    console.log("PorterSource: getKey called externally with options: ", options);
    return PorterSource.getInstance().buildAgentKey(options.context, options.index, options.subIndex);
}