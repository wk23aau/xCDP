/**
 * Protocol definitions for Backend
 * Mirrors extension/src/shared/protocol.ts but standalone for backend
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
    rectN: Rect;
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
// ActionMap Messages
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
    removed: string[];
    updated: Partial<ActionCandidate & { id: string }>[];
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

export interface HeartbeatMessage {
    type: 'heartbeat';
    timestamp: number;
}

export type TelemetryMessage =
    | HelloMessage
    | ActionMapSnapshot
    | ActionMapDelta
    | PointerMessage
    | EventMessage
    | HeartbeatMessage;

// ============================================================================
// Backend → Browser Messages (commands)
// ============================================================================

export interface MoveMouseCommand {
    type: 'move_mouse';
    commandId: string;
    tabId: number;
    x: number;
    y: number;
    steps?: number;
    curve?: 'linear' | 'ease' | 'bezier';
    duration?: number;
}

export interface HoverCommand {
    type: 'hover';
    commandId: string;
    tabId: number;
    id: string;
    duration?: number;
}

export interface ClickCommand {
    type: 'click';
    commandId: string;
    tabId: number;
    id: string;
    button?: 'left' | 'right' | 'middle';
    modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
    clickCount?: number;
}

export interface TypeCommand {
    type: 'type';
    commandId: string;
    tabId: number;
    id: string;
    text: string;
    mode?: 'replace' | 'append' | 'prepend';
    delay?: number;
    clearFirst?: boolean;
}

export interface ScrollCommand {
    type: 'scroll';
    commandId: string;
    tabId: number;
    dx: number;
    dy: number;
    target?: string;
}

export interface FocusCommand {
    type: 'focus';
    commandId: string;
    tabId: number;
    id: string;
}

export interface SelectCommand {
    type: 'select';
    commandId: string;
    tabId: number;
    id: string;
    value: string | string[];
}

export interface QueryCommand {
    type: 'query';
    commandId: string;
    tabId: number;
    search: string;
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
    | QueryCommand;

// ============================================================================
// Command Acknowledgment
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
// REPL Bridge API Messages
// ============================================================================

export interface SubscribeRequest {
    type: 'subscribe';
    tabId?: number; // Optional - subscribe to specific tab or all
}

export interface ActRequest {
    type: 'act';
    command: Omit<Command, 'commandId'> & { commandId?: string };
}

export interface QueryRequest {
    type: 'query';
    tabId: number;
    search?: string;
    filters?: {
        role?: string;
        tag?: string;
        visible?: boolean;
        enabled?: boolean;
    };
}

export interface ListTabsRequest {
    type: 'list_tabs';
}

export interface NavigateRequest {
    type: 'navigate';
    url: string;
}

export interface CDPStatusRequest {
    type: 'cdp_status';
}

export interface CDPTypeRequest {
    type: 'cdp_type';
    text: string;
}

export interface CDPKeyRequest {
    type: 'cdp_key';
    key: string;
}

export interface CDPEvalRequest {
    type: 'cdp_eval';
    expression: string;
}

export type ReplRequest = SubscribeRequest | ActRequest | QueryRequest | ListTabsRequest | NavigateRequest | CDPStatusRequest | CDPTypeRequest | CDPKeyRequest | CDPEvalRequest;

// ============================================================================
// Utility
// ============================================================================

export function generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}
