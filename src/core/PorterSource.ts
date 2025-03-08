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

export class PorterSource {
  private static instance: PorterSource | null = null;
  private readonly agentManager: AgentManager;
  private readonly messageHandler: MessageHandler;
  private readonly connectionManager: ConnectionManager;
  private readonly logger: Logger;
  private static staticLogger = Logger.getLogger('SW');

  private constructor(private namespace: string = 'porter') {
    this.logger = Logger.getLogger(`SW:${namespace}`);
    this.agentManager = new AgentManager(this.logger);
    this.messageHandler = new MessageHandler(this.agentManager, this.logger);
    this.connectionManager = new ConnectionManager(
      this.agentManager,
      this.namespace,
      this.logger
    );
    this.logger.info('Constructing Porter');

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

    this.agentManager.on('agentSetup', (agent: Agent, metadata: AgentInfo) => {
      this.messageHandler.handleConnect(metadata);
      this.connectionManager.confirmConnection(agent.port!, metadata);
    });

    browser.runtime.onConnect.addListener(
      this.connectionManager.handleConnection.bind(this.connectionManager)
    );
  }

  public static getInstance(namespace: string = 'porter'): PorterSource {
    PorterSource.staticLogger.debug(
      `Getting instance for namespace: ${namespace}`
    );
    if (
      !PorterSource.instance ||
      PorterSource.instance.namespace !== namespace
    ) {
      PorterSource.staticLogger.info(
        `Creating new instance for namespace: ${namespace}`
      );
      PorterSource.instance = new PorterSource(namespace);
    } else {
      PorterSource.staticLogger.debug(
        `Reusing existing instance for namespace: ${namespace}`
      );
    }
    return PorterSource.instance;
  }

  // Public API methods that will be exposed via the source function
  public post(message: Message<any>, target?: MessageTarget): Promise<void> {
    return this.messageHandler.post(message, target);
  }

  public onMessage(config: MessageConfig): Unsubscribe {
    return this.messageHandler.onMessage(config);
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
}
export function source(namespace: string = 'porter'): [
  // post function
  (message: Message<any>, target?: MessageTarget) => Promise<void>,
  // onMessage function
  (config: MessageConfig) => Unsubscribe,
  // onConnect function
  (listener: Listener<'onConnect'>) => Unsubscribe,
  // onDisconnect function
  (listener: Listener<'onDisconnect'>) => Unsubscribe,
  // onMessagesSet function
  (listener: Listener<'onMessagesSet'>) => Unsubscribe,
] {
  const instance = PorterSource.getInstance(namespace);
  return [
    instance.post.bind(instance),
    instance.onMessage.bind(instance),
    instance.onConnect.bind(instance),
    instance.onDisconnect.bind(instance),
    instance.onMessagesSet.bind(instance),
  ];
}

export function getAgentById(id: AgentId): Agent | null {
  return PorterSource.getInstance().getAgentById(id);
}
