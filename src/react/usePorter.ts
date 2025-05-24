import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  AgentInfo,
  connect,
  Message,
  MessageConfig,
  PorterContext,
  AgentAPI,
} from '../';

interface UsePorterResult {
  post: (message: Message<any>) => void;
  on: (handlers: MessageConfig) => void;
  isConnected: boolean;
  error: Error | null;
  agentInfo: AgentInfo | null;
}

export function usePorter(options?: {
  agentContext?: PorterContext;
  namespace?: string;
}): UsePorterResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const postRef = useRef<((message: Message<any>) => void) | null>(null);
  const onRef = useRef<((handlers: MessageConfig) => void) | null>(null);
  const getAgentInfoRef = useRef<(() => AgentInfo | null) | null>(null);

  const memoizedOptions = useMemo(
    () => ({
      agentContext: options?.agentContext,
      namespace: options?.namespace,
    }),
    [options?.agentContext, options?.namespace]
  );

  useEffect(() => {
    let isMounted = true;

    const initializePorter = async () => {
      try {
        const { post, on, getAgentInfo } = connect(memoizedOptions);

        if (isMounted) {
          postRef.current = post;
          onRef.current = on;
          getAgentInfoRef.current = getAgentInfo;
          setIsConnected(true);
          setError(null);

          // Set up internal porter-handshake handler
          on({
            'porter-handshake': (message: Message<any>) => {
              console.log('[PORTER] porter-handshake heard: ', message.payload);
              if (isMounted) {
                setAgentInfo(message.payload.info);
              }
            },
          });
        }
      } catch (err) {
        if (isMounted) {
          console.log('[PORTER] initializePorter error ', err);
          setError(
            err instanceof Error
              ? err
              : new Error('Failed to connect to Porter')
          );
          setIsConnected(false);
        }
      }
    };

    initializePorter();

    return () => {
      isMounted = false;
      // Clean up the connection if necessary
      // This depends on whether porter-source provides a cleanup method
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

  return { post, on, isConnected, error, agentInfo };
}
