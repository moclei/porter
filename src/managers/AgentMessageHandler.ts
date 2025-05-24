import { Runtime } from 'webextension-polyfill';
import {
  BrowserLocation,
  Message,
  MessageConfig,
  PorterError,
  PorterErrorType,
} from '../porter.model';
import { Logger } from '../porter.utils';

export class AgentMessageHandler {
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MESSAGE_TIMEOUT = 30000;
  private messageQueue: Array<{ message: Message<any>; timestamp: number }> =
    [];
  private handlers: Map<string, Array<Function>> = new Map();

  constructor(private readonly logger: Logger) {}

  public handleMessage(port: Runtime.Port, message: any) {
    this.logger.debug('handleMessage, message: ', message);
    if (this.handlers.size === 0) {
      if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
        this.logger.warn('Message queue full, dropping message:', message);
        return;
      }
      this.logger.warn(
        'No message handlers configured yet, queueing message: ',
        message
      );
      this.messageQueue.push({ message, timestamp: Date.now() });
      return;
    }
    this.processMessage(port, message);
  }

  // Legacy method - internally uses the new system
  public onMessage(config: MessageConfig) {
    this.logger.debug('Setting message handlers from config: ', config);
    // Clear previous handlers to maintain backward compatibility
    this.handlers.clear();
    this.on(config);

    this.processQueuedMessages();
  }

  public on(config: MessageConfig) {
    this.logger.debug('Adding message handlers from config: ', config);

    Object.entries(config).forEach(([action, handler]) => {
      if (!this.handlers.has(action)) {
        this.handlers.set(action, []);
      }
      this.handlers.get(action)!.push(handler);
    });

    this.processQueuedMessages();
  }

  private processQueuedMessages() {
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
    const actionHandlers = this.handlers.get(action) || [];

    if (actionHandlers.length > 0) {
      this.logger.debug(
        `Found ${actionHandlers.length} handlers for action: ${action}`
      );
      actionHandlers.forEach((handler) => handler(message));
    } else {
      this.logger.debug(`No handlers for message with action: ${action}`);
    }
  }

  public post(
    port: Runtime.Port,
    message: Message<any>,
    target?: BrowserLocation
  ) {
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
