/**
 * Content Script Entry Point
 * Initializes ActionMap, watchers, and message handling
 */

import type {
    ActionMapSnapshot,
    ActionMapDelta,
    Command,
    TelemetryMessage,
    HelloMessage,
    EventMessage,
} from '../shared/protocol';
import { extractActionMap } from './actionmap';
import { startWatching, stopWatching, forceUpdate } from './watchers';
import { executeCommand } from './executor';

// Frame ID (0 for main frame)
const frameId = window === window.top ? 0 : Math.random() * 1000000 | 0;

// Connection state
let isConnected = false;
let port: chrome.runtime.Port | null = null;

/**
 * Send message to background script
 */
function sendToBackground(message: TelemetryMessage) {
    if (port) {
        try {
            port.postMessage(message);
        } catch (e) {
            console.error('[ActionMap] Failed to send message:', e);
        }
    }
}

/**
 * Create initial hello message
 */
function createHelloMessage(): HelloMessage {
    return {
        type: 'hello',
        tabId: 0, // Will be filled by background
        url: window.location.href,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
    };
}

/**
 * Create snapshot message
 */
function createSnapshotMessage(candidates: ReturnType<typeof extractActionMap>): ActionMapSnapshot {
    return {
        type: 'snapshot',
        tabId: 0, // Will be filled by background
        frameId,
        url: window.location.href,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
        timestamp: Date.now(),
        candidates,
    };
}

/**
 * Handle delta from watchers
 */
function handleDelta(delta: ActionMapDelta) {
    delta.frameId = frameId;
    sendToBackground(delta);
}

/**
 * Handle incoming command from background
 */
async function handleCommand(command: Command) {
    const ack = await executeCommand(command);
    sendToBackground(ack as unknown as TelemetryMessage);
}

/**
 * Initialize connection to background script
 */
function connect() {
    if (port) {
        port.disconnect();
    }

    port = chrome.runtime.connect({ name: 'actionmap' });

    port.onMessage.addListener((message: Command | { type: string }) => {
        if (message.type === 'request_snapshot') {
            // Background requesting fresh snapshot
            const candidates = extractActionMap();
            sendToBackground(createSnapshotMessage(candidates));
        } else if ('commandId' in message) {
            // Execute command
            handleCommand(message as Command);
        }
    });

    port.onDisconnect.addListener(() => {
        isConnected = false;
        port = null;
        stopWatching();

        // Try to reconnect after delay
        setTimeout(() => {
            if (document.visibilityState === 'visible') {
                connect();
            }
        }, 2000);
    });

    isConnected = true;

    // Send hello
    sendToBackground(createHelloMessage());

    // Start watching and send initial snapshot
    const candidates = startWatching(handleDelta);
    sendToBackground(createSnapshotMessage(candidates));
}

/**
 * Handle page visibility changes
 */
function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        if (!isConnected) {
            connect();
        } else {
            // Force update when page becomes visible
            forceUpdate();
        }
    }
}

/**
 * Handle navigation events
 */
function handleNavigation(eventType: 'load' | 'unload') {
    sendToBackground({
        type: 'event',
        tabId: 0,
        eventType,
        url: window.location.href,
        timestamp: Date.now(),
    } as EventMessage);
}

/**
 * Detect modal/menu open events
 */
function setupModalDetection() {
    // Watch for role="dialog" or role="menu" being added
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        const role = node.getAttribute('role');
                        if (role === 'dialog' || role === 'alertdialog') {
                            sendToBackground({
                                type: 'event',
                                tabId: 0,
                                eventType: 'modal_opened',
                                timestamp: Date.now(),
                            } as EventMessage);
                        } else if (role === 'menu' || role === 'listbox') {
                            sendToBackground({
                                type: 'event',
                                tabId: 0,
                                eventType: 'menu_opened',
                                timestamp: Date.now(),
                            } as EventMessage);
                        }
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node instanceof Element) {
                        const role = node.getAttribute('role');
                        if (role === 'dialog' || role === 'alertdialog') {
                            sendToBackground({
                                type: 'event',
                                tabId: 0,
                                eventType: 'modal_closed',
                                timestamp: Date.now(),
                            } as EventMessage);
                        } else if (role === 'menu' || role === 'listbox') {
                            sendToBackground({
                                type: 'event',
                                tabId: 0,
                                eventType: 'menu_closed',
                                timestamp: Date.now(),
                            } as EventMessage);
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

/**
 * Initialize content script
 */
function init() {
    // Don't run in iframes for now (can enable later for frame support)
    if (window !== window.top) {
        return;
    }

    console.log('[ActionMap] Initializing content script');

    // Set up event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('load', () => handleNavigation('load'));
    window.addEventListener('beforeunload', () => handleNavigation('unload'));

    // Set up modal detection
    if (document.body) {
        setupModalDetection();
    } else {
        document.addEventListener('DOMContentLoaded', setupModalDetection);
    }

    // Connect to background script
    connect();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for testing
export { extractActionMap, executeCommand };
