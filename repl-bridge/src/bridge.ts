/**
 * Browser Perception Bridge
 * Connects to backend and provides programmatic API for browser control
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Types (inline to avoid import issues)
export interface ActionCandidate {
    id: string;
    rect: { x: number; y: number; w: number; h: number };
    rectN: { x: number; y: number; w: number; h: number };
    role: string;
    tag: string;
    name: string;
    aria: string;
    placeholder?: string;
    value?: string;
    href?: string;
    state: {
        disabled: boolean;
        expanded: boolean;
        checked: boolean;
        selected: boolean;
        focused: boolean;
    };
    ctx: {
        inModal: boolean;
        inNav: boolean;
        inForm: boolean;
        depth: number;
    };
    styleHint: {
        isPrimary: boolean;
        isDanger: boolean;
        cursorPointer: boolean;
    };
    hit: { cx: number; cy: number };
    occluded: boolean;
}

export interface CommandResult {
    ok: boolean;
    commandId: string;
    status: 'ok' | 'fail' | 'verify';
    reason?: string;
    result?: unknown;
    verification?: {
        id: string;
        stillVisible: boolean;
        hitTestOk: boolean;
        rectChanged: boolean;
    };
}

export interface TabInfo {
    tabId: number;
    url: string;
    candidateCount: number;
    lastUpdate: number;
}

export interface BridgeOptions {
    url?: string;
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

export type BridgeEvent =
    | 'connected'
    | 'disconnected'
    | 'error'
    | 'snapshot'
    | 'delta'
    | 'event'
    | 'ack';

/**
 * Perception Bridge - main API for browser control
 */
