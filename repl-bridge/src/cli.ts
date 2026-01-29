#!/usr/bin/env node
/**
 * Perception CLI
 * Interactive command-line interface for browser control
 */

import * as readline from 'readline';
import { PerceptionBridge, ActionCandidate, CommandResult } from './bridge.js';

// ANSI colors (since chalk is ESM-only, use raw codes for simplicity)
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

const c = (color: keyof typeof colors, text: string) => `${colors[color]}${text}${colors.reset}`;

// Bridge instance
const bridge = new PerceptionBridge();

// Current tab
let currentTabId: number | null = null;

// Readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function print(message: string): void {
    console.log(message);
}

function printError(message: string): void {
    console.log(c('red', `✗ ${message}`));
}

function printSuccess(message: string): void {
    console.log(c('green', `✓ ${message}`));
}

function printCandidate(candidate: ActionCandidate): void {
    const role = c('cyan', candidate.role.padEnd(12));
    const name = candidate.name.substring(0, 40).padEnd(40);
    const id = c('gray', candidate.id);
    const flags: string[] = [];

    if (candidate.state.disabled) flags.push(c('red', 'disabled'));
    if (candidate.occluded) flags.push(c('yellow', 'occluded'));
    if (candidate.state.focused) flags.push(c('green', 'focused'));
    if (candidate.ctx.inModal) flags.push(c('magenta', 'modal'));

    print(`  ${role} ${name} ${id} ${flags.join(' ')}`);
}

function printResult(result: CommandResult): void {
    if (result.ok) {
        printSuccess(`Command ${result.commandId} - ${result.status}`);
        if (result.verification) {
            print(`    Visible: ${result.verification.stillVisible}, Hit OK: ${result.verification.hitTestOk}`);
        }
    } else {
        printError(`Command failed: ${result.reason}`);
    }
}

