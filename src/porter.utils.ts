import { Runtime } from 'webextension-polyfill';

function isServiceWorker() {
  return (
    typeof ServiceWorkerGlobalScope !== 'undefined' &&
    self instanceof ServiceWorkerGlobalScope
  );
}

function isValidPort(
  port: Runtime.Port
): port is Runtime.Port & {
  sender: Runtime.MessageSender & { tab: { id: number }; frameId: number };
} {
  return !!port && !!port.sender && isValidSender(port.sender);
}

function isValidSender(
  sender: Runtime.MessageSender
): sender is Runtime.MessageSender & { tab: { id: number }; frameId: number } {
  return !(
    !sender ||
    !sender.tab ||
    sender.frameId === undefined ||
    sender.tab.id === undefined
  );
}

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

export class Logger {
  private static level: LogLevel = LogLevel.TRACE;
  private static enabled: boolean = true;
  private static instances: Map<string, Logger> = new Map();

  static setLevel(level: LogLevel) {
    Logger.level = level;
  }

  static setEnabled(enabled: boolean) {
    Logger.enabled = enabled;
  }

  // Factory method to get or create logger instance
  static getLogger(context: string): Logger {
    if (!this.instances.has(context)) {
      this.instances.set(context, new Logger(context));
    }
    return this.instances.get(context)!;
  }

  private constructor(private context: string) {}

  error(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.ERROR) {
      console.error(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.WARN) {
      console.warn(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.INFO) {
      console.log(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.DEBUG) {
      console.log(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  trace(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.TRACE) {
      console.log(`[Porter:${this.context}] ${message}`, ...args);
    }
  }
}

export { isValidPort, isValidSender, isServiceWorker };
