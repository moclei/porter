import { Runtime } from "webextension-polyfill";

function isServiceWorker() {
    return !self.window || self.window.hasOwnProperty('ServiceWorkerGlobalScope');
}

function isValidPort(port: Runtime.Port): port is Runtime.Port & { sender: Runtime.MessageSender & { tab: { id: number }; frameId: number } } {
    return !!port && !!port.sender && isValidSender(port.sender);
}

function isValidSender(sender: Runtime.MessageSender): sender is Runtime.MessageSender & { tab: { id: number }; frameId: number } {
    return !(!sender || !sender.tab || sender.frameId === undefined || sender.tab.id === undefined);
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

export { isValidPort, isValidSender, isServiceWorker };