/**
 * Build script for Browser Perception Extension
 * Uses esbuild to bundle TypeScript files
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

// Ensure dist directories exist
const dirs = [
    distDir,
    path.join(distDir, 'background'),
    path.join(distDir, 'content'),
    path.join(distDir, 'shared'),
];

for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Build configurations
const commonConfig = {
    bundle: true,
    minify: false,
    sourcemap: true,
    target: ['chrome120'],
    format: 'esm',
    logLevel: 'info',
};

async function build() {
    console.log('Building extension...');

    try {
        // Build content script
        await esbuild.build({
            ...commonConfig,
            entryPoints: [path.join(srcDir, 'content/index.ts')],
            outfile: path.join(distDir, 'content/index.js'),
            format: 'iife', // Content scripts need IIFE format
        });
        console.log('✓ Content script built');

        // Build background service worker
        await esbuild.build({
            ...commonConfig,
            entryPoints: [path.join(srcDir, 'background/service-worker.ts')],
            outfile: path.join(distDir, 'background/service-worker.js'),
            format: 'esm',
        });
        console.log('✓ Service worker built');

        console.log('\nBuild complete! Load the extension from:', rootDir);
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

// Watch mode
async function watch() {
    console.log('Watching for changes...');

    const contentCtx = await esbuild.context({
        ...commonConfig,
        entryPoints: [path.join(srcDir, 'content/index.ts')],
        outfile: path.join(distDir, 'content/index.js'),
        format: 'iife',
    });

    const bgCtx = await esbuild.context({
        ...commonConfig,
        entryPoints: [path.join(srcDir, 'background/service-worker.ts')],
        outfile: path.join(distDir, 'background/service-worker.js'),
        format: 'esm',
    });

    await Promise.all([
        contentCtx.watch(),
        bgCtx.watch(),
    ]);

    console.log('Watching for changes... Press Ctrl+C to stop.');
}

// Run
const args = process.argv.slice(2);
if (args.includes('--watch')) {
    watch();
} else {
    build();
}
