# Android internal testing checklist (RAZ-87)

Use this checklist before promoting an Android build beyond Play Internal testing.

## Build metadata

- Build date:
- App version name:
- App version code:
- Package name:
- Signing fingerprint:
- Tester devices (model + Android version):

## Install and launch

- [ ] Install succeeds from Play Internal testing link.
- [ ] App launches without browser URL bar (TWA fullscreen behavior).
- [ ] Cold start and warm start both work.
- [ ] App resume after backgrounding works.

## Authentication

- [ ] Sign in works.
- [ ] Sign out works.
- [ ] Session persists after app restart.
- [ ] Session behavior is correct after token refresh window.

## Gameplay core

- [ ] Random puzzle can be started and completed.
- [ ] Daily puzzle can be started and completed.
- [ ] Completion submit succeeds and leaderboard flow works.
- [ ] Technique Journey lessons open and complete.
- [ ] Profile and leaderboard pages render correctly.

## UX and platform behavior

- [ ] Android back button closes dialogs before route/app exit.
- [ ] Keyboard/number input is reliable on mobile.
- [ ] Haptics/settings controls behave as expected.
- [ ] No major layout overflow issues on tested devices.

## Network and reliability

- [ ] Flaky network does not corrupt in-progress session.
- [ ] Temporary offline state produces understandable behavior.
- [ ] Recovery after reconnect works.

## Release gate

- [ ] No P0 issues.
- [ ] No unresolved P1 issues.
- [ ] Go/No-go decision documented.
- [ ] If no-go, rollback/next-action owner assigned.

## Notes and known issues

- Notes:
- Known issues:
- Follow-up tickets:
