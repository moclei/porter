import browser, { Runtime } from 'webextension-polyfill';
import { Message } from './porter.model';
import { Agent, MessageConfig, PorterContext, PortDetails } from './porter.model';
import { getPortDetails, isServiceWorker, isValidPort, log } from './porter.utils';

export class PorterSource {
    private ports: {
        [tabId: number]: {
            [frameId: number]: Agent;
        };
    } = {};
    private sidebarAgent: Agent | null = null;
    private devtoolsAgent: Agent | null = null;
    private popupAgent: Agent | null = null;
    private optionsAgent: Agent | null = null;
    private config: MessageConfig | null = null;
    constructor(private porterNamespace: string = 'porter') {
        if (!isServiceWorker()) {
            console.warn('PorterSource: Can only create porter source in service worker');
        }
        browser.runtime.onConnect.addListener((port: Runtime.Port) => {
            if (!port.name) {
                console.warn('PorterSource: Port name not provided');
                return;
            }
            const connectCtx = port.name.split('-');
            if (connectCtx.length > 2) {
                console.warn('PorterSource: Invalid port name');
                return;
            }
            if (connectCtx.length > 1) {
                this.addAgent(port, connectCtx);
            } else if (port.name === this.porterNamespace) {
                this.addPort(port);
            }
        });
    }
    public getAgent(agentCtx: PorterContext): Agent | null {
        switch (agentCtx) {
            case PorterContext.Sidebar:
                return this.sidebarAgent;
            case PorterContext.Devtools:
                return this.devtoolsAgent;
            case PorterContext.Popup:
                return this.popupAgent;
            case PorterContext.Options:
                return this.optionsAgent;
            default:
                return null;
        }
    }

    public getPort(portDetails: { tabId: number; frameId: number } = { tabId: 0, frameId: 0 }): Runtime.Port | undefined {
        if (!this.frameExists(portDetails)) {
            console.warn('PorterSource: Frame does not exist with details', portDetails);
            return;
        }
        return this.ports[portDetails.tabId][portDetails.frameId].port;
    }

    public onMessage(config: MessageConfig) {
        this.config = config;
    }

    public post(portDetails: { tabId: number; frameId: number } | PorterContext, message: Message<any>) {
        if (portDetails instanceof Object) {
            const port = this.getPort(portDetails);
            if (port) {
                port.postMessage(message);
            } else {
                console.warn('PorterSource: No port found for context', portDetails);
            }
        } else {
            const agent = this.getAgent(portDetails);
            if (agent) {
                agent.port?.postMessage(message);
            } else {
                console.warn('PorterSource: No agent found for context', portDetails);
            }
        }
    }

    public getData(details: PortDetails): any {
        const { tabId, frameId } = details;
        if (!this.frameExists({ tabId, frameId })) {
            console.warn('PorterSource: Frame does not exist with details', details);
            return {};
        }
        return this.ports[details.tabId][details.frameId].data;
    }

    public setData(details: PortDetails, data: any) {
        const { tabId, frameId } = details;
        if (!this.frameExists({ tabId, frameId })) {
            console.warn('PorterSource: Frame does not exist with details', details);
            return;
        }
        this.ports[details.tabId][details.frameId].data = data;
    }

    private addPort(port: Runtime.Port) {
        const isValid = isValidPort(port);
        let tabId = 0;
        if (isValid) {
            tabId = port.sender?.tab.id;
            const frameId = port.sender?.frameId;
            if (!this.ports[tabId]) {
                log(port, { action: 'New Tab connect', payload: `Porter: Connected to tab ${tabId}` });
                this.ports[tabId] = { [frameId as number]: { port, data: null } };
            } else if (this.ports[tabId] && !this.ports[tabId].hasOwnProperty(frameId)) {
                const existing = this.ports[tabId][frameId];
                log(port, { action: 'Refresh tab', payload: `Porter: Refreshed with existing: ${existing}` });
                this.ports[tabId][frameId] = { ...existing, port: port };
            } else {
                const url = new URL(port.sender?.url || '');
                const host = url.host;
                log(port, { action: 'New frame connect', payload: `Porter: Connected to frame ${frameId} in tab ${tabId} at ${host}` });
                this.ports[tabId][frameId] = { port, data: null };
            }
        } else {
            tabId = 0;
            this.ports[tabId] = { [0]: { port, data: null } };
        }
        port.onMessage.addListener((message: any) => this.handleMessage(port, message));
        port.onDisconnect.addListener(() => {
            log(port, { action: 'disconnect', payload: `Porter: Disconnected from ${port.name}` });
            delete this.ports[tabId];
        });
    }

    private addAgent(port: Runtime.Port, connectCtx: string[]) {
        const agentCtx = connectCtx[1];
        const agent = this.connectAgent(port, agentCtx);

        port.onMessage.addListener((message: any) => this.handleMessage(port, message));
        port.onDisconnect.addListener(() => {
            log(port, { action: 'disconnect', payload: `Porter: Disconnected from ${port.name}` });
            delete agent.port;
        });
    }

    private connectAgent(port: Runtime.Port, agentCtx: string): Agent {
        let agent: Agent;
        switch (agentCtx) {
            case PorterContext.Sidebar:
                agent = this.sidebarAgent = { port, data: null };
                break;
            case PorterContext.Devtools:
                agent = this.devtoolsAgent = { port, data: null };
                break;
            case PorterContext.Popup:
                agent = this.popupAgent = { port, data: null };
                break;
            case PorterContext.Options:
                agent = this.optionsAgent = { port, data: null };
                break;
            default:
                agent = { port, data: null };
                break;
        }
        return agent;
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

    private frameExists(details: { tabId: number; frameId: number }): boolean {
        if (!this.ports || !this.ports[details.tabId] || !this.ports[details.tabId][details.frameId]) {
            return false;
        }
        return true;
    }
}