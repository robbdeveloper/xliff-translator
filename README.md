# XLIFF Translator

Local mini app for translating **WPML XLIFF 1.2** export jobs with AI, review, and batch export.

Built for WordPress sites using WPML, Elementor, ACF, custom post types, forms, and templates.

## Features

- Drag-and-drop **multiple XLIFF files**
- Parses WPML XLIFF 1.2 with `tool:` metadata
- AI translation via **OpenAI** or **Claude**
- Preserves HTML, shortcodes, URLs, entities, and whitespace
- Skips shortcodes and URL-only units automatically
- Review and manually edit translations before export
- Download translated files as a **ZIP**

## Requirements

- Node.js 20+
- npm 10+
- OpenAI or Anthropic API key

## Quick Start

```bash
npm install
npm run dev
```

Then open:

- Web UI: http://localhost:5173
- API server: http://localhost:3847

## Usage

1. Export translation jobs from WPML as **XLIFF 1.2**
2. Open the app and drop one or more `.xliff` files
3. Choose provider (OpenAI or Claude) and paste your API key
4. Click **Start Translation**
5. Review units, edit any target text if needed
6. Click **Download ZIP**
7. Import the translated XLIFF files back into WPML

## API Key Handling

- Keys are entered in the browser and sent only to your local server during translation
- Keys are stored in `localStorage` on your machine for convenience
- Keys are **not** committed to git
- For server-side defaults, create `.env.local`:

```env
PORT=3847
```

## Project Structure

```
xliff-translator/
├── packages/
│   ├── core/     # XLIFF parser, preservation, AI providers, validation
│   ├── server/   # Express API
│   └── web/      # React + Vite UI
├── examples/     # Sample WPML XLIFF fixtures
└── README.md
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API + web UI |
| `npm run build` | Build all packages |
| `npm test` | Run core tests |
| `npm start` | Run production server |

## Supported Content

Works with WPML exports containing:

- Pages and posts
- Elementor templates and widgets
- ACF custom fields
- FAQ accordions
- Form labels and messages
- Taxonomy labels
- HTML fragments in CDATA

## Preservation Rules

The translator masks and preserves:

- HTML tags and attributes
- WordPress shortcodes
- URLs and WhatsApp links
- HTML entities
- Trailing/leading whitespace

Units skipped automatically:

- `Shortcode` resname
- URL-only content
- Pure shortcode strings

## Known Limitations

- First version translates units sequentially per batch for reliability
- Very large legal HTML blocks may need manual review
- Brand names and addresses are translated unless you edit them
- Desktop packaging (Electron/Tauri) is planned as a follow-up

## Testing

```bash
npm test
```

Tests use the sample fixture in `examples/sample-job-1.xliff`.

## License

Private project for internal translation workflows.
