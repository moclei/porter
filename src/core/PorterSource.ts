import browser, { Runtime } from 'webextension-polyfill';
import {
  AgentInfo,
  Listener,
  Message,
  MessageConfig,
  PorterError,
  PorterErrorType,
  BrowserLocation,
  Unsubscribe,
  AgentId,
  MessageTarget,
} from '../porter.model';
import { Agent } from '../porter.model';
import { isServiceWorker } from '../porter.utils';
import { Logger } from '../porter.utils';
import { AgentManager } from '../managers/AgentManager';
import { ConnectionManager } from '../managers/ConnectionManager';
import { MessageHandler } from '../managers/MessageHandler';

export interface PorterSourceOptions {
  namespace?: string;
  debug?: boolean;
}

export class PorterSource {
  private static instances: Map<string, PorterSource> = new Map();
  private readonly agentManager: AgentManager;
  private readonly messageHandler: MessageHandler;
  private readonly connectionManager: ConnectionManager;
  private readonly logger: Logger;
  private static staticLogger = Logger.getLogger('SW');
  private namespace: string;

  private constructor(namespace?: string, options?: PorterSourceOptions) {
    // Configure logger if debug option is provided
    if (options?.debug !== undefined) {
      Logger.configure({ enabled: options.debug });
    }

    this.logger = Logger.getLogger(`SW`);
    this.namespace = namespace || 'porter';
    if (!namespace) {
      this.logger.error('No namespace provided, defaulting to "porter"');
    }

    this.agentManager = new AgentManager(this.logger);
    this.messageHandler = new MessageHandler(this.agentManager, this.logger);
    this.connectionManager = new ConnectionManager(
      this.agentManager,
      this.namespace,
      this.logger
    );
    this.logger.info(`Constructing Porter with namespace: ${this.namespace}`);

    if (!isServiceWorker()) {
      throw new PorterError(
        PorterErrorType.INVALID_CONTEXT,
        'Can only create in a service worker'
      );
    }

    // Wire up event handlers
    this.agentManager.on(
      'agentMessage',
      (message: any, metadata: AgentInfo) => {
        this.messageHandler.handleIncomingMessage(message, metadata);
      }
    );

    this.agentManager.on('agentDisconnect', (metadata: AgentInfo) => {
      this.messageHandler.handleDisconnect(metadata);
    });

    this.agentManager.on('agentSetup', (agent: Agent) => {
      this.logger.debug(`Handling agent setup`, { agent });
      this.messageHandler.handleConnect(agent.info);
      this.connectionManager.confirmConnection(agent);
    });

    browser.runtime.onConnect.addListener(
      this.connectionManager.handleConnection.bind(this.connectionManager)
    );
  }

  public static getInstance(
    namespace: string = 'porter',
    options?: PorterSourceOptions
  ): PorterSource {
    PorterSource.staticLogger.debug(
      `Getting instance for namespace: ${namespace}`
    );
    if (!PorterSource.instances.has(namespace)) {
      PorterSource.staticLogger.info(
        `Creating new instance for namespace: ${namespace}`
      );
      PorterSource.instances.set(
        namespace,
        new PorterSource(namespace, options)
      );
    } else if (options?.debug !== undefined) {
      // If instance exists but debug setting changed, configure logger
      Logger.configure({ enabled: options.debug });
    }
    return PorterSource.instances.get(namespace)!;
  }

  // Public API methods that will be exposed via the source function
  public post(message: Message<any>, target?: MessageTarget): Promise<void> {
    return this.messageHandler.post(message, target);
  }

  public onMessage(config: MessageConfig): Unsubscribe {
    return this.messageHandler.onMessage(config);
  }

  public on(config: MessageConfig): Unsubscribe {
    return this.messageHandler.on(config);
  }

  public onConnect(listener: Listener<'onConnect'>): Unsubscribe {
    return this.messageHandler.onConnect(listener);
  }

  public onDisconnect(listener: Listener<'onDisconnect'>): Unsubscribe {
    return this.messageHandler.onDisconnect(listener);
  }

  public onMessagesSet(listener: Listener<'onMessagesSet'>): Unsubscribe {
    return this.messageHandler.onMessagesSet(listener);
  }

  // Utility methods that might be needed externally
  public getInfo(key: string): AgentInfo | null {
    return this.agentManager.getAgentById(key)?.info || null;
  }

  // Utility methods that might be needed externally
  public getAgentById(agentId: AgentId): Agent | null {
    return this.agentManager.getAgentById(agentId);
  }

  public getAgentByLocation(location: BrowserLocation): Agent | null {
    return this.agentManager.getAgentByLocation(location);
  }

  public queryAgents(location: Partial<BrowserLocation>): Agent[] {
    return this.agentManager.queryAgents(location);
  }
}

export interface PorterAPI {
  type: 'source';
  post: (message: Message<any>, target?: MessageTarget) => Promise<void>;
  onMessage: (config: MessageConfig) => Unsubscribe;
  on: (config: MessageConfig) => Unsubscribe;
  onConnect: (listener: Listener<'onConnect'>) => Unsubscribe;
  onDisconnect: (listener: Listener<'onDisconnect'>) => Unsubscribe;
  onMessagesSet: (listener: Listener<'onMessagesSet'>) => Unsubscribe;
  getAgentById: (id: AgentId) => Agent | null;
  getAgentByLocation: (location: BrowserLocation) => Agent | null;
  queryAgents: (location: Partial<BrowserLocation>) => Agent[];
}

export function source(
  namespace: string = 'porter',
  options?: PorterSourceOptions
): PorterAPI {
  const instance = PorterSource.getInstance(namespace, options);
  return {
    type: 'source',
    post: instance.post.bind(instance),
    onMessage: instance.onMessage.bind(instance),
    on: instance.on.bind(instance),
    onConnect: instance.onConnect.bind(instance),
    onDisconnect: instance.onDisconnect.bind(instance),
    onMessagesSet: instance.onMessagesSet.bind(instance),
    getAgentById: instance.getAgentById.bind(instance),
    getAgentByLocation: instance.getAgentByLocation.bind(instance),
    queryAgents: instance.queryAgents.bind(instance),
  };
}
