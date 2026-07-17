# Automated Microsoft Edge updates

The first version of an extension must be created and submitted in Partner Center. The Edge Add-ons Update REST API can only update an existing product; it cannot create a product or update store-listing metadata.

After the first version is in the store, copy the Product ID from the extension overview and configure the repository under **Settings > Secrets and variables > Actions**:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `EDGE_CLIENT_ID` | Client ID from Partner Center Publish API |
| Variable | `EDGE_PRODUCT_ID` | Product ID from the extension overview |
| Variable | `EDGE_API_KEY_EXPIRES_AT` | API-key expiry as an ISO-8601 date or timestamp |
| Variable | `EDGE_PUBLISH_ENABLED` | `true` after all other values are configured |
| Secret | `EDGE_API_KEY` | A newly generated, unexposed API key |

Never commit an API key or paste it into an issue, pull request, workflow, log, screenshot, or documentation. Revoke a key immediately if it is exposed. Before rotating a key, create its replacement, update `EDGE_API_KEY` and `EDGE_API_KEY_EXPIRES_AT`, verify the next release, and then remove the old key.

Pushing a tag matching `v*` runs the release workflow. The workflow verifies and packages the extension, creates the GitHub Release, uploads the same ZIP to Edge, waits for validation, submits it for certification, and waits for the submission operation to succeed. Store descriptions, images, privacy declarations, and other listing metadata remain manual Partner Center changes.

To run the publisher locally with equivalent credentials:

```bash
npm run publish:edge -- \
  --package header-patch-v1.0.1.zip \
  --notes-file docs/edge-certification-notes.txt
```

If an Edge release job fails, inspect the sanitized API response in GitHub Actions and the submission state in Partner Center. For an in-progress submission, wait for the existing review rather than uploading another version.
