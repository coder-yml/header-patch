# Header Patch

[中文说明](README.zh-CN.md)

Header Patch is a small Manifest V3 extension for Chrome and Edge that sets or overwrites request headers. Rules are saved locally and applied immediately.

## Features

- Set request headers for HTTP and HTTPS resources.
- Enable or pause individual rules or all rules at once.
- Validate header names and resolve duplicates predictably: the later rule wins.
- Show the number of active rules in the popup and toolbar badge.
- Follow the browser language automatically with English and Simplified Chinese UI.
- Store all configuration in the browser without analytics or a remote service.

## Install from source

Requirements: Node.js 20.19 or newer and npm.

```bash
npm ci
npm run verify
```

Then open `chrome://extensions` or `edge://extensions`, enable developer mode, choose **Load unpacked**, and select the generated `dist` directory.

For a ready-to-install archive, download the ZIP from the project's GitHub Releases page, extract it, and load the extracted directory.

## Development

```bash
npm run dev
```

The regular web preview uses `localStorage`. Request headers are modified only when the project is loaded as a browser extension.

Run all static checks, unit tests, and the production build:

```bash
npm run verify
```

Run the isolated browser regression after building:

```bash
npm run test:e2e
```

The browser test starts its own localhost server and isolated Chrome or Edge profiles. Set `BROWSER_PATH` when the browser executable is not in a standard location. It never needs an external test site.

## Permissions

Header Patch requests `storage`, `declarativeNetRequestWithHostAccess`, and `<all_urls>` host access. Broad host access is required because user-defined request-header rules may target any HTTP or HTTPS page the user visits. The extension does not include telemetry, analytics, or remote API calls.

Header values can contain sensitive information. Add only values you understand and trust, and remove rules when they are no longer needed. See [PRIVACY.md](PRIVACY.md) for details.

## Project files

- `src/` contains the popup, state, validation, storage, and background worker code.
- `public/` contains the Manifest, locale catalogs, and runtime icons.
- `assets/icon.svg` is the editable icon source.
- `tests/` contains unit, build, localization, and isolated browser tests.

## License

[MIT](LICENSE)
