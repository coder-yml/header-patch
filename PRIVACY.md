# Privacy

Header Patch does not collect, transmit, sell, or share personal data.

## Data stored locally

The extension stores the following configuration with the browser's local extension storage:

- Whether the extension is active.
- Header names and values entered by the user.
- Whether each rule is enabled.

This data stays in the browser profile. Header Patch has no analytics, telemetry, account system, remote API, or external backend.

## How permissions are used

- `storage` saves the user's rules locally.
- `declarativeNetRequestWithHostAccess` applies those rules with the browser's declarative request API.
- `<all_urls>` allows user-defined rules to work on any HTTP or HTTPS page the user chooses to visit.

Header Patch modifies outgoing request headers according to the user's active rules. It does not read or store page content or browsing history.

## Sensitive values

Request headers can contain credentials or other sensitive values. Users are responsible for the values they add and the sites they visit while a rule is active. Remove or pause sensitive rules when they are no longer required.

Uninstalling the extension removes its locally stored configuration according to the browser's extension-storage behavior.
