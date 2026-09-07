import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveBuildSha() {
    const fromEnv = (process.env.RENDER_GIT_COMMIT || process.env.REACT_APP_BUILD_SHA || '').trim();
    if (fromEnv) {
        return fromEnv.slice(0, 7);
    }
    try {
        return execSync('git rev-parse --short HEAD', {
            encoding: 'utf8',
            cwd: path.resolve(__dirname, '..'),
        }).trim();
    } catch {
        return 'unknown';
    }
}

function formatBuildTimeUtc(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm} UTC`;
}

export default async (_env, argv) => {
    const mode = argv?.mode === 'production' ? 'production' : 'development';
    const isProd = mode === 'production';
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
    const buildSha = resolveBuildSha();
    const buildTime = formatBuildTimeUtc();

    return {
        mode,
        entry: './src/index.tsx',
        devtool: isProd ? false : 'source-map',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'bundle.js',
            publicPath: '/',
            clean: true,
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
            plugins: [new TsconfigPathsPlugin()],
        },
        devServer: {
            static: path.join(__dirname, 'public'),
            historyApiFallback: true,
            port: 3000,
            open: true,
            hot: true,
        },
        module: {
            rules: [
                {
                    test: /\.(ts|tsx)$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            onlyCompileBundledFiles: true,
                        },
                    },
                    exclude: /node_modules/,
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader', 'postcss-loader'],
                },
            ],
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: './public/index.html',
            }),
            new webpack.DefinePlugin({
                'process.env.REACT_APP_API_BASE_URL': JSON.stringify(apiBaseUrl),
                __BUILD_SHA__: JSON.stringify(buildSha),
                __BUILD_TIME__: JSON.stringify(buildTime),
            }),
            {
                apply: (compiler) => {
                    compiler.hooks.thisCompilation.tap('EmitStaticHostFiles', (compilation) => {
                        compilation.hooks.processAssets.tap(
                            {
                                name: 'EmitStaticHostFiles',
                                stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                            },
                            () => {
                                compilation.emitAsset(
                                    '_redirects',
                                    new webpack.sources.RawSource('/*    /index.html   200\n'),
                                );
                                const publicFiles = [
                                    'favicon.svg',
                                    'manifest.webmanifest',
                                    'sw.js',
                                    'icon-192.png',
                                    'icon-512.png',
                                    'apple-touch-icon.png',
                                ];
                                for (const fileName of publicFiles) {
                                    const filePath = path.join(__dirname, 'public', fileName);
                                    if (!fs.existsSync(filePath)) continue;
                                    compilation.emitAsset(
                                        fileName,
                                        new webpack.sources.RawSource(fs.readFileSync(filePath)),
                                    );
                                }
                            },
                        );
                    });
                },
            },
        ],
    };
};
