import {
  AgentInfo,
  BrowserLocation,
  Message,
  MessageConfig,
  PorterContext,
} from '../porter.model';
import { AgentConnectionManager } from '../managers/AgentConnectionManager';
import { AgentMessageHandler } from '../managers/AgentMessageHandler';
import { Logger } from '../porter.utils';

export class PorterAgent {
  private static instance: PorterAgent | null = null;
  private readonly connectionManager: AgentConnectionManager;
  private readonly messageHandler: AgentMessageHandler;
  private readonly logger: Logger;

  private constructor(
    options: { agentContext?: PorterContext; namespace?: string } = {}
  ) {
    const namespace = options.namespace ?? 'porter';
    const context = options.agentContext ?? this.determineContext();

    this.logger = Logger.getLogger(`Agent`);
    this.connectionManager = new AgentConnectionManager(namespace, this.logger);
    this.messageHandler = new AgentMessageHandler(this.logger);

    this.logger.info('Initializing with options: ', { options, context });
    this.initializeConnection();
  }

  public static getInstance(
    options: { agentContext?: PorterContext; namespace?: string } = {}
  ): PorterAgent {
    if (
      !PorterAgent.instance ||
      PorterAgent.instance.connectionManager.getNamespace() !==
        options.namespace
    ) {
      PorterAgent.instance = new PorterAgent(options);
    }
    return PorterAgent.instance;
  }

  private async initializeConnection(): Promise<void> {
    await this.connectionManager.initializeConnection();
    const port = this.connectionManager.getPort();
    if (port) {
      port.onMessage.addListener((message: any) =>
        this.messageHandler.handleMessage(port, message)
      );
      port.onDisconnect.addListener((p) =>
        this.connectionManager.handleDisconnect(p)
      );
    }
  }

  public onMessage(config: MessageConfig) {
    this.messageHandler.onMessage(config);
    const port = this.connectionManager.getPort();
    port?.postMessage({ action: 'porter-messages-established' });
  }

  public post(message: Message<any>, target?: BrowserLocation) {
    const port = this.connectionManager.getPort();
    if (port) {
      this.messageHandler.post(port, message, target);
    }
  }

  private determineContext(): PorterContext {
    if (!window.location.protocol.includes('extension')) {
      return PorterContext.ContentScript;
    }
    return PorterContext.Extension;
  }

  public getAgentInfo(): AgentInfo | null {
    return this.connectionManager.getAgentInfo() || null;
  }
}

export function connect(options?: {
  agentContext?: PorterContext;
  namespace?: string;
}): [
  (message: Message<any>, target?: BrowserLocation) => void,
  (config: MessageConfig) => void,
  () => AgentInfo | null,
] {
  const porterInstance = PorterAgent.getInstance(options);
  return [
    porterInstance.post.bind(porterInstance),
    porterInstance.onMessage.bind(porterInstance),
    porterInstance.getAgentInfo.bind(porterInstance),
  ];
}
