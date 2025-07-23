module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  overrides: [
    {
      files: ['**/frontend/**/*.{ts,tsx}'],
      extends: [
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
      ],
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      plugins: [
        'react',
        'react-hooks',
      ],
      rules: {
        'react/react-in-jsx-scope': 'off',
      },
    },
    {
      files: ['**/backend/**/*.ts'],
      extends: [
        'plugin:prettier/recommended',
      ],
      plugins: [
        'prettier',
      ],
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
  ],
}; 