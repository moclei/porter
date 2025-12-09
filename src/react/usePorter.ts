import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { connect, AgentAPI } from '../core/PorterAgent';
import {
  AgentInfo,
  Message,
  MessageConfig,
  PorterContext,
  Unsubscribe,
} from '../porter.model';

interface UsePorterResult {
  post: (message: Message<any>) => void;
  on: (handlers: MessageConfig) => void;
  isConnected: boolean;
  isReconnecting: boolean;
  error: Error | null;
  agentInfo: AgentInfo | null;
}

export function usePorter(options?: {
  agentContext?: PorterContext;
  namespace?: string;
  debug?: boolean;
  onDisconnect?: () => void;
  onReconnect?: (info: AgentInfo) => void;
}): UsePorterResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const postRef = useRef<((message: Message<any>) => void) | null>(null);
  const onRef = useRef<((handlers: MessageConfig) => void) | null>(null);
  const getAgentInfoRef = useRef<(() => AgentInfo | null) | null>(null);
  const unsubscribeRefs = useRef<Unsubscribe[]>([]);

  const memoizedOptions = useMemo(
    () => ({
      agentContext: options?.agentContext,
      namespace: options?.namespace,
      debug: options?.debug,
    }),
    [options?.agentContext, options?.namespace, options?.debug]
  );

  // Store callbacks in refs to avoid re-running effect when they change
  const onDisconnectRef = useRef(options?.onDisconnect);
  const onReconnectRef = useRef(options?.onReconnect);
  onDisconnectRef.current = options?.onDisconnect;
  onReconnectRef.current = options?.onReconnect;

  useEffect(() => {
    let isMounted = true;

    const initializePorter = async () => {
      try {
        const { post, on, getAgentInfo, onDisconnect, onReconnect } =
          connect(memoizedOptions);

        if (isMounted) {
          postRef.current = post;
          onRef.current = on;
          getAgentInfoRef.current = getAgentInfo;
          setIsConnected(true);
          setIsReconnecting(false);
          setError(null);

          // Set up disconnect handler
          const unsubDisconnect = onDisconnect(() => {
            if (isMounted) {
              setIsConnected(false);
              setIsReconnecting(true);
              setAgentInfo(null);
              onDisconnectRef.current?.();
            }
          });
          unsubscribeRefs.current.push(unsubDisconnect);

          // Set up reconnect handler
          const unsubReconnect = onReconnect((info: AgentInfo) => {
            if (isMounted) {
              setIsConnected(true);
              setIsReconnecting(false);
              setAgentInfo(info);
              onReconnectRef.current?.(info);
            }
          });
          unsubscribeRefs.current.push(unsubReconnect);

          // Set up internal porter-handshake handler
          on({
            'porter-handshake': (message: Message<any>) => {
              if (isMounted) {
                setAgentInfo(message.payload.info);
              }
            },
          });
        }
      } catch (err) {
        if (isMounted) {
          console.error('[PORTER] initializePorter error ', err);
          setError(
            err instanceof Error
              ? err
              : new Error('Failed to connect to Porter')
          );
          setIsConnected(false);
          setIsReconnecting(false);
        }
      }
    };

    initializePorter();

    return () => {
      isMounted = false;
      // Clean up all subscriptions
      unsubscribeRefs.current.forEach((unsub) => unsub());
      unsubscribeRefs.current = [];
    };
  }, [memoizedOptions]);

  const post = useCallback((message: Message<any>) => {
    if (postRef.current) {
      try {
        postRef.current(message);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to send message')
        );
      }
    } else {
      setError(new Error('Porter is not connected'));
    }
  }, []);

  const on = useCallback((handlers: MessageConfig) => {
    if (onRef.current) {
      try {
        onRef.current(handlers);
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error('Failed to set message handlers')
        );
      }
    } else {
      setError(new Error('Porter is not connected'));
    }
  }, []);

  return { post, on, isConnected, isReconnecting, error, agentInfo };
}
