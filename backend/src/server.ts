/**
 * Backend Server
 * WebSocket gateway for Browser Perception & Control Plane
 */

import Fastify from 'fastify';
import fastifyWebsocket, { SocketStream } from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { WebSocket } from 'ws';

import type {
    TelemetryMessage,
    Command,
    CommandAck,
    ReplRequest,
    ActionMapSnapshot,
    ActionMapDelta,
} from './protocol.js';
import { generateCommandId } from './protocol.js';
import {
    handleHello,
    handleSnapshot,
    handleDelta,
    handleDisconnect,
    updatePointer,
    getTabs,
    getTab,
    getCandidates,
    searchCandidates,
    getWorldSummary,
} from './world-state.js';
import {
    checkCommand,
    logCommand,
    getPolicy,
    updatePolicy,
    getRateLimitStatus,
} from './policy.js';
import cdp from './cdp-client.js';

// Configuration
const PORT = parseInt(process.env.PORT || '9333', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);

// Try to connect to CDP on startup
cdp.connect(CDP_PORT).catch(() => {
    console.log('[CDP] Chrome not available on port 9222 - navigation commands will fail');
});

// Create Fastify server
const fastify = Fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty',
            options: { colorize: true },
        },
    },
});

// WebSocket connections
const extensionConnections = new Set<WebSocket>();
const replConnections = new Map<WebSocket, { subscribedTabId?: number }>();

// Pending command callbacks
const pendingCommands = new Map<string, {
    resolve: (ack: CommandAck) => void;
    timeout: NodeJS.Timeout;
}>();

/**
 * Send message to extension
 */
function sendToExtension(message: Command): boolean {
    for (const ws of extensionConnections) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            return true;
        }
    }
    return false;
}

/**
 * Broadcast to subscribed REPL connections
 */
function broadcastToRepl(message: TelemetryMessage | CommandAck): void {
    const data = JSON.stringify(message);
    for (const [ws, state] of replConnections) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        // Check subscription filter
        if (state.subscribedTabId !== undefined) {
            const msgTabId = (message as any).tabId;
            if (msgTabId !== undefined && msgTabId !== state.subscribedTabId) {
                continue;
            }
        }

        ws.send(data);
    }
}

/**
 * Handle telemetry from extension
 */
function handleTelemetry(message: TelemetryMessage): void {
    switch (message.type) {
        case 'hello':
            handleHello(message);
            fastify.log.info(`Tab connected: ${message.tabId} - ${message.url}`);
            break;

        case 'snapshot':
            handleSnapshot(message);
            fastify.log.info(`Snapshot: tab ${message.tabId} - ${message.candidates.length} candidates`);
            break;

        case 'delta':
            handleDelta(message);
            if (message.added.length > 0 || message.removed.length > 0) {
                fastify.log.debug(`Delta: tab ${message.tabId} - +${message.added.length}/-${message.removed.length}`);
            }
            break;

        case 'pointer':
            updatePointer(message.x, message.y, message.buttons);
            break;

        case 'event':
            fastify.log.info(`Event: tab ${message.tabId} - ${message.eventType}`);
            if (message.eventType === 'unload') {
                handleDisconnect(message.tabId);
            }
            break;

        case 'heartbeat':
            // Just acknowledge
            break;
    }

    // Forward to REPL subscribers
    broadcastToRepl(message);
}

/**
 * Handle command acknowledgment from extension
 */
function handleCommandAck(ack: CommandAck): void {
    const pending = pendingCommands.get(ack.commandId);
    if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(ack);
        pendingCommands.delete(ack.commandId);
    }

    // Forward to REPL
    broadcastToRepl(ack);
}

/**
 * Execute command with promise
 */