async function handleCommand(input: string): Promise<void> {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (!cmd) return;

    try {
        switch (cmd) {
            case 'help':
            case '?':
                print(`
${c('bold', 'Browser Perception CLI Commands')}

${c('cyan', 'Connection:')}
  connect                    Connect to backend
  disconnect                 Disconnect from backend
  status                     Show connection status

${c('cyan', 'Navigation:')}
  tabs                       List connected tabs
  use <tabId>                Select tab to work with
  
${c('cyan', 'Inspection:')}
  list [filter]              List candidates (optionally filtered)
  find <text>                Find candidates matching text
  roles                      List all roles in current tab
  
${c('cyan', 'Actions:')}
  click <id>                 Click element by ID
  click-text <text>          Click element by text
  type <id> <text>           Type text into element
  hover <id>                 Hover over element
  scroll <dx> <dy>           Scroll page
  focus <id>                 Focus element
  select <id> <value>        Select option in dropdown

${c('cyan', 'Other:')}
  clear                      Clear screen
  exit, quit                 Exit CLI
`);
                break;

            case 'connect':
                print('Connecting to backend...');
                await bridge.connect();
                printSuccess('Connected');
                break;

            case 'disconnect':
                bridge.disconnect();
                printSuccess('Disconnected');
                break;

            case 'status':
                print(`Connected: ${bridge.connected}`);
                print(`Current tab: ${currentTabId ?? 'none'}`);
                break;

            case 'tabs':
                if (!bridge.connected) {
                    printError('Not connected. Run "connect" first.');
                    break;
                }
                const tabs = await bridge.listTabs();
                if (tabs.length === 0) {
                    print('No tabs connected. Load the extension in Chrome.');
                } else {
                    print(`\n${c('bold', 'Connected Tabs:')}`);
                    for (const tab of tabs) {
                        const selected = tab.tabId === currentTabId ? c('green', ' ◀') : '';
                        print(`  [${c('cyan', String(tab.tabId))}] ${tab.url.substring(0, 60)} (${tab.candidateCount} candidates)${selected}`);
                    }
                }
                break;

            case 'use':
                const tabId = parseInt(parts[1], 10);
                if (isNaN(tabId)) {
                    printError('Usage: use <tabId>');
                    break;
                }
                currentTabId = tabId;
                await bridge.subscribe(tabId);
                printSuccess(`Using tab ${tabId}`);
                break;

            case 'go':
            case 'nav':
            case 'navigate':
                const navUrl = parts.slice(1).join(' ');
                if (!navUrl) {
                    printError('Usage: go <url>');
                    break;
                }
                print(`Navigating to ${navUrl}...`);
                const navResult = await bridge.navigate(navUrl);
                if (navResult.success) {
                    printSuccess(`Navigated to ${navUrl}`);
                } else {
                    printError(`Navigation failed: ${navResult.error || 'Unknown error'}`);
                }
                break;

            case 'cdptype':
            case 'rawtype':
                const typeTextArg = parts.slice(1).join(' ');
                if (!typeTextArg) {
                    printError('Usage: cdptype <text>');
                    break;
                }
                print(`Typing: "${typeTextArg}"...`);
                const typeRes = await bridge.cdpType(typeTextArg);
                if (typeRes.success) {
                    printSuccess('Typed successfully');
                } else {
                    printError(`Type failed: ${typeRes.error || 'Unknown error'}`);
                }
                break;

            case 'cdpkey':
            case 'key':
                const keyArg = parts[1];
                if (!keyArg) {
                    printError('Usage: cdpkey <key> (e.g., Enter, Tab, Escape)');
                    break;
                }
                const keyRes = await bridge.cdpKey(keyArg);
                if (keyRes.success) {
                    printSuccess(`Pressed ${keyArg}`);
                } else {
                    printError(`Key press failed: ${keyRes.error || 'Unknown error'}`);
                }
                break;

            case 'eval':
            case 'js':
                const expr = parts.slice(1).join(' ');
                if (!expr) {
                    printError('Usage: eval <javascript>');
                    break;
                }
                const evalRes = await bridge.cdpEval(expr);
                if (evalRes.success) {
                    printSuccess(`Result: ${JSON.stringify(evalRes.result)}`);
                } else {
                    printError(`Eval failed: ${evalRes.error || 'Unknown error'}`);
                }
                break;

            case 'list':
            case 'ls':
                if (!currentTabId) {
                    printError('No tab selected. Run "tabs" then "use <tabId>"');
                    break;
                }
                const filter = parts.slice(1).join(' ');
                const candidates = await bridge.query(currentTabId, filter || undefined);
                print(`\n${c('bold', `Candidates (${candidates.length}):`)} ${filter ? `(filter: "${filter}")` : ''}`);
                for (const c of candidates.slice(0, 50)) {
                    printCandidate(c);
                }
                if (candidates.length > 50) {
                    print(c('dim', `  ... and ${candidates.length - 50} more`));
                }
                break;

            case 'find':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                const searchText = parts.slice(1).join(' ');
                if (!searchText) {
                    printError('Usage: find <text>');
                    break;
                }
                const found = await bridge.query(currentTabId, searchText);
                print(`\n${c('bold', `Found ${found.length} matches:`)} "${searchText}"`);
                for (const c of found.slice(0, 20)) {
                    printCandidate(c);
                }
                break;

            case 'roles':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                const allCandidates = await bridge.query(currentTabId);
                const roles = new Map<string, number>();
                for (const c of allCandidates) {
                    roles.set(c.role, (roles.get(c.role) || 0) + 1);
                }
                print(`\n${c('bold', 'Roles:')}`);
                for (const [role, count] of [...roles.entries()].sort((a, b) => b[1] - a[1])) {
                    print(`  ${c('cyan', role.padEnd(15))} ${count}`);
                }
                break;

            case 'click':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                if (!parts[1]) {
                    printError('Usage: click <id>');
                    break;
                }
                const clickResult = await bridge.click(currentTabId, parts[1]);
                printResult(clickResult);
                break;

            case 'click-text':
            case 'clicktext':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                const clickTextArg = parts.slice(1).join(' ');
                if (!clickTextArg) {
                    printError('Usage: click-text <text>');
                    break;
                }
                const ctResult = await bridge.clickText(currentTabId, clickTextArg);
                printResult(ctResult);
                break;

            case 'type':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                if (!parts[1] || !parts[2]) {
                    printError('Usage: type <id> <text>');
                    break;
                }
                const typeText = parts.slice(2).join(' ');
                const typeResult = await bridge.type(currentTabId, parts[1], typeText);
                printResult(typeResult);
                break;

            case 'hover':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                if (!parts[1]) {
                    printError('Usage: hover <id>');
                    break;
                }
                const hoverResult = await bridge.hover(currentTabId, parts[1]);
                printResult(hoverResult);
                break;

            case 'scroll':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                const dx = parseInt(parts[1], 10) || 0;
                const dy = parseInt(parts[2], 10) || 0;
                const scrollResult = await bridge.scroll(currentTabId, dx, dy);
                printResult(scrollResult);
                break;

            case 'focus':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                if (!parts[1]) {
                    printError('Usage: focus <id>');
                    break;
                }
                const focusResult = await bridge.focus(currentTabId, parts[1]);
                printResult(focusResult);
                break;

            case 'select':
                if (!currentTabId) {
                    printError('No tab selected');
                    break;
                }
                if (!parts[1] || !parts[2]) {
                    printError('Usage: select <id> <value>');
                    break;
                }
                const selectResult = await bridge.select(currentTabId, parts[1], parts.slice(2).join(' '));
                printResult(selectResult);
                break;

            case 'clear':
                console.clear();
                break;

            case 'exit':
            case 'quit':
            case 'q':
                bridge.disconnect();
                rl.close();
                process.exit(0);
                break;

            default:
                printError(`Unknown command: ${cmd}. Type "help" for available commands.`);
        }
    } catch (error) {
        printError(`Error: ${(error as Error).message}`);
    }
}

function prompt(): void {
    const tabInfo = currentTabId ? c('cyan', `[${currentTabId}]`) : c('gray', '[no tab]');
    const connected = bridge.connected ? c('green', '●') : c('red', '○');
    rl.question(`${connected} ${tabInfo} ${c('bold', '>')} `, async (input) => {
        await handleCommand(input);
        prompt();
    });
}

// Main
async function main(): Promise<void> {
    print(`
${c('bold', '╔══════════════════════════════════════════════════════════════╗')}
${c('bold', '║')}     ${c('cyan', 'Browser Perception CLI')}                                 ${c('bold', '║')}
${c('bold', '╚══════════════════════════════════════════════════════════════╝')}

Type ${c('cyan', 'help')} for available commands.
`);

    // Auto-connect
    print('Connecting to backend...');
    try {
        await bridge.connect();
        printSuccess('Connected to ws://localhost:9333/repl');
    } catch (e) {
        printError(`Could not connect: ${(e as Error).message}`);
        print('Start the backend with: cd backend && npm run dev');
    }

    // Event handlers
    bridge.on('disconnected', () => {
        print(c('yellow', '\n⚠ Disconnected from backend'));
    });

    bridge.on('connected', () => {
        print(c('green', '\n✓ Reconnected to backend'));
    });

    bridge.on('snapshot', (msg) => {
        if (msg.tabId === currentTabId) {
            print(c('dim', `\n[Snapshot: ${msg.candidates.length} candidates]`));
        }
    });

    // Start prompt
    prompt();
}

main().catch(console.error);
