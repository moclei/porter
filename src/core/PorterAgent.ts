import {
  AgentInfo,
  BrowserLocation,
  Message,
  MessageConfig,
  PorterContext,
  Unsubscribe,
} from '../porter.model';
import {
  AgentConnectionManager,
  DisconnectCallback,
  ReconnectCallback,
} from '../managers/AgentConnectionManager';
import { AgentMessageHandler } from '../managers/AgentMessageHandler';
import { Logger } from '../porter.utils';

export interface AgentAPI {
  type: 'agent';
  post: (message: Message<any>, target?: BrowserLocation) => void;
  onMessage: (config: MessageConfig) => void;
  on: (config: MessageConfig) => void;
  getAgentInfo: () => AgentInfo | null;
  onDisconnect: (callback: DisconnectCallback) => Unsubscribe;
  onReconnect: (callback: ReconnectCallback) => Unsubscribe;
}

export interface PorterAgentOptions {
  agentContext?: PorterContext;
  namespace?: string;
  debug?: boolean;
}

export class PorterAgent {
  private static instance: PorterAgent | null = null;
  private readonly connectionManager: AgentConnectionManager;
  private readonly messageHandler: AgentMessageHandler;
  private readonly logger: Logger;

  private constructor(options: PorterAgentOptions = {}) {
    const namespace = options.namespace ?? 'porter';
    const context = options.agentContext ?? this.determineContext();

    if (options.debug !== undefined) {
      Logger.configure({ enabled: options.debug });
    }

    this.logger = Logger.getLogger('Agent');

    this.connectionManager = new AgentConnectionManager(namespace, this.logger);
    this.messageHandler = new AgentMessageHandler(this.logger);

    // Listen for reconnection events to re-wire port listeners
    this.connectionManager.onReconnect((info) => {
      this.logger.info('Reconnected, re-wiring port listeners', { info });
      this.setupPortListeners();
    });

    this.logger.info('Initializing with options: ', { options, context });
    this.initializeConnection();
  }

  public static getInstance(options: PorterAgentOptions = {}): PorterAgent {
    if (
      !PorterAgent.instance ||
      PorterAgent.instance.connectionManager.getNamespace() !==
        options.namespace
    ) {
      PorterAgent.instance = new PorterAgent(options);
    } else if (options.debug !== undefined) {
      Logger.configure({ enabled: options.debug });
    }
    return PorterAgent.instance;
  }

  private async initializeConnection(): Promise<void> {
    await this.connectionManager.initializeConnection();
    this.setupPortListeners();
  }

  /**
   * Set up message and disconnect listeners on the current port.
   * Called after initial connection and after each reconnection.
   */
  private setupPortListeners(): void {
    const port = this.connectionManager.getPort();
    if (port) {
      this.logger.debug('Setting up port listeners');
      port.onMessage.addListener((message: any) =>
        this.messageHandler.handleMessage(port, message)
      );
      port.onDisconnect.addListener((p) =>
        this.connectionManager.handleDisconnect(p)
      );
    } else {
      this.logger.warn('Cannot setup port listeners: no port available');
    }
  }

  public onMessage(config: MessageConfig) {
    this.messageHandler.onMessage(config);
    const port = this.connectionManager.getPort();
    port?.postMessage({ action: 'porter-messages-established' });
  }

  public on(config: MessageConfig) {
    this.messageHandler.on(config);
    const port = this.connectionManager.getPort();
    port?.postMessage({ action: 'porter-messages-established' });
  }

  public post(message: Message<any>, target?: BrowserLocation) {
    const port = this.connectionManager.getPort();
    this.logger.debug('Posting message', { message, target, port });

    if (port) {
      try {
        this.messageHandler.post(port, message, target);
      } catch (error) {
        this.logger.error('Failed to post message, queueing for retry', {
          error,
        });
        this.connectionManager.queueMessage(message, target);
      }
    } else {
      this.logger.debug('No port found, queueing message', { message, target });
      this.connectionManager.queueMessage(message, target);
    }
  }

  private determineContext(): PorterContext {
    if (!window.location.protocol.includes('extension')) {
      return PorterContext.ContentScript;
    }
    return PorterContext.Extension;
  }

  public getAgentInfo(): AgentInfo | null {
    return this.connectionManager.getAgentInfo() || null;
  }

  /**
   * Register a callback to be called when the connection to the service worker is lost
   * @returns Unsubscribe function
   */
  public onDisconnect(callback: DisconnectCallback): Unsubscribe {
    return this.connectionManager.onDisconnect(callback);
  }

  /**
   * Register a callback to be called when reconnection to the service worker succeeds
   * @returns Unsubscribe function
   */
  public onReconnect(callback: ReconnectCallback): Unsubscribe {
    return this.connectionManager.onReconnect(callback);
  }
}

export function connect(options?: PorterAgentOptions): AgentAPI {
  const porterInstance = PorterAgent.getInstance(options);
  return {
    type: 'agent',
    post: porterInstance.post.bind(porterInstance),
    onMessage: porterInstance.onMessage.bind(porterInstance),
    on: porterInstance.on.bind(porterInstance),
    getAgentInfo: porterInstance.getAgentInfo.bind(porterInstance),
    onDisconnect: porterInstance.onDisconnect.bind(porterInstance),
    onReconnect: porterInstance.onReconnect.bind(porterInstance),
  };
}
