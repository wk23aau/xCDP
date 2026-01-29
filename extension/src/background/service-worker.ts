/**
 * Background Service Worker - Transport Hub
 * Maintains WebSocket connection to backend and routes messages between content scripts and backend
 */

import type {
    TelemetryMessage,
    Command,
    CommandAck,
    ActionMapSnapshot,
    ActionMapDelta,
    HelloMessage,
    ConnectionConfig,
} from '../shared/protocol';

// Connection configuration
const config: ConnectionConfig = {
    wsUrl: 'ws://localhost:9333/extension',
    reconnectInterval: 2000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 5000,
    backpressureThreshold: 100,
};

// WebSocket state
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let messageQueue: TelemetryMessage[] = [];
let isConnecting = false;

// Tab state: map of tabId -> port
const tabPorts = new Map<number, chrome.runtime.Port>();
const tabState = new Map<number, { url: string; lastSnapshot: ActionMapSnapshot | null }>();

/**
 * Connect to WebSocket backend
 */
function connectWebSocket() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) {
        return;
    }

    isConnecting = true;
    console.log('[ServiceWorker] Connecting to WebSocket:', config.wsUrl);

    try {
        ws = new WebSocket(config.wsUrl);

        ws.onopen = () => {
            console.log('[ServiceWorker] WebSocket connected');
            isConnecting = false;
            reconnectAttempts = 0;

            // Start heartbeat
            startHeartbeat();

            // Flush message queue
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                if (msg) sendToBackend(msg);
            }

            // Request snapshots from all connected tabs
            for (const [tabId, port] of tabPorts) {
                try {
                    port.postMessage({ type: 'request_snapshot' });
                } catch (e) {
                    console.error('[ServiceWorker] Failed to request snapshot from tab', tabId, e);
                }
            }
        };

        ws.onclose = (event) => {
            console.log('[ServiceWorker] WebSocket closed:', event.code, event.reason);
            isConnecting = false;
            ws = null;
            stopHeartbeat();

            // Attempt reconnect
            if (reconnectAttempts < config.maxReconnectAttempts) {
                reconnectAttempts++;
                console.log(`[ServiceWorker] Reconnecting in ${config.reconnectInterval}ms (attempt ${reconnectAttempts})`);
                setTimeout(connectWebSocket, config.reconnectInterval);
            }
        };

        ws.onerror = (error) => {
            console.error('[ServiceWorker] WebSocket error:', error);
            isConnecting = false;
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as Command | { type: string; tabId: number };
                handleBackendMessage(message);
            } catch (e) {
                console.error('[ServiceWorker] Failed to parse message:', e);
            }
        };
    } catch (e) {
        console.error('[ServiceWorker] Failed to create WebSocket:', e);
        isConnecting = false;
    }
}

/**
 * Send message to backend
 */
function sendToBackend(message: TelemetryMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (e) {
            console.error('[ServiceWorker] Failed to send message:', e);
            messageQueue.push(message);

            // Apply backpressure
            if (messageQueue.length > config.backpressureThreshold) {
                // Drop oldest non-essential messages
                messageQueue = messageQueue.filter(m =>
                    m.type === 'snapshot' || m.type === 'hello'
                ).slice(-10);
            }
        }
    } else {
        messageQueue.push(message);

        // Apply backpressure
        if (messageQueue.length > config.backpressureThreshold) {
            messageQueue = messageQueue.filter(m =>
                m.type === 'snapshot' || m.type === 'hello'
            ).slice(-10);
        }

        // Try to connect
        connectWebSocket();
    }
}

/**
 * Handle message from backend
 */
function handleBackendMessage(message: Command | { type: string; tabId?: number }) {
    const msgWithTab = message as { commandId?: string; tabId?: number; type: string };
    if (msgWithTab.commandId && msgWithTab.tabId !== undefined) {
        // Route command to specific tab
        const port = tabPorts.get(msgWithTab.tabId);
        if (port) {
            try {
                port.postMessage(message);
            } catch (e) {
                console.error('[ServiceWorker] Failed to send command to tab', msgWithTab.tabId, e);
            }
        } else {
            // Tab not found, send error ack
            sendToBackend({
                type: 'ack',
                commandId: msgWithTab.commandId,
                status: 'fail',
                reason: `Tab ${msgWithTab.tabId} not connected`,
                timestamp: Date.now(),
            } as unknown as TelemetryMessage);
        }
    } else if (message.type === 'broadcast') {
        // Broadcast to all tabs
        for (const port of tabPorts.values()) {
            try {
                port.postMessage(message);
            } catch (e) {
                console.error('[ServiceWorker] Failed to broadcast:', e);
            }
        }
    }
}

/**
 * Start heartbeat
 */
function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        }
    }, config.heartbeatInterval);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

/**
 * Handle connection from content script
 */
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'actionmap') return;

    const tabId = port.sender?.tab?.id;
    if (!tabId) {
        console.warn('[ServiceWorker] Connection without tab ID');
        return;
    }

    console.log('[ServiceWorker] Tab connected:', tabId);
    tabPorts.set(tabId, port);

    // Handle messages from content script
    port.onMessage.addListener((message: TelemetryMessage | CommandAck) => {
        // Add tabId to message
        const enrichedMessage = { ...message, tabId };

        if (message.type === 'hello') {
            // Store tab state
            tabState.set(tabId, {
                url: (message as HelloMessage).url,
                lastSnapshot: null
            });
        } else if (message.type === 'snapshot') {
            // Store snapshot
            const state = tabState.get(tabId);
            if (state) {
                state.lastSnapshot = message as ActionMapSnapshot;
            }
        }

        // Forward to backend
        sendToBackend(enrichedMessage as TelemetryMessage);
    });

    // Handle disconnect
    port.onDisconnect.addListener(() => {
        console.log('[ServiceWorker] Tab disconnected:', tabId);
        tabPorts.delete(tabId);
        tabState.delete(tabId);

        // Notify backend
        sendToBackend({
            type: 'event',
            tabId,
            eventType: 'unload',
            timestamp: Date.now(),
        } as TelemetryMessage);
    });

    // Ensure we're connected to backend
    connectWebSocket();
});

/**
 * Handle tab updates (navigation, etc.)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        const port = tabPorts.get(tabId);
        if (port) {
            // Request new snapshot after navigation
            try {
                port.postMessage({ type: 'request_snapshot' });
            } catch (e) {
                // Tab might have been closed
            }
        }
    }
});

/**
 * Handle tab removal
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    tabPorts.delete(tabId);
    tabState.delete(tabId);
});

/**
 * API for DevTools panel
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'get_tab_state') {
        const state = tabState.get(message.tabId);
        sendResponse(state || null);
        return true;
    }

    if (message.type === 'get_connection_status') {
        sendResponse({
            connected: ws !== null && ws.readyState === WebSocket.OPEN,
            reconnectAttempts,
            queueSize: messageQueue.length,
            tabCount: tabPorts.size,
        });
        return true;
    }

    if (message.type === 'update_config') {
        Object.assign(config, message.config);
        // Reconnect with new config
        if (ws) {
            ws.close();
        }
        connectWebSocket();
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'execute_command') {
        const port = tabPorts.get(message.tabId);
        if (port) {
            port.postMessage(message.command);
            sendResponse({ ok: true });
        } else {
            sendResponse({ ok: false, error: 'Tab not connected' });
        }
        return true;
    }
});

// Initial connection attempt
console.log('[ServiceWorker] Browser Perception Engine starting');
connectWebSocket();
