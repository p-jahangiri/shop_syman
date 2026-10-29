# Project instructions

Use the project skill at `skills/dynamic-shop/SKILL.md` for this repository. Start with `docs/STATUS.md`, then follow `docs/PLAN.md`. Record user answers in `docs/DECISIONS.md`. All financial amounts are integer rial, serialized as decimal strings to JavaScript clients. Do not replace the stack specified by the source PDF. Keep development substitutes explicit and unavailable in production. Continue implementation of the next ready slice; report blocked external dependencies without marking them complete.

Owner decision D44: keep one running local shop on storefront3000/API5080/admin3173 and the Sayman database. Apply requested changes there; do not create or deliver separate persistent QA/test/preview versions. Routine local migrations/restarts within the requested work are authorized. Automated tests may use short-lived fixtures. Older local promotion gates are historical and superseded by D44.
