import browser, { Runtime } from 'webextension-polyfill';
import { AgentInfo, PorterError, PorterErrorType } from '../porter.model';
import { Logger } from '../porter.utils';

export class AgentConnectionManager {
  private readonly CONNECTION_TIMEOUT = 5000;
  private connectionTimer: NodeJS.Timeout | null = null;
  private agentInfo: AgentInfo | null = null;
  private port: Runtime.Port | null = null;
  private readonly logger: Logger;
  private readonly connectionId: string;

  constructor(
    private readonly namespace: string,
    logger: Logger
  ) {
    this.connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.logger = logger;
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
            this.logger.debug('Agent info:', { agentInfo: this.agentInfo });
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
    } catch (error) {
      this.logger.error('Connection initialization failed:', error);
      this.port?.disconnect();
      this.port = null;
      this.agentInfo = null;
      throw error;
    }
  }

  public getPort(): Runtime.Port | null {
    return this.port;
  }

  public getAgentInfo(): AgentInfo | null {
    return this.agentInfo;
  }

  public handleDisconnect(port: Runtime.Port) {
    this.logger.debug('handleDisconnect');
    this.port = null;
    this.agentInfo = null;
  }

  public getNamespace(): string {
    return this.namespace;
  }
}
