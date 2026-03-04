const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
    entryPoints: [path.join(__dirname, 'excalidraw-app.jsx')],
    bundle: true,
    outfile: path.join(__dirname, 'public', 'js', 'excalidraw-bundle.js'),
    format: 'iife',
    globalName: 'ExcalidrawApp',
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.IS_PREACT': 'false'
    },
    loader: {
        '.js': 'jsx',
        '.jsx': 'jsx',
        '.woff2': 'file',
        '.woff': 'file',
        '.ttf': 'file',
        '.png': 'file',
        '.svg': 'file'
    },
    alias: {
        // Resolve Excalidraw's internal imports
    },
    logLevel: 'info'
}).then(() => {
    console.log('✅  Excalidraw bundle built successfully → public/js/excalidraw-bundle.js');
}).catch((err) => {
    console.error('❌  Excalidraw build failed:', err);
    process.exit(1);
});
