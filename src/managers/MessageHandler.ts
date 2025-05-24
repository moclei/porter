import { Runtime } from 'webextension-polyfill';
import { AgentOperations } from './AgentManager';
import {
  PorterEvent,
  Listener,
  MessageListener,
  Message,
  PorterErrorType,
  MessageConfig,
  PorterContext,
  PorterError,
  AgentInfo,
  MessageTarget,
  BrowserLocation,
  AgentId,
} from '../porter.model';
import { Logger } from '../porter.utils';

export class MessageHandler {
  private eventListeners: Map<
    keyof PorterEvent,
    Set<Listener<keyof PorterEvent>>
  > = new Map();
  private messageListeners: Set<MessageListener> = new Set();
  private initializationHandler: MessageConfig;

  constructor(
    private agentOperations: AgentOperations,
    private logger: Logger
  ) {
    this.initializationHandler = {
      'porter-messages-established': (
        message: Message<any>,
        agent?: AgentInfo
      ) => {
        if (!agent || !agent.id) return;
        const agentInfo = this.agentOperations.getAgentById(agent.id)?.info;
        if (!agentInfo) {
          this.logger.error('No agent info found for agent id: ', agent.id);
          return;
        }
        this.logger.debug(
          'internalHandlers, established message received: ',
          agent.id,
          message
        );
        this.emitEvent('onMessagesSet', agentInfo);
      },
    };
  }