export class PerceptionBridge extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private autoReconnect: boolean;
    private reconnectInterval: number;
    private maxReconnectAttempts: number;
    private reconnectAttempts = 0;
    private isConnecting = false;
    private pendingRequests = new Map<string, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
    }>();

    private _connected = false;
    private _subscribedTabId?: number;

    constructor(options: BridgeOptions = {}) {
        super();
        this.url = options.url || 'ws://localhost:9333/repl';
        this.autoReconnect = options.autoReconnect ?? true;
        this.reconnectInterval = options.reconnectInterval || 2000;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    }

    get connected(): boolean {
        return this._connected;
    }

    get subscribedTabId(): number | undefined {
        return this._subscribedTabId;
    }

    /**
     * Connect to backend
     */
    async connect(): Promise<void> {
        if (this._connected || this.isConnecting) return;

        return new Promise((resolve, reject) => {
            this.isConnecting = true;

            try {
                this.ws = new WebSocket(this.url);

                this.ws.on('open', () => {
                    this._connected = true;
                    this.isConnecting = false;
                    this.reconnectAttempts = 0;
                    this.emit('connected');
                    resolve();
                });

                this.ws.on('message', (data) => {
                    this.handleMessage(data.toString());
                });

                this.ws.on('close', () => {
                    this._connected = false;
                    this.emit('disconnected');
                    this.attemptReconnect();
                });

                this.ws.on('error', (err) => {
                    this.isConnecting = false;
                    this.emit('error', err);
                    if (!this._connected) {
                        reject(err);
                    }
                });
            } catch (err) {
                this.isConnecting = false;
                reject(err);
            }
        });
    }

    /**
     * Disconnect from backend
     */
    disconnect(): void {
        this.autoReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
    }

    /**
     * Attempt reconnection
     */
    private attemptReconnect(): void {
        if (!this.autoReconnect) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

        this.reconnectAttempts++;
        setTimeout(() => {
            if (!this._connected && this.autoReconnect) {
                this.connect().catch(() => { });
            }
        }, this.reconnectInterval);
    }

    /**
     * Handle incoming message
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data);

            // Map response types to request types
            const responseToRequestType: Record<string, string> = {
                'tabs': 'list_tabs',
                'candidates': 'query',
                'subscribed': 'subscribe',
                'navigate_result': 'navigate',
                'cdp_status': 'cdp_status',
                'cdp_type_result': 'cdp_type',
                'cdp_key_result': 'cdp_key',
                'cdp_eval_result': 'cdp_eval',
            };

            // Check for pending request response
            if (message.type === 'tabs' || message.type === 'candidates' || message.type === 'subscribed'
                || message.type === 'navigate_result' || message.type === 'cdp_status'
                || message.type === 'cdp_type_result' || message.type === 'cdp_key_result' || message.type === 'cdp_eval_result') {
                const requestType = responseToRequestType[message.type] || message.type;
                const pending = this.pendingRequests.get(requestType);
                if (pending) {
                    pending.resolve(message);
                    this.pendingRequests.delete(requestType);
                    return;
                }
            }

            // Check for command ack
            if (message.type === 'ack') {
                const pending = this.pendingRequests.get(message.commandId);
                if (pending) {
                    pending.resolve(message);
                    this.pendingRequests.delete(message.commandId);
                }
                this.emit('ack', message);
                return;
            }

            // Emit appropriate event
            switch (message.type) {
                case 'snapshot':
                    this.emit('snapshot', message);
                    break;
                case 'delta':
                    this.emit('delta', message);
                    break;
                case 'event':
                    this.emit('event', message);
                    break;
                case 'error':
                    this.emit('error', new Error(message.message));
                    break;
            }
        } catch (e) {
            this.emit('error', new Error(`Failed to parse message: ${e}`));
        }
    }

    /**
     * Send request and wait for response
     */
    private async request<T>(type: string, data: any = {}): Promise<T> {
        if (!this.ws || !this._connected) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            const key = data.commandId || type;
            this.pendingRequests.set(key, { resolve, reject });

            this.ws!.send(JSON.stringify({ type, ...data }));

            // Timeout
            setTimeout(() => {
                if (this.pendingRequests.has(key)) {
                    this.pendingRequests.delete(key);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    /**
     * List all connected tabs
     */
    async listTabs(): Promise<TabInfo[]> {
        const response = await this.request<{ type: string; tabs: TabInfo[] }>('list_tabs');
        return response.tabs;
    }

    /**
     * Subscribe to tab updates
     */
    async subscribe(tabId?: number): Promise<void> {
        await this.request('subscribe', { tabId });
        this._subscribedTabId = tabId;
    }

    /**
     * Navigate to URL using CDP
     */
    async navigate(url: string): Promise<{ success: boolean; url?: string; error?: string }> {
        const response = await this.request<{ type: string; success: boolean; url?: string; error?: string }>(
            'navigate',
            { url }
        );
        return { success: response.success, url: response.url, error: response.error };
    }

    /**
     * Type text using CDP keyboard input
     */
    async cdpType(text: string): Promise<{ success: boolean; error?: string }> {
        const response = await this.request<{ type: string; success: boolean; error?: string }>(
            'cdp_type',
            { text }
        );
        return { success: response.success, error: response.error };
    }

    /**
     * Press a key using CDP keyboard input
     */
    async cdpKey(key: string): Promise<{ success: boolean; error?: string }> {
        const response = await this.request<{ type: string; success: boolean; error?: string }>(
            'cdp_key',
            { key }
        );
        return { success: response.success, error: response.error };
    }

    /**
     * Evaluate JavaScript in the page using CDP
     */
    async cdpEval(expression: string): Promise<{ success: boolean; result?: any; error?: string }> {
        const response = await this.request<{ type: string; success: boolean; result?: any; error?: string }>(
            'cdp_eval',
            { expression }
        );
        return { success: response.success, result: response.result, error: response.error };
    }

    /**
     * Query candidates
     */
    async query(
        tabId: number,
        search?: string,
        filters?: { role?: string; tag?: string; visible?: boolean; enabled?: boolean }
    ): Promise<ActionCandidate[]> {
        const response = await this.request<{ type: string; candidates: ActionCandidate[] }>(
            'query',
            { tabId, search, filters }
        );
        return response.candidates;
    }

    /**
     * Execute a command
     */
    private async act(command: any): Promise<CommandResult> {
        const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        command.commandId = commandId;

        const response = await this.request<any>('act', { command });

        return {
            ok: response.status === 'ok' || response.status === 'verify',
            commandId: response.commandId,
            status: response.status,
            reason: response.reason,
            result: response.result,
            verification: response.verification,
        };
    }

    // ============================================================================
    // High-level API
    // ============================================================================

    /**
     * Click an element by ID
     */
    async click(tabId: number, id: string, options: {
        button?: 'left' | 'right' | 'middle';
        modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
        clickCount?: number;
    } = {}): Promise<CommandResult> {
        return this.act({
            type: 'click',
            tabId,
            id,
            ...options,
        });
    }

    /**
     * Type text into an element
     */
    async type(tabId: number, id: string, text: string, options: {
        clearFirst?: boolean;
        delay?: number;
    } = {}): Promise<CommandResult> {
        return this.act({
            type: 'type',
            tabId,
            id,
            text,
            clearFirst: options.clearFirst ?? true,
            delay: options.delay,
        });
    }

    /**
     * Hover over an element
     */
    async hover(tabId: number, id: string, duration?: number): Promise<CommandResult> {
        return this.act({
            type: 'hover',
            tabId,
            id,
            duration,
        });
    }

    /**
     * Scroll the page or element
     */
    async scroll(tabId: number, dx: number, dy: number, target?: string): Promise<CommandResult> {
        return this.act({
            type: 'scroll',
            tabId,
            dx,
            dy,
            target,
        });
    }

    /**
     * Focus an element
     */
    async focus(tabId: number, id: string): Promise<CommandResult> {
        return this.act({
            type: 'focus',
            tabId,
            id,
        });
    }

    /**
     * Select option in a dropdown
     */
    async select(tabId: number, id: string, value: string | string[]): Promise<CommandResult> {
        return this.act({
            type: 'select',
            tabId,
            id,
            value,
        });
    }

    /**
     * Find element by text (convenience method)
     */
    async find(tabId: number, text: string, options?: {
        role?: string;
        tag?: string;
    }): Promise<ActionCandidate | null> {
        const candidates = await this.query(tabId, text, options);
        return candidates[0] || null;
    }

    /**
     * Click element by text (convenience method)
     */
    async clickText(tabId: number, text: string, options?: {
        role?: string;
    }): Promise<CommandResult> {
        const candidate = await this.find(tabId, text, options);
        if (!candidate) {
            return {
                ok: false,
                commandId: '',
                status: 'fail',
                reason: `Element not found: "${text}"`,
            };
        }
        return this.click(tabId, candidate.id);
    }

    /**
     * Type into element by text/placeholder (convenience method)
     */
    async typeInto(tabId: number, labelOrPlaceholder: string, text: string): Promise<CommandResult> {
        const candidates = await this.query(tabId, labelOrPlaceholder);
        const input = candidates.find(c =>
            c.role === 'textbox' || c.role === 'searchbox' || c.role === 'combobox' ||
            c.tag === 'input' || c.tag === 'textarea'
        );

        if (!input) {
            return {
                ok: false,
                commandId: '',
                status: 'fail',
                reason: `Input not found: "${labelOrPlaceholder}"`,
            };
        }
        return this.type(tabId, input.id, text);
    }
}

// Default export
export default PerceptionBridge;
