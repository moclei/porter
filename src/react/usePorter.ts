import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AgentMetadata,
  connect,
  Message,
  MessageConfig,
  PorterContext,
} from '../';

interface PorterMessage {
  action: string;
  payload: any;
}

interface UsePorterResult {
  post: (message: Message<any>) => void;
  setMessage: (handlers: MessageConfig) => void;
  isConnected: boolean;
  error: Error | null;
  metadata: AgentMetadata | null;
}

export function usePorter(options?: {
  agentContext?: PorterContext;
  namespace?: string;
}): UsePorterResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
  const postRef = useRef<((message: Message<any>) => void) | null>(null);
  const setMessageRef = useRef<((handlers: MessageConfig) => void) | null>(
    null
  );
  const getMetadataRef = useRef<(() => AgentMetadata | null) | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initializePorter = async () => {
      try {
        const [post, setMessage, getMetadata] = await connect(options);

        if (isMounted) {
          postRef.current = post;
          setMessageRef.current = setMessage;
          getMetadataRef.current = getMetadata;
          setIsConnected(true);
          setError(null);
          setMetadata(getMetadata());
        }
      } catch (err) {
        if (isMounted) {
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
  }, [options?.agentContext, options?.namespace]);

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

  const setMessage = useCallback((handlers: MessageConfig) => {
    if (setMessageRef.current) {
      try {
        setMessageRef.current(handlers);
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

  return { post, setMessage, isConnected, error, metadata };
}
