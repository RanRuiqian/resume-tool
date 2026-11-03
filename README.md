# Bilingual Resume Builder

English | [中文](./README.zh-CN.md)

A browser-only, privacy-first, open-source resume tool. Keep a structured career library locally → upload a job-post screenshot or paste the JD → AI parses the role, picks and rewrites relevant entries from your library (**never fabricating**) → one click downloads a zip with **CN/EN × PDF/Word** (4 files).

## How it works (three steps)

Connect an AI provider once → ① establish a reusable personal library → ② upload screenshots or paste a target job → ③ AI selects and writes a draft, then edit, reorder, preview and download CN/EN PDF/Word in one workspace. Material checkboxes update instantly without AI calls; deselection keeps both library data and your edits.

This is an AI-assisted personal résumé tool. AI must not fabricate facts. Manual editing and exports do not require proof documents or risk approvals. Existing V7 data remains usable without reimporting.

## Features

- **Profile library** – education, work, projects, skills, certificates, awards, photo, contacts. Every text field is bilingual (zh/en); fill one side and let AI translate the other (status: machine / confirmed / stale). Glossary of fixed translations. JSON import/export. Stored in IndexedDB.
- **JD parsing** – screenshot (vision model OCR) or pasted text → must-haves, nice-to-haves, years, bilingual keywords, company short name, role abbreviation (left blank if unsure). Editable.
- **Generation** – primary version first (defaults to JD language), then the other language is localized *from* it. Each item carries a `sourceId` pointing to the library entry. AI output is checked against source facts. Editing reminders are nonblocking; job matching explanations are optional.
- **Layout settings** – 3 built-in JSON templates (Classic / Modern two-column / Compact). Photo position (left/right/none), module order & titles, 1/2 columns, font, colours, spacing. Per-language variants (CN shows photo by default, EN hides it). Live preview with CN / EN / side-by-side.
- **Export** – `Company_ROLE_YYYYMMDD.zip` (`_2`, `_3` for repeats on the same day) containing `Company_ROLE_CN.pdf/.docx` and `Company_ROLE_EN.pdf/.docx`. No personal name in file names; editable before export; illegal characters sanitized; UTF-8 flag on zip entries.
  - PDF via `@react-pdf/renderer` with an embedded Noto Sans SC subset (~100 KB per PDF).
  - Word via `docx`: real paragraphs and heading styles; two-column layout and photo use **borderless tables** (no text boxes) so the file stays easy to edit.
- **Demo mode** – no API key needed: rule-based parsing and keyword matching. Open `/?demo` to load a sample profile, JD and generated resume.

## Quick start

```bash
npm install
npm run dev                         # http://localhost:5173 (try /?demo)
npm run build && npm run preview    # http://localhost:4173
```

In **Settings**, turn off demo mode and set Base URL (any OpenAI-compatible API: OpenAI, DeepSeek, Qwen…), API key, generation model, vision model, and optionally a translation model.

## Scripts

`npm run test` (unit tests) · `npm run lint` · `npm run typecheck` · `npm run verify:export` (writes sample zips to `../out/`).

## Deploy

Vercel: import repo, framework = Vite. GitHub Pages: `BASE_PATH=/<repo>/ npm run build` and publish `dist/`.

## Privacy

Your data, API key and exported files stay in your browser. AI calls go directly to the provider you configure; photo, birth date, gender and hometown are never sent. Export a JSON backup regularly.

## License

MIT. Bundled font is a subset of Noto Sans CJK SC (SIL OFL 1.1).
