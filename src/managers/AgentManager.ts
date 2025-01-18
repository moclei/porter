import { Runtime } from 'webextension-polyfill';
import {
  Agent,
  AgentMetadata,
  ConnectContext,
  PorterContext,
  PostTarget,
} from '../porter.model';
import { Logger } from '../porter.utils';

export interface AgentOperations {
  getAgent(options: {
    index?: number;
    subIndex?: number;
    context: PorterContext;
  }): Agent | Agent[] | null;
  addAgent(port: Runtime.Port, context: PorterContext): void;
  getKey(context: PorterContext, index: number, subIndex?: number): string;
  getAgentByKey(key: string): Agent | null;
  getAllAgents(): Agent[];
  getAgentMetadata(key: string): AgentMetadata | null;
  getAllAgentsMetadata(): AgentMetadata[];
  printAgents(): void;
}

export interface AgentEventEmitter {
  on(
    event: 'agentSetup',
    handler: (agent: Agent, metadata: AgentMetadata) => void
  ): void;
  on(
    event: 'agentMessage',
    handler: (message: any, metadata: AgentMetadata) => void
  ): void;
  on(
    event: 'agentDisconnect',
    handler: (metadata: AgentMetadata) => void
  ): void;
}

export class AgentManager implements AgentOperations {
  private agents: Map<string, Agent> = new Map();
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private contextCounters: Map<PorterContext, number> = new Map();

  constructor(private logger: Logger) {
    this.eventHandlers.set('agentSetup', new Set());
    this.eventHandlers.set('agentMessage', new Set());
    this.eventHandlers.set('agentDisconnect', new Set());
  }

  public on(event: string, handler: Function) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  private emit(event: string, ...args: any[]) {
    const handlers = this.eventHandlers.get(event);
    handlers?.forEach((handler) => handler(...args));
  }

  public getAgent(
    options: {
      index?: number;
      subIndex?: number;
      context: PorterContext;
    } = { context: PorterContext.ContentScript }
  ): Agent | Agent[] | null {
    if (options.index === undefined) {
      this.logger.debug('Getting agent by prefix: ', options.context);
      // Return all agents for a context if no index provided. Defaults to content script.
      return this.getAgentsByPrefix(options.context);
    }
    if (options.context === PorterContext.ContentScript) {
      if (options.subIndex === undefined) {
        this.logger.debug(
          'Getting agent by prefix: ',
          `${options.context}:${options.index}`
        );
        return this.getAgentsByPrefix(`${options.context}:${options.index}`);
      }

      // Return a specific content script agent
      this.logger.debug(
        'Getting specific agent by prefix: ',
        `${options.context}:${options.index}:${options.subIndex}`
      );
      return (
        this.agents.get(
          `${options.context}:${options.index}:${options.subIndex}`
        ) || null
      );
    }
    // For non-ContentScript contexts, return the specific agent
    this.logger.debug(
      'Getting specific agent by prefix: ',
      `${options.context}:${options.index}`
    );
    return this.agents.get(`${options.context}:${options.index}`) || null;
  }

  private getAgentsByContext(context: PorterContext): Agent[] {
    return Array.from(this.agents.entries())
      .filter(([key, _]) => key.startsWith(`${context}:`))
      .map(([_, agent]) => agent);
  }

  private getAgentsByPrefix(prefix: string): Agent[] {
    return Array.from(this.agents.entries())
      .filter(([key, _]) => key.startsWith(`${prefix}:`))
      .map(([_, agent]) => agent);
  }

  public getAllAgents(): Agent[] {
    return Array.from(this.agents.entries()).map(([_, agent]) => agent);
  }

  public getAgentData(key: string): any {
    return this.agents.get(key)?.data || {};
  }

  public setAgentData(key: string, data: any) {
    const agent = this.agents.get(key);
    if (agent) {
      agent.data = data;
    } else {
      this.logger.warn('agent does not exist to set data on: ', key);
    }
  }

  public getAgentByKey(key: string): Agent | null {
    return this.agents.get(key) || null;
  }

  public getAgentMetadata(key: string): AgentMetadata | null {
    const agent = this.agents.get(key);
    if (!agent) return null;
    // based on the key being in the format `${context}:${index}` + (subIndex ? `:${subIndex}` : '') we want to return an object with context, index, and subIndex
    const [context, index, subIndex] = key.split(':');
    return {
      key,
      connectionType: ConnectContext.NewAgent, // Todo: this cannot be determined from the key. Should we bother trying to determine it?
      context: context as PorterContext,
      location: {
        index: parseInt(index),
        subIndex: subIndex ? parseInt(subIndex) : undefined,
      },
    };
  }

  public getAllAgentsMetadata(): AgentMetadata[] {
    return Array.from(this.agents.keys())
      .map((key) => this.getAgentMetadata(key))
      .filter((meta) => meta !== null) as AgentMetadata[];
  }

