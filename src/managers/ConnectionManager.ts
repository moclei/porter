import { Runtime } from 'webextension-polyfill';
import { AgentManager, AgentOperations } from './AgentManager';
import { MessageHandler } from './MessageHandler';
import {
  AgentMetadata,
  PorterContext,
  PorterError,
  PorterErrorType,
} from '../porter.model';
import { Logger } from '../porter.utils';

export class ConnectionManager {
  constructor(
    private agentOperations: AgentOperations,
    private namespace: string,
    private logger: Logger
  ) {}

  public handleConnection(port: Runtime.Port) {
    try {
      this.logger.info('New connection request:', port.name);
      if (!port.name) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Port name not provided'
        );
      }

      const connectCtx = port.name.split('-');
      if (connectCtx.length < 2) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Invalid port name (not a porter port)'
        );
      }

      if (connectCtx[0] !== this.namespace) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Namespace mismatch'
        );
      }
      this.logger.debug('Connection context:', connectCtx);
      if (connectCtx.length === 3) {
        this.logger.warn('Relay connections not yet supported');
      } else if (connectCtx.length === 2) {
        this.agentOperations.addAgent(port, connectCtx[1] as PorterContext);
      }
      this.agentOperations.printAgents();
    } catch (error) {
      const porterError =
        error instanceof PorterError
          ? error
          : new PorterError(
              PorterErrorType.CONNECTION_FAILED,
              error instanceof Error
                ? error.message
                : 'Unknown connection error',
              { originalError: error }
            );

      this.logger.error('Connection handling failed:', porterError);

      try {
        port.postMessage({
          action: 'porter-error',
          payload: {
            type: porterError.type,
            message: porterError.message,
            details: porterError.details,
          },
        });
      } catch (e) {
        this.logger.error('Failed to send error message to port:', e);
      }

      try {
        port.disconnect();
      } catch (e) {
        this.logger.error('Failed to disconnect port:', e);
      }
    }
  }

  public confirmConnection(port: Runtime.Port, agentMeta: AgentMetadata) {
    this.logger.debug(
      'Sending confirmation message back to initiator ',
      agentMeta.key
    );
    port.postMessage({
      action: 'porter-handshake',
      payload: {
        meta: agentMeta,
        currentConnections: this.agentOperations.getAllAgentsMetadata(),
      },
    });
  }

  private isPorterContext(
    value: PorterContext | string
  ): value is PorterContext {
    return Object.values(PorterContext).includes(value as PorterContext);
  }
}
