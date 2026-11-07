# Browser acceptance

- Verify the canonical artifact and live URLs first. Use a separate task-owned tab and preserve the owner's tabs, forms, theme and session. Pause if the owner is active in Chrome; obtain explicit authorization before controlling it while they are active.
- Observe the relevant flow in Persian RTL and English LTR, light and dark, desktop and mobile (for example 1440 and 390 CSS px). Test keyboard order, visible focus and focus return, labels, zoom or wrapping, reduced motion when relevant, and loading, empty, error and success states.
- Verify visible results and the supporting network/readback or persisted outcome when appropriate. Do not exercise real purchases, send real messages, or alter the owner's accounts, catalog or settings as incidental QA. Use owned short-lived fixtures for write acceptance where available.
- Use an existing authorized session only as permitted; let the owner enter credentials and Authenticator codes in the private form. Do not capture them in screenshots, logs or evidence. Report private flows separately when they cannot be observed.
- Record browser, viewport, direction, theme, case counts, environment and artifact. Distinguish public observation, emulation, actual hardware, authenticated workflows, owner confirmation and production. A screenshot, a synthetic response and a local lab metric each prove only their own scope.
- Clean up only the tabs, emulation and tooling created for the check. Record what was not verified and why.
