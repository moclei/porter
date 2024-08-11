import browser, { Runtime } from 'webextension-polyfill';
import { ConnectContext, Message, PorterEvents } from './porter.model';
import { Agent, MessageConfig, PorterContext, PortDetails } from './porter.model';
import { EventEmitter, getPortDetails, isServiceWorker, isValidPort, log } from './porter.utils';

export class PorterSource {
    private agents: Map<string, Agent> = new Map();
    private contextCounters: Map<PorterContext, number> = new Map();
    private config: MessageConfig | null = null;
    private eventEmitter = new EventEmitter<PorterEvents>();

    public onConnect = {
        addListener: (listener: (arg: PorterEvents['onConnect']) => void) => this.eventEmitter.addListener('onConnect', listener),
        removeListener: (listener: (arg: PorterEvents['onConnect']) => void) => this.eventEmitter.removeListener('onConnect', listener),
    };
    public onDisconnect = {
        addListener: (listener: (arg: PorterEvents['onDisconnect']) => void) => this.eventEmitter.addListener('onDisconnect', listener),
        removeListener: (listener: (arg: PorterEvents['onDisconnect']) => void) => this.eventEmitter.removeListener('onDisconnect', listener),
    }

    constructor(private porterNamespace: string = 'porter') {
        if (!isServiceWorker()) {
            console.warn('PorterSource: Can only create porter source in service worker');
        }
        browser.runtime.onConnect.addListener(this.handleConnection.bind(this));
    }

    public getAgent(agentCtx: PorterContext): Agent | null {
        return this.agents.get(agentCtx) || null;
    }

    public getAgentsByContext(context: PorterContext): Agent[] {
        console.log(`PorterSource: Getting agents by 'context:${context}:'`);
        const entries = Array.from(this.agents.entries())
            .filter(([key, _]) => key.startsWith(`context:${context}:`));
        console.log(`PorterSource: agent entries are: ${entries}`);
        return Array.from(this.agents.entries())
            .filter(([key, _]) => key.startsWith(`context:${context}:`))
            .map(([_, agent]) => agent);
    }

    public onMessage(config: MessageConfig) {
        this.config = config;
    }


