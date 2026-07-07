# XLIFF Translator

A local app for translating **WPML XLIFF 1.2** export jobs with AI, reviewing the results, and exporting translated files back to WPML.

Built for WordPress sites that use WPML, Elementor, ACF, custom post types, forms, and templates.

## What It Does

1. You upload one or more `.xliff` / `.xlf` files exported from WPML.
2. The app parses each translation unit and protects HTML, shortcodes, URLs, and other technical content.
3. OpenAI or Claude translates the human-readable text.
4. You review and edit translations in the UI.
5. You download a ZIP of translated XLIFF files ready for WPML import.

Everything runs locally on your machine. Your API key is sent only to your local server during translation.

## Download (Desktop App)

Installers for each release are published on [GitHub Releases](https://github.com/robbdeveloper/xliff-translator/releases), organized by version.

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `XLIFF Translator-<version>-arm64.dmg` |
| macOS (Intel) | `XLIFF Translator-<version>.dmg` |
| macOS (portable) | `XLIFF Translator-<version>-arm64-mac.zip` |
| Windows (installer) | `XLIFF Translator Setup <version>.exe` |
| Windows (portable) | `XLIFF Translator <version>.exe` |
| Linux | `XLIFF Translator-<version>.AppImage` or `.deb` |

Each release also includes a `SHA256SUMS.txt` file so you can verify downloads.

**Note:** Current builds are unsigned. macOS and Windows may show security warnings until code signing is configured.

## Requirements

- **Desktop app:** no Node.js required
- **Development:** Node.js 20+, npm 10+
- **Translation:** an OpenAI or Anthropic API key

## Quick Start (Desktop)

1. Download the installer for your platform from GitHub Releases.
2. Install and open **XLIFF Translator**.
3. Export translation jobs from WPML as **XLIFF 1.2**.
4. Drop your `.xliff` files into the app.
5. Choose **OpenAI** or **Claude**, paste your API key, and click **Start Translation**.
6. Review and edit any units if needed.
7. Click **Download ZIP** and import the files back into WPML.

## Quick Start (Development)

```bash
npm install
npm run dev
```

Then open:

- Web UI: http://localhost:5173
- API server: http://localhost:3847

Run the desktop shell locally:

```bash
npm run desktop:dev
```

## Usage Workflow

1. Export translation jobs from WPML as **XLIFF 1.2**
2. Upload one or more `.xliff` / `.xlf` files
3. Choose provider (OpenAI or Claude) and paste your API key
4. Optionally run **Test Connection** before translating
5. Click **Start Translation** and watch live progress
6. Review units, edit any target text if needed
7. Click **Download ZIP**
8. Import the translated XLIFF files back into WPML

## API Key Handling

- Keys are entered in the app UI and sent only to your local server during translation
- Keys are stored in `localStorage` on your machine for convenience
- Keys are **not** committed to git
- For server-side defaults during development, create `.env.local`:

```env
PORT=3847
```

## Project Structure

```
xliff-translator/
├── packages/
│   ├── core/     # XLIFF parser, preservation, AI providers, validation
│   ├── server/   # Express API
│   ├── web/      # React + Vite UI
│   └── desktop/  # Electron desktop app
├── examples/     # Sample WPML XLIFF fixtures
├── scripts/      # Release and diagnostic helpers
└── README.md
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API + web UI for development |
| `npm run build` | Build core, server, and web packages |
| `npm run build:desktop` | Build all packages including desktop main process |
| `npm run desktop:dev` | Run the Electron desktop app locally |
| `npm run desktop:pack` | Build an unpacked desktop app directory |
| `npm run desktop:dist` | Build installers for the current OS |
| `npm run desktop:dist:mac` | Build macOS DMG + ZIP |
| `npm run desktop:dist:win` | Build Windows installer + portable EXE |
| `npm run desktop:dist:linux` | Build Linux AppImage + deb |
| `npm test` | Run core tests |
| `npm run check-release-version` | Verify package versions match a release tag |
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

- Translation runs in batches for reliability; large jobs take time
- Very large HTML blocks may need manual review
- Brand names and addresses are translated unless you edit them
- Translation sessions are stored in memory and are lost if the app restarts
- Release builds are currently unsigned

## Testing

```bash
npm test
```

Tests use the sample fixture in `examples/sample-job-1.xliff`.

## Releasing a New Version

Releases are automated with GitHub Actions when you push a version tag.

1. Update the version in every `package.json` (root and all packages under `packages/`)
2. Commit the version bump
3. Create and push a tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The release workflow will:

- Verify package versions match the tag
- Run tests and build desktop installers on macOS, Windows, and Linux
- Publish all platform artifacts to a GitHub Release for that version
- Attach a `SHA256SUMS.txt` checksum file

To verify locally before tagging:

```bash
npm run check-release-version v1.0.1
npm test
npm run build
npm run desktop:pack
```

### Optional Code Signing

When Apple and Windows certificates are available, add these GitHub secrets and uncomment the signing env vars in `.github/workflows/release.yml`:

- `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

## License

Private project for internal translation workflows.
