<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Dizko — a React/Vite music collaboration SPA. `posthog-js` was installed and initialized in `src/lib/posthog.js`, which is bootstrapped from `src/main.jsx` alongside the existing Sentry monitoring. Ten events covering the full user journey — from first signup through project creation, stem uploads, collaboration, and subscription — have been instrumented across six source files. Users are identified on login and signup via `posthog.identify()` with their Supabase user ID as the distinct ID.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | Fired when a new user successfully creates an account via email/password. | `src/Login.jsx` |
| `user_logged_in` | Fired when an existing user successfully signs in via email/password. | `src/Login.jsx` |
| `project_created` | Fired when a user successfully creates a new music project. | `src/App.jsx` |
| `stem_uploaded` | Fired when one or more audio stems finish uploading to a project. | `src/App.jsx` |
| `collaborator_invited` | Fired when a user sends an invitation to a collaborator. | `src/pages/Invite.jsx` |
| `paywall_hit` | Fired when an unpaid user hits the billing gate for a paid feature. | `src/App.jsx` |
| `subscription_started` | Fired when a user lands on the billing success page after completing checkout. | `src/main.jsx` |
| `audio_played` | Fired when a user starts playing an audio track in the mini-player. | `src/App.jsx` |
| `project_viewed` | Fired when a user opens a project detail page. | `src/pages/ProjectView.jsx` |
| `onboarding_completed` | Fired when a user completes the onboarding checklist after subscribing. | `src/Onboarding.jsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/489254/dashboard/1770487)
- [New signups over time](https://us.posthog.com/project/489254/insights/pBoLN7mi)
- [Core activity — projects & stems](https://us.posthog.com/project/489254/insights/rb2nwJsm)
- [Activation funnel: signup → project → stem](https://us.posthog.com/project/489254/insights/hjb2j5wQ)
- [Paywall hits — feature gate friction](https://us.posthog.com/project/489254/insights/TFBBSMJm)
- [Collaboration — invites & subscriptions](https://us.posthog.com/project/489254/insights/6StS2cI5)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` to `.env.example` and any bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — a handler that only identifies on fresh login can leave returning sessions on anonymous distinct IDs.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
