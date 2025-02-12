import { Runtime } from 'webextension-polyfill';

function isServiceWorker() {
  return (
    typeof ServiceWorkerGlobalScope !== 'undefined' &&
    self instanceof ServiceWorkerGlobalScope
  );
}

function isValidPort(port: Runtime.Port): port is Runtime.Port & {
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

export interface LoggerOptions {
  level?: LogLevel;
  enabled?: boolean;
}

export class Logger {
  private static level: LogLevel = Logger.getLevel();
  private static enabled: boolean = true;
  private static instances: Map<string, Logger> = new Map();
  private static globalOptions?: LoggerOptions;

  private static getLevel(): LogLevel {
    if (Logger.globalOptions?.level !== undefined) {
      return Logger.globalOptions.level;
    }
    const isProd =
      process?.env?.NODE_ENV === 'production' ||
      process?.env?.PORTER_ENV === 'production';
    return isProd ? LogLevel.WARN : LogLevel.TRACE;
  }
  // Add a configure method to set global options
  static configure(options: LoggerOptions) {
    Logger.globalOptions = options;
    if (options.level !== undefined) {
      Logger.level = options.level;
    }
    if (options.enabled !== undefined) {
      Logger.enabled = options.enabled;
    }
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
      console.info(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.DEBUG) {
      console.debug(`[Porter:${this.context}] ${message}`, ...args);
    }
  }

  trace(message: string, ...args: any[]) {
    if (!Logger.enabled) return;
    if (Logger.level >= LogLevel.TRACE) {
      console.trace(`[Porter:${this.context}] ${message}`, ...args);
    }
  }
}

export { isValidPort, isValidSender, isServiceWorker };
