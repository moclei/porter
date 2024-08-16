import { Porter } from './index';
import { PorterContext, ConnectContext, Message } from './porter.model';
import browser, { Runtime, Tabs } from 'webextension-polyfill';

// Mock the browser API
jest.mock('webextension-polyfill', () => ({
    runtime: {
        onConnect: {
            addListener: jest.fn(),
        },
    },
}));

// Mock the isServiceWorker function
jest.mock('./porter.utils', () => ({
    ...jest.requireActual('./porter.utils'),
    isServiceWorker: jest.fn().mockReturnValue(true),
}));


describe('PorterSource', () => {
    let porterSource: Porter;

    beforeAll(() => {
        // Mock the self object
        (global as any).self = {
            window: {
                ServiceWorkerGlobalScope: {},
            },
        };
    });

    beforeEach(() => {
        jest.clearAllMocks();
        porterSource = new Porter();
    });

    afterAll(() => {
        // Clean up the mock after all tests
        delete (global as any).self;
    });

    test('constructor should add listener to runtime.onConnect', () => {
        expect(browser.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
    });

    test('getAgent should return null for non-existent agent', () => {
        const agent = porterSource.getAgent({ context: PorterContext.ContentScript });
        expect(agent).toBeNull();
    });

    test('onMessage should set config', () => {
        const config = {
            testAction: jest.fn(),
        };
        porterSource.onMessage(config);
        expect((porterSource as any).config).toBe(config);
    });

    test('post should warn for invalid target', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        porterSource.post({ action: 'test' }, 'invalidTarget' as any);
        expect(consoleSpy).toHaveBeenCalledWith('PorterSource: Invalid target', 'invalidTarget');
        consoleSpy.mockRestore();
    });


    test('setData and getData should work correctly after connection', () => {
        // Create a mock port
        const mockPort: Partial<Runtime.Port> = {
            name: 'porter',
            disconnect: jest.fn(),
            postMessage: jest.fn(),
            onDisconnect: {
                addListener: jest.fn(),
                removeListener: jest.fn(),
                hasListener: jest.fn(),
                hasListeners: jest.fn(),
            },
            onMessage: {
                addListener: jest.fn(),
                removeListener: jest.fn(),
                hasListener: jest.fn(),
                hasListeners: jest.fn(),
            },
            sender: {
                tab: {
                    id: 1,
                    index: 0,
                    highlighted: false,
                    active: false,
                    pinned: false,
                    incognito: false,
                } as Tabs.Tab,
                frameId: 0,
            } as Runtime.MessageSender,
        };

        // Simulate a connection
        const connectListener = (browser.runtime.onConnect.addListener as jest.Mock).mock.calls[0][0];
        connectListener(mockPort);

        // Now set and get data
        const key = 'contentscript:1:0';
        const data = { foo: 'bar' };
        porterSource.setData(key, data);
        expect(porterSource.getData(key)).toEqual(data);
    });

    test('setData should warn when agent does not exist', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const key = 'nonexistentKey';
        const data = { foo: 'bar' };
        porterSource.setData(key, data);
        expect(consoleSpy).toHaveBeenCalledWith('PorterSource: agent does not exist to set data on: ', key);
        consoleSpy.mockRestore();
    });



    describe('Posting messages', () => {
        let mockPort: Runtime.Port;

        beforeEach(() => {
            // Create a mock port
            mockPort = {
                name: 'porter',
                disconnect: jest.fn(),
                postMessage: jest.fn(),
                onDisconnect: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                    hasListener: jest.fn(),
                    hasListeners: jest.fn(),
                },
                onMessage: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                    hasListener: jest.fn(),
                    hasListeners: jest.fn(),
                },
                sender: {
                    tab: {
                        id: 1,
                        index: 0,
                        highlighted: false,
                        active: false,
                        pinned: false,
                        incognito: false,
                    } as Tabs.Tab,
                    frameId: 0,
                } as Runtime.MessageSender,
            };

            // Simulate a connection
            const connectListener = (browser.runtime.onConnect.addListener as jest.Mock).mock.calls[0][0];
            connectListener(mockPort);
        });

        test('should post message to connected content script', () => {
            const message: Message<any> = { action: 'testAction', payload: 'testPayload' };
            porterSource.post(message, PorterContext.ContentScript, { index: 1, subIndex: 0 });

            expect(mockPort.postMessage).toHaveBeenCalledWith(message);
        });

        test('should post message to all frames in a tab if frameId is not specified', () => {
            const message: Message<any> = { action: 'testAction', payload: 'testPayload' };
            porterSource.post(message, PorterContext.ContentScript, { index: 1, subIndex: 0 });

            expect(mockPort.postMessage).toHaveBeenCalledWith(message);
        });

        test('should not post message if target context is not found', () => {
            const message: Message<any> = { action: 'testAction', payload: 'testPayload' };
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            porterSource.post(message, PorterContext.ContentScript, { index: 2, subIndex: 0 });

            expect(mockPort.postMessage).not.toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith('No agent found for tab 2, frame 0');

            consoleSpy.mockRestore();
        });

        test('should post message to specific context (e.g., Sidepanel)', () => {
            // Create a mock Sidepanel port
            const mockSidepanelPort: Runtime.Port = {
                ...mockPort,
                name: 'porter-Sidepanel',
            };

            // Connect the Sidepanel
            const connectListener = (browser.runtime.onConnect.addListener as jest.Mock).mock.calls[0][0];
            connectListener(mockSidepanelPort);

            const message: Message<any> = { action: 'testAction', payload: 'testPayload' };
            porterSource.post(message, PorterContext.Sidepanel);

            expect(mockSidepanelPort.postMessage).toHaveBeenCalledWith(message);
        });
    });
});