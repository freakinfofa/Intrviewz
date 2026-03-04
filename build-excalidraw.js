const esbuild = require('esbuild');
const path = require('path');

// Build the bundle with React included
esbuild.build({
    entryPoints: [path.join(__dirname, 'excalidraw-app.jsx')],
    bundle: true,
    outfile: path.join(__dirname, 'public', 'js', 'excalidraw-bundle.js'),
    format: 'iife',
    platform: 'browser',
    minify: false, // Keep unminified for debugging
    sourcemap: false,
    target: ['chrome90'],
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.IS_PREACT': 'false'
    },
    loader: {
        '.jsx': 'jsx'
    },
    logLevel: 'info'
}).then(() => {
    console.log('✅  Excalidraw bundle built successfully → public/js/excalidraw-bundle.js');
}).catch((err) => {
    console.error('❌  Excalidraw build failed:', err);
    process.exit(1);
});
