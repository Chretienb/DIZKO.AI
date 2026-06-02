// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

import noLegacyThemeColors from './eslint-rules/no-legacy-theme-colors.js'

export default defineConfig([globalIgnores(['dist']), {
  files: ['**/*.{js,jsx}'],
  plugins: { dizko: { rules: { 'no-legacy-theme-colors': noLegacyThemeColors } } },
  extends: [
    js.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
  ],
  languageOptions: {
    globals: globals.browser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  rules: {
    'dizko/no-legacy-theme-colors': 'error',
  },
}, {
  // Auth / legal / splash screens keep their fixed dark cinematic look by
  // design — they don't participate in the light/dark token system.
  files: [
    'src/Login.jsx', 'src/Onboarding.jsx', 'src/Welcome.jsx', 'src/Splash.jsx',
    'src/Terms.jsx', 'src/Privacy.jsx', 'src/ResetPassword.jsx', 'src/pages/Legal.jsx',
    'src/stories/**', '**/*.stories.{js,jsx}', 'eslint-rules/**',
  ],
  rules: { 'dizko/no-legacy-theme-colors': 'off' },
}, ...storybook.configs["flat/recommended"]])
