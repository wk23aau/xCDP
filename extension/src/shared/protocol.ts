/**
 * Protocol definitions for Browser Perception & Control Plane
 * Shared types between extension, backend, and REPL bridge
 */

// ============================================================================
// Action Candidate (what the model sees)
// ============================================================================

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ActionState {
    disabled: boolean;
    expanded: boolean;
    checked: boolean;
    selected: boolean;
    focused: boolean;
}

export interface ActionContext {
    inModal: boolean;
    inNav: boolean;
    inForm: boolean;
    depth: number;
    formId?: string;
}

export interface StyleHint {
    isPrimary: boolean;
    isDanger: boolean;
    cursorPointer: boolean;
    backgroundColor?: string;
    textColor?: string;
}

export interface HitPoint {
    cx: number;
    cy: number;
}

export interface ActionCandidate {
    id: string;
    rect: Rect;
    rectN: Rect; // Normalized (0-1) relative to viewport
    role: string;
    tag: string;
    name: string;
    aria: string;
    placeholder?: string;
    value?: string;
    href?: string;
    state: ActionState;
    ctx: ActionContext;
    styleHint: StyleHint;
    hit: HitPoint;
    occluded: boolean;
    frameId?: number;
}

// ============================================================================
// ActionMap Delta (incremental updates)
// ============================================================================

export interface ActionMapSnapshot {
    type: 'snapshot';
    tabId: number;
    frameId: number;
    url: string;
    viewport: { width: number; height: number };
    timestamp: number;
    candidates: ActionCandidate[];
}

export interface ActionMapDelta {
    type: 'delta';
    tabId: number;
    frameId: number;
    timestamp: number;
    added: ActionCandidate[];
    removed: string[]; // IDs of removed candidates
    updated: Partial<ActionCandidate & { id: string }>[]; // Partial updates with required id
}

// ============================================================================
// Browser → Backend Messages (telemetry)
// ============================================================================

export interface HelloMessage {
    type: 'hello';
    tabId: number;
    url: string;
    viewport: { width: number; height: number };
    userAgent: string;
    timestamp: number;
}

export interface PointerMessage {
    type: 'pointer';
    tabId: number;
    x: number;
    y: number;
    buttons: number;
    timestamp: number;
}

export interface EventMessage {
    type: 'event';
    tabId: number;
    eventType: 'menu_opened' | 'menu_closed' | 'modal_opened' | 'modal_closed' | 'navigation' | 'load' | 'unload';
    anchorId?: string;
    submenuIds?: string[];
    url?: string;
    timestamp: number;
}

export type TelemetryMessage =
    | HelloMessage
    | ActionMapSnapshot
    | ActionMapDelta
    | PointerMessage
    | EventMessage;

// ============================================================================
// Backend → Browser Messages (commands)
// ============================================================================

export interface MoveMouseCommand {
    type: 'move_mouse';
    commandId: string;
    x: number;
    y: number;
    steps?: number;
    curve?: 'linear' | 'ease' | 'bezier';
    duration?: number;
}

export interface HoverCommand {
    type: 'hover';
    commandId: string;
    id: string;
    duration?: number;
}

export interface ClickCommand {
    type: 'click';
    commandId: string;
    id: string;
    button?: 'left' | 'right' | 'middle';
    modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
    clickCount?: number;
}

export interface TypeCommand {
    type: 'type';
    commandId: string;
    id: string;
    text: string;
    mode?: 'replace' | 'append' | 'prepend';
    delay?: number;
    clearFirst?: boolean;
}

export interface ScrollCommand {
    type: 'scroll';
    commandId: string;
    dx: number;
    dy: number;
    target?: string; // Element ID or 'viewport'
}

export interface FocusCommand {
    type: 'focus';
    commandId: string;
    id: string;
}

export interface SelectCommand {
    type: 'select';
    commandId: string;
    id: string;
    value: string | string[];
}

export interface CapturePatchCommand {
    type: 'capture_patch';
    commandId: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface QueryCommand {
    type: 'query';
    commandId: string;
    search: string; // Text search for elements
    filters?: {
        role?: string;
        tag?: string;
        visible?: boolean;
        enabled?: boolean;
    };
}

export type Command =
    | MoveMouseCommand
    | HoverCommand
    | ClickCommand
    | TypeCommand
    | ScrollCommand
    | FocusCommand
    | SelectCommand
    | CapturePatchCommand
    | QueryCommand;

// ============================================================================
// Command Acknowledgment (verification)
// ============================================================================

export interface CommandAckOk {
    type: 'ack';
    commandId: string;
    status: 'ok';
    timestamp: number;
    result?: unknown;
}

export interface CommandAckFail {
    type: 'ack';
    commandId: string;
    status: 'fail';
    reason: string;
    timestamp: number;
}

export interface CommandAckVerify {
    type: 'ack';
    commandId: string;
    status: 'verify';
    timestamp: number;
    verification: {
        id: string;
        stillVisible: boolean;
        hitTestOk: boolean;
        rectChanged: boolean;
        newRect?: Rect;
    };
}

export type CommandAck = CommandAckOk | CommandAckFail | CommandAckVerify;

// ============================================================================
// Connection & Configuration
// ============================================================================

export interface ConnectionConfig {
    wsUrl: string;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    heartbeatInterval: number;
    backpressureThreshold: number;
}

export const DEFAULT_CONFIG: ConnectionConfig = {
    wsUrl: 'ws://localhost:9333',
    reconnectInterval: 2000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 5000,
    backpressureThreshold: 100,
};

// ============================================================================
// Utility functions
// ============================================================================

export function generateId(): string {
    return `a_${Math.random().toString(36).substring(2, 8)}`;
}

export function generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}