async function executeCommand(command: Command): Promise<CommandAck> {
    return new Promise((resolve, reject) => {
        // Ensure commandId
        if (!command.commandId) {
            command.commandId = generateCommandId();
        }

        // Check policy
        const tab = getTab(command.tabId);
        const candidate = tab?.candidates.get((command as any).id);
        const policyResult = checkCommand(command, tab?.url, candidate?.name);

        if (!policyResult.allowed) {
            const ack: CommandAck = {
                type: 'ack',
                commandId: command.commandId,
                status: 'fail',
                reason: policyResult.reason || 'Policy denied',
                timestamp: Date.now(),
            };
            logCommand(command, 'fail', policyResult.reason);
            resolve(ack);
            return;
        }

        // Send to extension
        if (!sendToExtension(command)) {
            const ack: CommandAck = {
                type: 'ack',
                commandId: command.commandId,
                status: 'fail',
                reason: 'No extension connected',
                timestamp: Date.now(),
            };
            resolve(ack);
            return;
        }

        // Set up timeout
        const timeout = setTimeout(() => {
            pendingCommands.delete(command.commandId);
            const ack: CommandAck = {
                type: 'ack',
                commandId: command.commandId,
                status: 'fail',
                reason: 'Command timeout',
                timestamp: Date.now(),
            };
            logCommand(command, 'fail', 'timeout');
            resolve(ack);
        }, 30000);

        pendingCommands.set(command.commandId, { resolve, timeout });
    });
}

/**
 * Handle REPL request
 */
async function handleReplRequest(ws: WebSocket, request: ReplRequest): Promise<void> {
    switch (request.type) {
        case 'subscribe': {
            const state = replConnections.get(ws);
            if (state) {
                state.subscribedTabId = request.tabId;
            }
            ws.send(JSON.stringify({ type: 'subscribed', tabId: request.tabId }));
            break;
        }

        case 'list_tabs': {
            const tabs = getTabs().map(t => ({
                tabId: t.tabId,
                url: t.url,
                candidateCount: t.candidates.size,
                lastUpdate: t.lastUpdate,
            }));
            ws.send(JSON.stringify({ type: 'tabs', tabs }));
            break;
        }

        case 'query': {
            const candidates = request.search
                ? searchCandidates(request.tabId, request.search, request.filters)
                : getCandidates(request.tabId);
            ws.send(JSON.stringify({ type: 'candidates', candidates }));
            break;
        }

        case 'act': {
            const command = request.command as Command;
            if (!command.commandId) {
                command.commandId = generateCommandId();
            }

            const ack = await executeCommand(command);
            ws.send(JSON.stringify(ack));
            break;
        }

        case 'navigate': {
            const url = request.url as string;
            if (!url) {
                ws.send(JSON.stringify({ type: 'navigate_result', success: false, error: 'No URL provided' }));
                break;
            }
            if (!cdp.isConnected()) {
                // Try to connect
                await cdp.connect(CDP_PORT);
            }
            const success = await cdp.navigate(url);
            ws.send(JSON.stringify({ type: 'navigate_result', success, url }));
            break;
        }

        case 'cdp_status': {
            const connected = cdp.isConnected();
            const targets = connected ? await cdp.listTargets() : [];
            ws.send(JSON.stringify({ type: 'cdp_status', connected, targets }));
            break;
        }

        case 'cdp_type': {
            const text = request.text as string;
            if (!text) {
                ws.send(JSON.stringify({ type: 'cdp_type_result', success: false, error: 'No text provided' }));
                break;
            }
            if (!cdp.isConnected()) {
                await cdp.connect(CDP_PORT);
            }
            try {
                await cdp.typeText(text);
                ws.send(JSON.stringify({ type: 'cdp_type_result', success: true }));
            } catch (error) {
                ws.send(JSON.stringify({ type: 'cdp_type_result', success: false, error: String(error) }));
            }
            break;
        }

        case 'cdp_key': {
            const key = request.key as string;
            if (!key) {
                ws.send(JSON.stringify({ type: 'cdp_key_result', success: false, error: 'No key provided' }));
                break;
            }
            if (!cdp.isConnected()) {
                await cdp.connect(CDP_PORT);
            }
            try {
                await cdp.pressKey(key);
                ws.send(JSON.stringify({ type: 'cdp_key_result', success: true }));
            } catch (error) {
                ws.send(JSON.stringify({ type: 'cdp_key_result', success: false, error: String(error) }));
            }
            break;
        }

        case 'cdp_eval': {
            const expression = request.expression as string;
            if (!expression) {
                ws.send(JSON.stringify({ type: 'cdp_eval_result', success: false, error: 'No expression provided' }));
                break;
            }
            if (!cdp.isConnected()) {
                await cdp.connect(CDP_PORT);
            }
            try {
                const result = await cdp.evaluate(expression);
                ws.send(JSON.stringify({ type: 'cdp_eval_result', success: true, result }));
            } catch (error) {
                ws.send(JSON.stringify({ type: 'cdp_eval_result', success: false, error: String(error) }));
            }
            break;
        }
    }
}

