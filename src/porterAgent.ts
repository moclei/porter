import browser, { Extension, Runtime } from 'webextension-polyfill';
import { Agent, Message, MessageConfig, PorterContext } from './porter.model';
import { log } from './porter.utils';

export class PorterAgent {
    private agent: Agent;
    private config: MessageConfig | null;
    constructor(private agentContext: PorterContext, private porterNamespace: string = 'porter',) {
        const name = this.porterNamespace + (this.agentContext === PorterContext.ContentScript ? '' : '-' + this.agentContext);
        const port = browser.runtime.connect({ name });
        this.config = null;
        this.agent = { port, data: {} };
        port.onMessage.addListener((message: any) => this.handleMessage(port, message));
        port.onDisconnect.addListener(() => this.handleDisconnect(port));
    }

    public onMessage(config: MessageConfig) {
        this.config = config;
    }

    public post(message: Message<any>) {
        if (!this.agent.port) {
            console.warn('Porter: No port available to post message');
            return;
        }
        this.agent.port.postMessage(message);
    }

    public getPort(): Runtime.Port | undefined {
        return this.agent.port;
    }

    private handleMessage(port: Runtime.Port, message: any) {
        console.warn('Porter: handleMessage ', message, port);
        if (!this.config) {
            console.warn('Porter: No message handler configured');
            return;
        }

        log(port, message);
        const action = message.action;
        const handler = this.config[action];

        if (handler) {
            handler(message, port);
        } else {
            log(port, { action: 'error', payload: `No handler for action: ${action}` });
        }
    }

    private handleDisconnect(port: Runtime.Port) {
        log(port, { action: 'disconnect', payload: `Porter: Disconnected from ${port.name}` });
        delete this.agent.port;
    }
}