# Guji Reader V0.1 Rules

1. This is a small local-first reading tool, not a general Reading OS.
2. Do not add features outside docs/V0.1_PLAN.md unless the human explicitly changes scope.
3. Canonical source text is immutable to AI. AI may only create separate annotations.
4. Source notes, AI notes, and user notes must remain distinguishable in data and UI.
5. Never commit API keys, tokens, cookies, or .env.
6. V0.1 has no FastAPI server, no database server, no vector database, no auth, no cloud sync.
7. Prefer simple data files and deterministic transforms.
8. User text selection is limited to one passage in V0.1.
9. Do not silently “fix” source text. Report suspected source errors separately.
10. Importers fail loudly on incomplete or structurally unexpected source data.
11. Every non-trivial feature needs at least one test.
12. Do not refactor working code merely for elegance during the sprint.
13. Avoid introducing a dependency when browser/standard-library code is clearly sufficient.
14. Keep Chinese UI labels concise.
15. Before declaring V0.1 complete, run the full test suite and the independent reviewer.