// Register plugins
await fastify.register(fastifyCors, { origin: true });
await fastify.register(fastifyWebsocket);

// Extension WebSocket endpoint
fastify.register(async (fastify) => {
    fastify.get('/extension', { websocket: true }, (connection: SocketStream, req) => {
        const socket = connection.socket;
        fastify.log.info('Extension connected');
        extensionConnections.add(socket);

        socket.on('message', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'ack') {
                    handleCommandAck(message as CommandAck);
                } else {
                    handleTelemetry(message as TelemetryMessage);
                }
            } catch (e) {
                fastify.log.error(`Failed to parse extension message: ${e}`);
            }
        });

        socket.on('close', () => {
            fastify.log.info('Extension disconnected');
            extensionConnections.delete(socket);
        });

        socket.on('error', (err: Error) => {
            fastify.log.error(`Extension socket error: ${err.message}`);
            extensionConnections.delete(socket);
        });
    });
});

// REPL WebSocket endpoint
fastify.register(async (fastify) => {
    fastify.get('/repl', { websocket: true }, (connection: SocketStream, req) => {
        const socket = connection.socket;
        fastify.log.info('REPL client connected');
        replConnections.set(socket, {});

        socket.on('message', async (data: Buffer) => {
            try {
                const request = JSON.parse(data.toString()) as ReplRequest;
                await handleReplRequest(socket, request);
            } catch (e) {
                fastify.log.error(`Failed to parse REPL message: ${e}`);
                socket.send(JSON.stringify({ type: 'error', message: String(e) }));
            }
        });

        socket.on('close', () => {
            fastify.log.info('REPL client disconnected');
            replConnections.delete(socket);
        });

        socket.on('error', (err: Error) => {
            fastify.log.error(`REPL socket error: ${err.message}`);
            replConnections.delete(socket);
        });
    });
});

// HTTP API endpoints
fastify.get('/status', async () => {
    return {
        status: 'ok',
        extensions: extensionConnections.size,
        replClients: replConnections.size,
        world: getWorldSummary(),
        policy: getPolicy(),
        rateLimit: getRateLimitStatus(),
    };
});

fastify.get('/tabs', async () => {
    return getTabs().map(t => ({
        tabId: t.tabId,
        url: t.url,
        candidateCount: t.candidates.size,
        viewport: t.viewport,
        lastUpdate: t.lastUpdate,
    }));
});

fastify.get('/tabs/:tabId/candidates', async (req) => {
    const { tabId } = req.params as { tabId: string };
    return getCandidates(parseInt(tabId, 10));
});

fastify.get('/tabs/:tabId/search', async (req) => {
    const { tabId } = req.params as { tabId: string };
    const { q, role, tag } = req.query as { q?: string; role?: string; tag?: string };
    return searchCandidates(parseInt(tabId, 10), q || '', { role, tag });
});

fastify.post('/command', async (req) => {
    const command = req.body as Command;
    return executeCommand(command);
});

fastify.get('/policy', async () => getPolicy());

fastify.post('/policy', async (req) => {
    updatePolicy(req.body as any);
    return { ok: true, policy: getPolicy() };
});

// Start server
try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     Browser Perception Backend Started                       ║
╠══════════════════════════════════════════════════════════════╣
║  WebSocket (Extension): ws://localhost:${PORT}/extension            ║
║  WebSocket (REPL):      ws://localhost:${PORT}/repl                 ║
║  HTTP API:              http://localhost:${PORT}                    ║
╚══════════════════════════════════════════════════════════════╝
`);
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
