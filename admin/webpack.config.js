import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default (_env, argv) => {
  const isProd = argv?.mode === 'production';
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3005';
  return {
    mode: isProd ? 'production' : 'development',
    entry: './src/index.tsx',
    devtool: isProd ? false : 'source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash:8].js' : '[name].js',
      publicPath: '/',
      clean: true,
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [{ test: /\.tsx?$/, use: { loader: 'ts-loader', options: { onlyCompileBundledFiles: true } }, exclude: /node_modules/ }],
    },
    devServer: {
      static: path.join(__dirname, 'public'),
      historyApiFallback: true,
      port: Number(process.env.ADMIN_DEV_PORT || 3002),
      open: false,
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      new webpack.DefinePlugin({
        'process.env.REACT_APP_API_BASE_URL': JSON.stringify(apiBaseUrl),
      }),
      {
        apply: (compiler) => {
          compiler.hooks.thisCompilation.tap('AdminStatic', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'AdminStatic', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
              () => {
                // Static hosts (Render, Netlify) send every path to the app.
                compilation.emitAsset('_redirects', new webpack.sources.RawSource('/*    /index.html   200\n'));
              },
            );
          });
        },
      },
    ],
  };
};
