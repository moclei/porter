import { Runtime } from "webextension-polyfill";
import { PortDetails } from "./porter.model";
import exp from "constants";

function isServiceWorker() {
    return !self.window || self.window.hasOwnProperty('ServiceWorkerGlobalScope');
}

function getPortDetails(sender: Runtime.MessageSender): PortDetails {
    if (isValidSender(sender)) {
        return {
            tabId: sender.tab.id,
            frameId: sender.frameId,
            url: sender.url,
            tag: sender.tab.id + '-' + sender.frameId
        };
    }
    return {
        tabId: -1,
        frameId: -1,
        url: '',
        tag: 'sender unknown'
    };
}

function isValidPort(port: Runtime.Port): port is Runtime.Port & { sender: Runtime.MessageSender & { tab: { id: number }; frameId: number } } {
    return !!port && !!port.sender && isValidSender(port.sender);
}

function isValidSender(sender: Runtime.MessageSender): sender is Runtime.MessageSender & { tab: { id: number }; frameId: number } {
    return !(!sender || !sender.tab || sender.frameId === undefined || sender.tab.id === undefined);
}

function log(port: Runtime.Port, message: any) {
    if (port.sender?.tab && port.sender.tab.id !== undefined && port.sender.frameId !== undefined) {
        let messageStr = `Porter: [${port.sender.tab.id}-${port.sender.frameId}] *${message.action}*`;
        if (message.payload) {
            messageStr += `, payload: ${JSON.stringify(message.payload)}`;
        }
        console.info(messageStr);
    } else {
        console.info(`Porter: *${message.action}*, payload: ${JSON.stringify(message.payload)}`);
    }
}

export class EventEmitter<T> {
    private listeners: { [K in keyof T]?: ((arg: T[K]) => void)[] } = {};

    addListener<K extends keyof T>(event: K, listener: (arg: T[K]) => void): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event]!.push(listener);
    }

    removeListener<K extends keyof T>(event: K, listener: (arg: T[K]) => void): void {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event]!.filter(l => l !== listener);
    }

    emit<K extends keyof T>(event: K, arg: T[K]): void {
        if (!this.listeners[event]) return;
        this.listeners[event]!.forEach(listener => listener(arg));
    }
}

export { getPortDetails, log, isValidPort, isValidSender, isServiceWorker };