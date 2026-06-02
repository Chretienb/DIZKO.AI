// Focused config that runs ONLY the theme-token guardrail
// (dizko/no-legacy-theme-colors). Used by `npm run lint:theme` and CI so the
// guardrail is enforced on every PR without depending on the rest of the lint
// baseline being green. See eslint-rules/no-legacy-theme-colors.js.
import reactHooks from 'eslint-plugin-react-hooks'
import noLegacyThemeColors from './eslint-rules/no-legacy-theme-colors.js'

export default [
  {
    ignores: [
      'dist',
      // Auth / legal / splash screens keep a fixed dark look by design.
      'src/Login.jsx', 'src/Onboarding.jsx', 'src/Welcome.jsx', 'src/Splash.jsx',
      'src/Terms.jsx', 'src/Privacy.jsx', 'src/ResetPassword.jsx', 'src/pages/Legal.jsx',
      'src/stories/**', '**/*.stories.{js,jsx}', 'eslint-rules/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    // react-hooks is registered (not enabled) only so existing inline
    // `eslint-disable react-hooks/*` directives resolve instead of erroring.
    plugins: { dizko: { rules: { 'no-legacy-theme-colors': noLegacyThemeColors } }, 'react-hooks': reactHooks },
    languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: { 'dizko/no-legacy-theme-colors': 'error' },
  },
]
