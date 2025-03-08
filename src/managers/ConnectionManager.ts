import { Runtime } from 'webextension-polyfill';
import { AgentOperations } from './AgentManager';
import { AgentInfo, PorterError, PorterErrorType } from '../porter.model';
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

      if (!port.name || !port.name.startsWith(this.namespace + ':')) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Invalid namespace or port name format'
        );
      }

      port.onMessage.addListener(this.handleInitMessage.bind(this, port));

      setTimeout(() => {
        if (!this.agentOperations.hasPort(port)) {
          try {
            port.disconnect();
          } catch (e) {
            this.logger.error('Failed to disconnect port:', e);
          }
        }
      }, 5000);
    } catch (error) {
      this.handleConnectionError(port, error as Error);
    }
  }

  private handleInitMessage(port: Runtime.Port, message: any): void {
    // Process only the init message
    if (message.action !== 'porter-init') {
      return;
    }

    try {
      // Remove this listener since we only need it once
      port.onMessage.removeListener(this.handleInitMessage.bind(this, port));

      const { info, connectionId } = message.payload;

      if (!info || !connectionId) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Missing context or connection ID'
        );
      }

      // Now add the agent with the provided context
      const agentId = this.agentOperations.addAgent(port);

      if (!agentId) {
        throw new PorterError(
          PorterErrorType.INVALID_CONTEXT,
          'Failed to add agent'
        );
      }

      // Get the agent info to send back
      const agent = this.agentOperations.getAgentById(agentId);

      if (agent) {
        this.confirmConnection(port, agent.info);
      }

      this.agentOperations.printAgents();
    } catch (error) {
      this.handleConnectionError(port, error as Error);
    }
  }

  private handleConnectionError(port: Runtime.Port, error: Error): void {
    const porterError =
      error instanceof PorterError
        ? error
        : new PorterError(
            PorterErrorType.CONNECTION_FAILED,
            error instanceof Error ? error.message : 'Unknown connection error',
            { originalError: error }
          );
    this.logger.error('Connection handling failed: ', {
      porterError,
    });
    try {
      port.postMessage({
        action: 'porter-error',
        payload: { error: porterError },
      });
    } catch (e) {
      this.logger.error('Failed to send error message: ', {
        error: e,
      });
    }

    try {
      port.disconnect();
    } catch (e) {
      this.logger.error('Failed to disconnect port: ', {
        error: e,
      });
    }
  }

  public confirmConnection(port: Runtime.Port, info: AgentInfo) {
    this.logger.debug('Sending confirmation message back to initiator ', {
      info,
    });
    port.postMessage({
      action: 'porter-handshake',
      payload: {
        info,
        currentConnections: this.agentOperations.getAllAgentsInfo(),
      },
    });
  }
}