  public async post(
    message: Message<any>,
    target?: MessageTarget
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.logger.debug('Post request received:', {
          action: message.action,
          target,
        });

        const timeoutId = setTimeout(() => {
          const error = new Error('Message posting timed out');
          this.logger.error('Post timeout:', error);
          reject(error);
        }, 5000);

        if (target === undefined) {
          this.broadcastMessage(message);
          // how to tell if target is BrowserLocation type?
        } else if (isBrowserLocation(target)) {
          this.postToLocation(message, target);
        } else if (isPorterContext(target)) {
          this.postToContext(message, target);
        } else if (typeof target === 'string') {
          this.postToId(message, target);
        } else {
          this.postToTab(message, target);
        }

        clearTimeout(timeoutId);
        resolve();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to post message:', errorMessage);
        reject(new Error(`Failed to post message: ${errorMessage}`));
      }
    });
  }

  private broadcastMessage(message: Message<any>): void {
    this.logger.info('Broadcasting message to all agents: ', message);
    this.agentOperations.getAllAgents().forEach((agent) => {
      if (agent.port) {
        agent.port.postMessage(message);
      }
    });
  }

  // Post to all frames in a tab
  private postToTab(message: Message<any>, tabId: number): void {
    // const key = `${PorterContext.ContentScript}:${tabId}:0`;
    const agents = this.agentOperations.queryAgents({
      context: PorterContext.ContentScript,
      tabId,
    });
    if (agents.length === 0) {
      this.logger.warn('post: No agents found for tab: ', tabId);
      throw new PorterError(
        PorterErrorType.MESSAGE_FAILED,
        `Failed to post message to tabId ${tabId}`,
        { originalError: message }
      );
      return;
    }
    agents.forEach((agent) => {
      if (agent.port) {
        this.postToPort(message, agent.port);
      }
    });
  }

  private postToLocation(
    message: Message<any>,
    location: BrowserLocation
  ): void {
    const agents = this.agentOperations.queryAgents(location);
    agents.forEach((agent) => {
      if (!agent.port) {
        throw new PorterError(
          PorterErrorType.INVALID_TARGET,
          `No port found for agent`,
          { agentInfo: agent.info }
        );
        return;
      }
      this.postToPort(message, agent.port);
    });
  }

  private postToContext(message: Message<any>, context: PorterContext): void {
    const agents = this.agentOperations.queryAgents({
      context,
    });
    agents.forEach((agent) => {
      if (!agent.port) {
        throw new PorterError(
          PorterErrorType.INVALID_TARGET,
          `No port found for agent`,
          { agentInfo: agent.info }
        );
        return;
      }
      this.postToPort(message, agent.port);
    });
  }

  private postToPort(message: Message<any>, port: Runtime.Port): void {
    try {
      port.postMessage(message);
    } catch (error) {
      throw new PorterError(
        PorterErrorType.MESSAGE_FAILED,
        `Failed to post message to port`,
        { originalError: error, message }
      );
    }
  }

  private postToId(message: Message<any>, agentId: AgentId): void {
    const agent = this.agentOperations.getAgentById(agentId);
    if (!agent?.port) {
      throw new PorterError(
        PorterErrorType.INVALID_TARGET,
        `No agent found for key: ${agentId}`
      );
    }
    this.postToPort(message, agent.port);
  }

  public onMessage(config: MessageConfig) {
    // Optionally: Check for existing listeners with same config
    const existingListener = Array.from(this.messageListeners).find(
      (listener) => JSON.stringify(listener.config) === JSON.stringify(config)
    );

    if (existingListener) {
      this.logger.warn(
        `Listener with same config already exists: ${JSON.stringify(config)}`
      );
    }

    const messageListener: MessageListener = {
      config,
      listener: (event: PorterEvent['onMessage']) => {
        const handler = config[event.message.action];
        if (handler) {
          this.logger.debug('onMessage, calling handler ', { event });
          const { message, ...info } = event;
          handler(message, info);
        } else {
          this.logger.debug('onMessage, no handler found ', { event });
        }
      },
    };
    this.messageListeners.add(messageListener);

    return () => {
      this.messageListeners.delete(messageListener);
    };
  }

  // Adding new 'on' method that works the same way as onMessage
  public on(config: MessageConfig) {
    return this.onMessage(config);
  }

  // Handles messages incomng from ports
  public handleIncomingMessage(message: any, info: AgentInfo) {
    this.logger.debug(`Received message`, {
      message,
      info,
    });

    this.emitMessage({ ...info, message });
  }

  private emitEvent<T extends keyof PorterEvent>(
    event: T,
    arg: PorterEvent[T]
  ) {
    this.logger.debug('emitting event: ', event, arg);
    this.eventListeners
      .get(event)
      ?.forEach((listener) => (listener as Listener<T>)(arg));
  }

  // Dispatches incoming messages, either to a registered listener on the source, or to a specific agent
  // if a target was specified (calling this a relay)
  private emitMessage(messageEvent: PorterEvent['onMessage']) {
    this.logger.debug('Dispatching incoming message to subscribers', {
      messageEvent,
    });

    if (messageEvent.message.action.startsWith('porter-')) {
      const handler = this.initializationHandler[messageEvent.message.action];
      if (handler) {
        this.logger.debug('Internal message being handled', {
          messageEvent,
        });
        const { message, ...info } = messageEvent;
        handler(message, info);
        return;
      }
    }

    // Handle relaying to a target
    if (!!messageEvent.message.target) {
      this.logger.debug(
        'Relaying message to target:',
        messageEvent.message.target
      );
      this.post(messageEvent.message, messageEvent.message.target);
    }

    let handlerCount = 0;

    this.logger.trace('Processing message with registered handlers');
    for (const { listener, config } of this.messageListeners) {
      if (config[messageEvent.message.action]) {
        listener(messageEvent as PorterEvent['onMessage']);
        handlerCount++;
        this.logger.debug('Message handled by registered listener: ', {
          listener,
          config,
        });
      }
    }

    if (handlerCount === 0) {
      this.logger.warn(
        'No handler found for message:',
        messageEvent.message.action
      );
    } else {
      this.logger.debug(
        `Message handled by ${handlerCount} registered listeners`
      );
    }
  }

  public addListener<T extends keyof PorterEvent>(
    event: T,
    listener: Listener<T>
  ) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners
      .get(event)!
      .add(listener as Listener<keyof PorterEvent>);

    return () => {
      this.eventListeners
        .get(event)
        ?.delete(listener as Listener<keyof PorterEvent>);
    };
  }

  public handleDisconnect(info: AgentInfo) {
    // Remove all message listeners for this agent
    this.messageListeners.forEach((messageListener) => {
      if (messageListener.config[info.id]) {
        this.messageListeners.delete(messageListener);
      }
    });
    this.logger.info('Agent disconnected:', { info });
    this.emitEvent('onDisconnect', info);
  }

  public handleConnect(info: AgentInfo) {
    this.logger.info('Agent connected:', { info });
    this.emitEvent('onConnect', info);
  }

  public onConnect(listener: Listener<'onConnect'>) {
    return this.addListener('onConnect', listener);
  }

  public onMessagesSet(listener: Listener<'onMessagesSet'>) {
    return this.addListener('onMessagesSet', listener);
  }

  public onDisconnect(listener: Listener<'onDisconnect'>) {
    return this.addListener('onDisconnect', listener);
  }
}

// Type guard for BrowserLocation
function isBrowserLocation(target: MessageTarget): target is BrowserLocation {
  return (
    typeof target === 'object' &&
    target !== null &&
    'context' in target &&
    'tabId' in target &&
    'frameId' in target
  );
}

function isPorterContext(target: MessageTarget): target is PorterContext {
  return (
    typeof target === 'string' &&
    Object.values(PorterContext).includes(target as PorterContext)
  );
}