  public addAgent(port: Runtime.Port, context: PorterContext) {
    let adjustedContext = context;
    let index = 0;
    let subIndex;
    let connectContext: ConnectContext;
    if (port.sender && port.sender.tab !== undefined) {
      index = port.sender.tab.id || 0;
      subIndex = port.sender?.frameId || 0;
      this.logger.debug(
        `Searching for agent with similar name: ${adjustedContext}:${index}`
      );
      const tabAgents = Array.from(this.agents.keys()).filter((k) =>
        k.startsWith(`${adjustedContext}:${index}:`)
      );

      if (tabAgents.length === 0) {
        this.logger.debug(`No similar agents found, this is a new one.`);
        connectContext = ConnectContext.NewTab;
      } else if (
        !tabAgents.includes(`${adjustedContext}:${index}:${subIndex}`)
      ) {
        this.logger.debug(
          `Similar parent agent found, calling this a new frame`
        );
        connectContext = ConnectContext.NewFrame;
      } else {
        this.logger.debug(
          `This exact agent name existed already, calling this a refreshed connection.`
        );
        connectContext = ConnectContext.RefreshConnection;
      }
    } else {
      this.logger.debug(`Adding agent that did not have a tab id`);
      index = this.contextCounters.get(adjustedContext) || 0;
      this.contextCounters.set(adjustedContext, index + 1);
      connectContext = ConnectContext.NewAgent;
    }
    this.logger.debug(
      'Adding agent with context: ',
      adjustedContext,
      'index: ',
      index,
      'subIndex: ',
      subIndex
    );
    const agentKey = this.getKey(adjustedContext, index, subIndex);
    this.logger.debug('Agent key determined. Moving on to setup', agentKey);
    this.setupAgent(port, adjustedContext, agentKey, connectContext, {
      index,
      subIndex,
    });
  }

  private setupAgent(
    port: Runtime.Port,
    porterContext: PorterContext,
    key: string,
    connectContext: ConnectContext,
    location: { index: number; subIndex?: number }
  ) {
    const agent = { port, data: null };
    this.agents.set(key, agent);

    const agentMetadata: AgentMetadata = {
      key,
      connectionType: connectContext,
      context: porterContext,
      location,
    };
    this.logger.debug('Sending onConnect event to listeners. ', key);

    port.onMessage.addListener((message: any) =>
      this.emit('agentMessage', message, agentMetadata)
    );

    port.onDisconnect.addListener(() => {
      this.emit('agentDisconnect', agentMetadata);
      this.removeAgent(agentMetadata);
    });

    this.logger.debug('Setup complete. ', key);
    this.emit('agentSetup', agent, agentMetadata);
    return agentMetadata;
  }

  public removeAgent(metadata: AgentMetadata) {
    this.agents.delete(metadata.key);
    if (!metadata.location || !metadata.location.subIndex) {
      this.reindexContextAgents(metadata.context);
    }
  }

  private reindexContextAgents(context: PorterContext) {
    this.logger.debug('Reindexing agents for context: ', context);
    const relevantAgents = this.getAgentsByContext(context);
    relevantAgents.forEach((agent, index) => {
      const oldKey = Array.from(this.agents.entries()).find(
        ([_, a]) => a === agent
      )?.[0];
      if (oldKey) {
        this.agents.delete(oldKey);
        this.logger.debug('Deleting agent: ', oldKey);
        const newKey = this.getKey(context, index);
        this.agents.set(newKey, agent);
      }
    });
    this.contextCounters.set(context, relevantAgents.length);
  }

  // Todo: This is a standalone function, should be worked into getAgent
  public buildAgentKey(
    context: PorterContext,
    index: number,
    subIndex?: number
  ): string {
    if (subIndex === undefined) {
      if (context === PorterContext.ContentScript) {
        return `${context}:${index}:0`;
      }
      return `${context}:${index}`;
    }
    // Return a specific content script agent
    return `${context}:${index}:${subIndex}`;
  }

  public getKey(
    context: PorterContext,
    index: number = 0,
    subIndex?: number
  ): string {
    this.logger.debug(
      'Getting key for context, index, subIndex: ',
      context,
      index,
      subIndex
    );
    return (
      `${context}:${index}` + (subIndex !== undefined ? `:${subIndex}` : ':0')
    );
  }

  public printAgents() {
    this.logger.debug('Current agents:', Array.from(this.agents.keys()));
  }

  private isContentScript(port: Runtime.Port) {
    if (!port.sender) return false;
    const hasFrame =
      port.sender.tab &&
      port.sender.tab.id !== undefined &&
      port.sender.frameId !== undefined;
    if (!hasFrame) return false;
    if (!(port.sender as any).origin) return false;

    const contentPage =
      !(port.sender as any)!.origin.startsWith('chrome-extension://') &&
      !(port.sender as any)!.tab!.url?.startsWith('moz-extension://');
    return contentPage;
  }

  // Todo: Feels messy that we have both AgentMetadata and PostTarget. Should we consolidate?
  public getTarget(agentMetadata: AgentMetadata): PostTarget | null {
    return {
      context: agentMetadata.context as PorterContext,
      location: {
        index: agentMetadata.location.index,
        subIndex: agentMetadata.location.subIndex ?? undefined,
      },
    };
  }
}
