# Security

The workbench is a static page: no server component, no account, no telemetry,
no network request after load. Everything you type stays in your browser
(`localStorage`) or in a share link you choose to copy. The desktop shell
wraps the same build in a Tauri window.

If you find a problem anyway — a way to run script from a share link or an
imported file, a content-security-policy bypass, something in the collector
SQL that is not read-only — please report it privately through GitHub's
[private vulnerability reporting](https://github.com/davidbudac/dataguard-doc/security/advisories/new)
rather than in a public issue. Expect a reply within a week.
