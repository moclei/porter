import browser, { Runtime } from 'webextension-polyfill';
import {
  Agent,
  PorterContext,
  PorterError,
  PorterErrorType,
} from '../porter.model';
import { Logger } from '../porter.utils';

export class AgentConnectionManager {
  private readonly CONNECTION_TIMEOUT = 10000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;
  private connectionAttempts = 0;
  private connectionTimer: NodeJS.Timeout | null = null;
  private agent: Agent | undefined;
  private readonly logger: Logger;

  constructor(
    private readonly namespace: string,
    private readonly context: PorterContext,
    logger: Logger
  ) {
    this.logger = logger;
  }

  public async initializeConnection(): Promise<void> {
    try {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
      }

      this.connectionTimer = setTimeout(() => {
        this.handleConnectionTimeout();
      }, this.CONNECTION_TIMEOUT);

      const name = `${this.namespace}-${this.context}`;
      this.logger.debug('Connecting new port with name: ', name);
      const port = browser.runtime.connect({ name });

      const connectionPromise = new Promise<void>((resolve, reject) => {
        const handleInitialMessage = (message: any) => {
          if (message.action === 'porter-handshake') {
            clearTimeout(this.connectionTimer!);
            port.onMessage.removeListener(handleInitialMessage);
            resolve();
          }
        };
        port.onMessage.addListener(handleInitialMessage);
      });

      this.agent = { port, data: {} };

      await Promise.race([
        connectionPromise,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new PorterError(
                  PorterErrorType.CONNECTION_TIMEOUT,
                  'Connection timed out waiting for handshake'
                )
              ),
            this.CONNECTION_TIMEOUT
          )
        ),
      ]);

      this.connectionAttempts = 0;
    } catch (error) {
      this.logger.error('Connection failed:', error);
      await this.handleConnectionFailure(error);
    }
  }

  public getPort(): Runtime.Port | undefined {
    return this.agent?.port;
  }

  private async handleConnectionFailure(error: unknown): Promise<void> {
    this.connectionAttempts++;

    if (this.connectionAttempts < this.MAX_RETRIES) {
      this.logger.warn(
        `Connection attempt ${this.connectionAttempts} failed, retrying in ${this.RETRY_DELAY}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
      await this.initializeConnection();
    } else {
      const finalError = new PorterError(
        PorterErrorType.CONNECTION_FAILED,
        'Failed to establish connection after maximum retries',
        { attempts: this.connectionAttempts, originalError: error }
      );
      this.logger.error('Max connection attempts reached:', finalError);
      throw finalError;
    }
  }

  private handleConnectionTimeout() {
    this.logger.error('Connection timed out');
    if (this.agent?.port) {
      this.handleDisconnect(this.agent.port);
    }
  }

  public handleDisconnect(port: Runtime.Port) {
    this.logger.debug('handleDisconnect');
    delete this.agent?.port;
  }

  public getNamespace(): string {
    return this.namespace;
  }
}
