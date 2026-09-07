import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (_env, argv) => {
    const mode = argv?.mode === 'production' ? 'production' : 'development';
    const isProd = mode === 'production';
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

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
