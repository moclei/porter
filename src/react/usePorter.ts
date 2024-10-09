import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { connect, MessageConfig } from '../';

interface PorterMessage {
    action: string;
    payload: any;
}

interface UsePorterResult {
    post: (message: PorterMessage) => void;
    setMessage: (handlers: MessageConfig) => void;
    isConnected: boolean;
    error: Error | null;
}

export function usePorter(): UsePorterResult {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const postRef = useRef<((message: PorterMessage) => void) | null>(null);
    const setMessageRef = useRef<((handlers: MessageConfig) => void) | null>(null);

    useEffect(() => {
        let isMounted = true;

        const initializePorter = async () => {
            try {
                const [post, setMessage] = await connect();

                if (isMounted) {
                    postRef.current = post;
                    setMessageRef.current = setMessage;
                    setIsConnected(true);
                    setError(null);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error('Failed to connect to Porter'));
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
    }, []);

    const post = useCallback((message: PorterMessage) => {
        if (postRef.current) {
            try {
                postRef.current(message);
            } catch (err) {
                setError(err instanceof Error ? err : new Error('Failed to send message'));
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
                setError(err instanceof Error ? err : new Error('Failed to set message handlers'));
            }
        } else {
            setError(new Error('Porter is not connected'));
        }
    }, []);

    return { post, setMessage, isConnected, error };
}