    public post(message: Message<any>, target: PorterContext, details?: number | { tabId: number; frameId: number },) {
        console.log('PorterSource: Posting message to', target);
        switch (target) {
            case PorterContext.ContentScript:
                this.postToContentScript(message, details as { tabId: number; frameId: number });
                break;
            case PorterContext.Sidebar:
            case PorterContext.Devtools:
            case PorterContext.Popup:
            case PorterContext.Options:
                this.postToContext(message, target, details as number | undefined);
                break;
            default:
                console.warn('PorterSource: Invalid target', target);
                break;
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
        const connectCtx = port.name.split('-');
        console.log('Connect context:', connectCtx);
        if (connectCtx.length > 2) {
            console.warn('PorterSource: Invalid port name');
            return;
        }
        if (connectCtx.length > 1) {
            this.addContextAgent(port, connectCtx[1] as PorterContext);
        } else if (port.name === this.porterNamespace) {
            this.addContentScriptAgent(port);
        }
    }

    private addContextAgent(port: Runtime.Port, context: PorterContext) {
        console.log('PorterSource: Adding context agent');
        const counter = (this.contextCounters.get(context) || 0) + 1;
        this.contextCounters.set(context, counter);

        const key = this.getContextKey(context, counter - 1);
        console.log('PorterSource: Adding context agent, key: ', key);
        const connectContext = ConnectContext.NewAgent;

        this.setupAgent(port, context, key, connectContext);
    }

    private addContentScriptAgent(port: Runtime.Port) {
        //  console.log('PorterSource: Adding content script agent');
        const tabId = port.sender?.tab?.id || 0;
        const frameId = port.sender?.frameId || 0;
        const key = this.getContentScriptKey(tabId, frameId);
        // console.log('PorterSource: Adding content script agent, key: ', key);
        let connectContext;

        const tabAgents = Array.from(this.agents.keys())
            .filter(k => k.startsWith(`contentscript:${tabId}:`));

        if (tabAgents.length === 0) {
            connectContext = ConnectContext.NewTab;
        } else if (!tabAgents.includes(key)) {
            connectContext = ConnectContext.NewFrame;
        } else {
            connectContext = ConnectContext.RefreshConnection;
        }

        this.setupAgent(port, PorterContext.ContentScript, key, connectContext);
    }

    private setupAgent(port: Runtime.Port, porterContext: PorterContext, key: string, connectContext: ConnectContext) {
        const agent = { port, data: null };
        this.agents.set(key, agent);

        this.eventEmitter.emit('onConnect', { connectContext, porterContext, portDetails: getPortDetails(port.sender!) });
        port.onMessage.addListener((message: any) => this.handleMessage(port, message));
        port.onDisconnect.addListener(() => {
            log(port, { action: 'disconnect', payload: `Porter: Disconnected from ${port.name}` });
            this.eventEmitter.emit('onDisconnect', undefined);
            this.agents.delete(key);
            if (porterContext !== PorterContext.ContentScript) {
                this.reindexContextAgents(porterContext);
            }
        });
    }

    private reindexContextAgents(context: PorterContext) {
        const relevantAgents = this.getAgentsByContext(context);
        relevantAgents.forEach((agent, index) => {
            const oldKey = Array.from(this.agents.entries()).find(([_, a]) => a === agent)?.[0];
            if (oldKey) {
                this.agents.delete(oldKey);
                const newKey = this.getContextKey(context, index);
                this.agents.set(newKey, agent);
            }
        });
        this.contextCounters.set(context, relevantAgents.length);
    }

    private handleMessage(port: Runtime.Port, message: any) {
        if (!this.config) {
            console.warn('PorterSource: No message handler configured');
            return;
        }
        if (!port.sender) {
            console.warn('PorterSource: Message heard from unknown sender');
            return;
        }
        log(port, message);
        const action = message.action;
        const handler = this.config[action];

        if (!isValidPort(port) && isServiceWorker()) {
            console.warn('PorterSource: Invalid port', port);
            return;
        }
        const senderDetails = getPortDetails(port.sender);
        if (handler) {
            handler(message, port, senderDetails);
        } else {
            log(port, { action: 'error', payload: `No handler for action: ${action}` });
        }
    }

    private postToContentScript(message: Message<any>, details: { tabId: number; frameId: number }) {
        console.log('PorterSource: posting to content script');
        const { tabId, frameId } = details;
        const relevantAgents = Array.from(this.agents.entries()).filter(([key, _]) => key.startsWith(`${PorterContext.ContentScript}:${tabId}:`));

        if (frameId !== undefined) {
            const agent = this.agents.get(`${PorterContext.ContentScript}:${tabId}:${frameId}`);
            if (agent?.port) {
                agent.port.postMessage(message);
            } else {
                console.warn(`No agent found for tab ${tabId}, frame ${frameId}`);
            }
        } else {
            relevantAgents.forEach(([_, agent]) =>
                agent.port?.postMessage(message));
        }
    }

    private postToContext(message: Message<any>, target: PorterContext, index?: number) {
        console.log('PorterSource: posting to context', target);
        const relevantAgents = this.getAgentsByContext(target);
        console.log('PorterSource: relevantAgents', relevantAgents);
        console.log('PorterSource: all agents', Array.from(this.agents.entries()));
        if (index !== undefined) {
            if (index < relevantAgents.length) {
                relevantAgents[index].port?.postMessage(message);
            } else {
                console.warn(`No agent found for ${target} at index ${index}`);
            }
        } else {
            relevantAgents.forEach(agent => agent.port?.postMessage(message));
        }
    }

    private getContextKey(context: PorterContext, index: number) {
        return `context:${context}:${index}`;
    }

    private getContentScriptKey(tabId: number, frameId: number): string {
        return `contentscript:${tabId}:${frameId}`;
    }
}