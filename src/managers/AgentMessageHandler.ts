import { Runtime } from 'webextension-polyfill';
import {
  Message,
  MessageConfig,
  PorterError,
  PorterErrorType,
  TargetAgent,
  AgentMetadata,
} from '../porter.model';
import { Logger } from '../porter.utils';

export class AgentMessageHandler {
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MESSAGE_TIMEOUT = 30000;
  private messageQueue: Array<{ message: Message<any>; timestamp: number }> =
    [];
  private config: MessageConfig | null = null;
  private metadata: AgentMetadata | null = null;
  private connections: AgentMetadata[] = [];

  private readonly internalHandlers: MessageConfig = {
    'porter-error': (message: Message<any>) => {
      this.logger.error('internalHandlers, error message received: ', message);
    },
    'porter-disconnect': (message: Message<any>) => {
      this.logger.debug(
        'internalHandler, disconnect message received: ',
        message
      );
    },
    'porter-handshake': (message: Message<any>) => {
      this.logger.debug(
        'internalHandlers, handshake message received: ',
        message
      );
      this.handleHandshake(message);
    },
  };

  constructor(private readonly logger: Logger) {}

  public handleMessage(port: Runtime.Port, message: any) {
    this.logger.debug('handleMessage, message: ', message);
    if (!this.config) {
      if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
        this.logger.warn('Message queue full, dropping message:', message);
        return;
      }
      this.logger.warn(
        'No message handler configured yet, queueing message: ',
        message
      );
      this.messageQueue.push({ message, timestamp: Date.now() });
      return;
    }
    this.processMessage(port, message);
  }

  public onMessage(config: MessageConfig) {
    this.logger.debug('Setting message handler config: ', config);
    this.config = config;

    while (this.messageQueue.length > 0) {
      const item = this.messageQueue[0];
      if (Date.now() - item.timestamp > this.MESSAGE_TIMEOUT) {
        this.logger.warn(
          'Message timeout, dropping message: ',
          this.messageQueue.shift()
        );
        continue;
      }
      this.processMessage(null!, item.message);
      this.messageQueue.shift();
    }
  }

  private processMessage(port: Runtime.Port, message: any) {
    const action = message.action;
    let handler;

    if (message.action.startsWith('porter')) {
      handler = this.internalHandlers[action];
      if (handler) {
        handler(message);
      } else {
        this.logger.error(
          'No internal handler for message with action: ',
          action
        );
      }
      return;
    }

    handler = this.config?.[action];
    if (handler) {
      this.logger.debug('Found handler, calling with message');
      handler(message);
    } else {
      this.logger.debug(`No handler for message with action: ${action}`);
    }
  }

  private handleHandshake(message: Message<any>) {
    this.logger.debug('handleHandshake, message: ', message);
    const { meta, currentConnections } = message.payload;
    this.metadata = meta;
    this.connections = currentConnections;
  }

  public post(port: Runtime.Port, message: Message<any>, target?: TargetAgent) {
    this.logger.debug(`Sending message`, {
      action: message.action,
      target,
      hasPayload: !!message.payload,
    });

    try {
      if (target) {
        message.target = target;
      }
      port.postMessage(message);
    } catch (error) {
      throw new PorterError(
        PorterErrorType.MESSAGE_FAILED,
        'Failed to post message',
        { originalError: error, message, target }
      );
    }
  }
}
