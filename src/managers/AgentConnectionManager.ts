import browser, { Runtime } from 'webextension-polyfill';
import { AgentInfo, PorterError, PorterErrorType } from '../porter.model';
import { Logger } from '../porter.utils';
import { MessageQueue } from './MessageQueue';

export type DisconnectCallback = () => void;
export type ReconnectCallback = (info: AgentInfo) => void;

export class AgentConnectionManager {
  private readonly CONNECTION_TIMEOUT = 5000;
  private readonly RECONNECT_INTERVAL = 1000; // 1 second
  private connectionTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private agentInfo: AgentInfo | null = null;
  private port: Runtime.Port | null = null;
  private readonly logger: Logger;
  private readonly connectionId: string;
  private readonly messageQueue: MessageQueue;
  private isReconnecting: boolean = false;
  private reconnectAttemptCount: number = 0;

  // Event callbacks
  private disconnectCallbacks: Set<DisconnectCallback> = new Set();
  private reconnectCallbacks: Set<ReconnectCallback> = new Set();

  constructor(
    private readonly namespace: string,
    logger: Logger
  ) {
    this.connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.logger = logger;
    this.messageQueue = new MessageQueue(logger);
  }

  /**
   * Register a callback to be called when the connection is lost
   * @returns Unsubscribe function
   */
  public onDisconnect(callback: DisconnectCallback): () => void {
    this.disconnectCallbacks.add(callback);
    return () => {
      this.disconnectCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback to be called when reconnection succeeds
   * @returns Unsubscribe function
   */
  public onReconnect(callback: ReconnectCallback): () => void {
    this.reconnectCallbacks.add(callback);
    return () => {
      this.reconnectCallbacks.delete(callback);
    };
  }

  private emitDisconnect(): void {
    this.logger.debug('Emitting disconnect event', {
      callbackCount: this.disconnectCallbacks.size,
    });
    this.disconnectCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        this.logger.error('Error in disconnect callback:', error);
      }
    });
  }

  private emitReconnect(info: AgentInfo): void {
    this.logger.debug('Emitting reconnect event', {
      callbackCount: this.reconnectCallbacks.size,
      info,
    });
    this.reconnectCallbacks.forEach((callback) => {
      try {
        callback(info);
      } catch (error) {
        this.logger.error('Error in reconnect callback:', error);
      }
    });
  }

  public async initializeConnection(): Promise<void> {
    try {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
      }

      const portName = `${this.namespace}:${this.connectionId}`;
      this.logger.debug('Connecting new port with name: ', { portName });
      this.port = browser.runtime.connect({ name: portName });

      const handshakePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new PorterError(
                PorterErrorType.CONNECTION_TIMEOUT,
                'Connection timed out waiting for handshake'
              )
            ),
          this.CONNECTION_TIMEOUT
        );

        const onMessage = (message: any) => {
          if (message.action === 'porter-handshake') {
            this.logger.debug('Received handshake:', message);
            clearTimeout(timeout);
            this.agentInfo = message.payload.info;
            this.logger.debug('Handshake agent info:', {
              agentInfo: this.agentInfo,
            });
            this.port?.onMessage.removeListener(onMessage);
            resolve();
          } else if (message.action === 'porter-error') {
            clearTimeout(timeout);
            this.port?.onMessage.removeListener(onMessage);
            this.logger.error('Error:', message);
            reject(
              new PorterError(
                message.payload.type,
                message.payload.message,
                message.payload.details
              )
            );
          }
        };

        this.port?.onMessage.addListener(onMessage);
      });

      this.port?.postMessage({
        action: 'porter-init',
        payload: {
          info: this.agentInfo,
          connectionId: this.connectionId,
        },
      });

      await handshakePromise;

      // After successful connection, process any queued messages
      await this.processQueuedMessages();
    } catch (error) {
      this.logger.error('Connection initialization failed:', error);
      this.handleDisconnect(this.port!);
      throw error;
    }
  }

  private async processQueuedMessages(): Promise<void> {
    if (!this.port || this.messageQueue.isEmpty()) {
      return;
    }

    const messages = this.messageQueue.dequeue();
    this.logger.info(
      `Processing ${messages.length} queued messages after reconnection`
    );

    for (const { message, target } of messages) {
      try {
        // Send message in the same format as normal messages
        const messageToSend = { ...message };
        if (target) {
          messageToSend.target = target;
        }
        this.port.postMessage(messageToSend);
        this.logger.debug('Successfully resent queued message:', {
          message: messageToSend,
        });
      } catch (error) {
        this.logger.error('Failed to process queued message:', error);
        // Re-queue the message if it fails
        this.messageQueue.enqueue(message, target);
        this.logger.debug('Re-queued failed message for retry');
      }
    }
  }

  public getPort(): Runtime.Port | null {
    return this.port;
  }

  public getAgentInfo(): AgentInfo | null {
    return this.agentInfo;
  }

  public getNamespace(): string {
    return this.namespace;
  }

  public handleDisconnect(port: Runtime.Port) {
    this.logger.info('Port disconnected', {
      portName: port.name,
      connectionId: this.connectionId,
      queuedMessages: this.messageQueue.isEmpty() ? 0 : 'some',
    });
    this.port = null;
    this.agentInfo = null;

    // Notify listeners of disconnection
    this.emitDisconnect();

    // Start reconnection attempts if not already reconnecting
    if (!this.isReconnecting) {
      this.startReconnectionAttempts();
    }
  }

  private startReconnectionAttempts(): void {
    this.isReconnecting = true;
    this.reconnectAttemptCount = 0;

    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
    }

    this.logger.info('Starting reconnection attempts', {
      interval: this.RECONNECT_INTERVAL,
      queuedMessages: this.messageQueue.isEmpty() ? 0 : 'some',
    });

    this.reconnectTimer = setInterval(async () => {
      this.reconnectAttemptCount++;
      try {
        this.logger.debug(`Reconnection attempt ${this.reconnectAttemptCount}`);
        await this.initializeConnection();
        this.isReconnecting = false;
        if (this.reconnectTimer) {
          clearInterval(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.logger.info('Reconnection successful', {
          attempts: this.reconnectAttemptCount,
          queuedMessages: this.messageQueue.isEmpty() ? 0 : 'some',
        });

        // Notify listeners of successful reconnection
        if (this.agentInfo) {
          this.emitReconnect(this.agentInfo);
        }
      } catch (error) {
        this.logger.debug(
          `Reconnection attempt ${this.reconnectAttemptCount} failed:`,
          error
        );
      }
    }, this.RECONNECT_INTERVAL);
  }

  public queueMessage(message: any, target?: any): void {
    this.messageQueue.enqueue(message, target);
    this.logger.debug('Message queued for retry', {
      message,
      target,
      queueSize: this.messageQueue.isEmpty() ? 0 : 'some',
    });
  }
}
