import { AgentOperations } from './AgentManager';
import {
  PorterEvent,
  Listener,
  MessageListener,
  Message,
  PostTarget,
  PorterErrorType,
  MessageConfig,
  PorterContext,
  PorterError,
  AgentMetadata,
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
      'porter-messages-established': (message: Message<any>, agent) => {
        if (!agent || !agent.key) return;
        const agentMetadata = this.agentOperations.getAgentMetadata(agent.key);
        if (!agentMetadata) return;
        this.logger.debug(
          'internalHandlers, established message received: ',
          agent!.key,
          message
        );
        this.emitEvent('onMessagesSet', agentMetadata);
      },
    };
  }

  public async post(message: Message<any>, target?: PostTarget): Promise<void> {
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
        } else if (typeof target === 'number') {
          this.postToTab(message, target);
        } else if (typeof target === 'string') {
          this.postToKey(message, target);
        } else {
          this.postWithOptions(message, target);
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

  private postToTab(message: Message<any>, tabId: number): void {
    const key = `${PorterContext.ContentScript}:${tabId}:0`;
    this.postToKey(message, key);
  }

  // Requires a specified context. Since the other overloads from the public post method
  // assume a content-script context, this method can be inferred to be non-content-script.
  private postWithOptions(message: Message<any>, options: PostTarget): void {
    this.logger.debug('Posting with options: ', options);
    let key = this.agentOperations.getKey(
      options.context,
      options.location?.index || 0,
      options.location?.subIndex || 0
    );
    this.postToKey(message, key);
  }

  private postToKey(message: Message<any>, key: string): void {
    const agent = this.agentOperations.getAgentByKey(key);
    if (!agent?.port) {
      throw new PorterError(
        PorterErrorType.INVALID_TARGET,
        `No agent found for key: ${key}`
      );
    }

    try {
      agent.port.postMessage(message);
    } catch (error) {
      throw new PorterError(
        PorterErrorType.MESSAGE_FAILED,
        `Failed to post message to agent ${key}`,
        { originalError: error, message }
      );
    }
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
          this.logger.debug(
            'onMessage, calling handler. Message: ',
            event.key,
            event.message
          );
          handler(event.message, {
            key: event.key,
            context: event.context,
            location: event.location,
          });
        } else {
          this.logger.debug(
            'onMessage, no handler found. Message: ',
            event.key,
            event.message
          );
        }
      },
    };
    this.messageListeners.add(messageListener);

    return () => {
      this.messageListeners.delete(messageListener);
    };
  }

  // Handles messages incomng from ports
  public handleIncomingMessage(message: any, agentMetadata: AgentMetadata) {
    this.logger.debug(
      `Received message from ${agentMetadata.context}:`,
      agentMetadata.key,
      {
        action: message.action,
        target: message.target,
        hasPayload: !!message.payload,
      }
    );

    this.emitMessage({ ...agentMetadata, message });
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
    this.logger.debug(
      'Message received:',
      messageEvent.key,
      messageEvent.message
    );

    if (messageEvent.message.action.startsWith('porter-')) {
      const handler = this.initializationHandler[messageEvent.message.action];
      if (handler) {
        this.logger.debug(
          'Processing internal porter message:',
          messageEvent.message.action
        );
        handler(messageEvent.message, {
          key: messageEvent.key,
          context: messageEvent.context,
          location: messageEvent.location,
        });
        return;
      }
    }

    if (!!messageEvent.message.target) {
      this.logger.debug(
        'Relaying message to target:',
        messageEvent.message.target
      );
      const { context, location } = messageEvent.message.target;
      if (location) {
        this.post(messageEvent.message, {
          context: context as PorterContext,
          location,
        });
      } else {
        this.post(messageEvent.message, { context: context as PorterContext });
      }
    }

    let handlerCount = 0;
    let handled = false;
    this.logger.trace('Processing message with registered handlers');
    for (const { listener, config } of this.messageListeners) {
      if (config[messageEvent.message.action]) {
        listener(messageEvent as PorterEvent['onMessage']);
        handlerCount++;
        this.logger.debug('Message handled by registered listener');
        break;
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

  public handleDisconnect(agentMetadata: AgentMetadata) {
    this.logger.info('Agent disconnected:', agentMetadata.key);
    this.emitEvent('onDisconnect', agentMetadata);
    for (const messageListener of this.messageListeners) {
      if (messageListener.config[agentMetadata.key]) {
        this.messageListeners.delete(messageListener);
      }
    }
  }

  public handleConnect(agentMetadata: AgentMetadata) {
    this.logger.info('Agent connected:', agentMetadata.key);
    this.emitEvent('onConnect', agentMetadata);
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
