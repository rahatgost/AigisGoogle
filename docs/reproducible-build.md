# Reproducible build

Phase 14.1 promise: anyone can take the public source tree at a tagged
commit and produce a build whose hashes match what we ship. This document
is the recipe.

The goal is **bit-identical** output for:

- the web client bundle served from the app URL, and
- the browser extension zips published to the Chrome Web Store and AMO.

Server code (edge functions, migrations) is out of scope — those artifacts
are managed by Lovable Cloud and are not user-installable.

---

## 1. Pin the toolchain

Reproducible builds require every input to be pinned. Use these versions.
They match what CI uses to produce the published artifacts.

| Tool           | Version | Where it comes from     |
| -------------- | ------- | ----------------------- |
| Node.js        | 20.11.1 | `.nvmrc` (or nodenv)    |
| npm            | 10.5.0  | ships with Node 20.11.1 |
| bun (optional) | 1.1.34  | https://bun.sh          |

Set the timezone and locale to `UTC` / `C.UTF-8` before every build; Vite's
asset hashing is deterministic but some downstream tools (source maps,
license comments) embed locale-formatted dates.

```bash
export TZ=UTC
export LC_ALL=C.UTF-8
export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)
```

`SOURCE_DATE_EPOCH` is the de-facto standard for reproducible builds. Any
tool that respects it (esbuild, terser, our extension packager) will use
this timestamp instead of "now" for embedded metadata.

---

## 2. Fetch the exact source

```bash
git clone https://github.com/aegis-authenticator/aegis.git
cd aegis
git checkout v<release-tag>          # e.g. v14.1.0
git submodule update --init --recursive
```

Do not use a shallow clone. Some build steps read `git describe` output.

Verify the tag signature (maintainer key is published in
`docs/maintainer-keys.asc`):

```bash
git tag --verify v<release-tag>
```

---

## 3. Install dependencies from the lockfile only

```bash
npm ci                # NOT `npm install` — that can update the lockfile
```

`package-lock.json` is committed and is the single source of truth for
dependency resolution. `npm ci` refuses to run if `package.json` and the
lockfile disagree, which is what we want.

If you prefer bun, run `bun install --frozen-lockfile` against the
committed `bun.lock` (not present at time of writing — npm is the
supported path).

---

## 4. Build the web client

```bash
npm run build
```

Output lives in `dist/`. To verify:

```bash
find dist -type f -exec sha256sum {} \; | sort -k 2 > /tmp/local-hashes.txt
curl -sSL https://aegis-syed.lovable.app/.well-known/build-hashes.txt \
  > /tmp/published-hashes.txt
diff /tmp/local-hashes.txt /tmp/published-hashes.txt
```

An empty diff means the build is bit-identical to what production serves.

Non-empty diff? See "Known sources of drift" below.

---

## 5. Build the browser extensions

Chrome (MV3):

```bash
npm run package:ext:chrome
sha256sum public/aegis-extension-chrome.zip
```

Firefox:

```bash
npm run package:ext:firefox
sha256sum public/aegis-extension-firefox.zip
```

Compare against the hashes published on the release page for the tag you
checked out. The zip packager is invoked through `nix run nixpkgs#zip`,
which uses `-X` (strip extra file attributes) implicitly via our wrapper
so the archive contents are timestamp-stable when `SOURCE_DATE_EPOCH` is
set.

---

## 6. Verify the shared crypto library

The crypto primitives (`src/lib/vault-crypto.ts`, `src/lib/vault-sharing.ts`,
`src/lib/webauthn-prf.ts`) are the security-critical surface. Run the
unit and property tests to confirm nothing regressed in your tree:

```bash
npm test -- --run
```

All tests must pass. A green run is a necessary but not sufficient check
— reviewing the diff between your commit and the previous audited tag is
still required for security-sensitive changes.

---

## 7. Known sources of drift

If your local hashes differ from published hashes, the cause is almost
always one of:

- **Node minor version mismatch.** Even a patch bump in Node can change
  V8 output that leaks into `esbuild` or `terser` results. Use exactly
  the version in `.nvmrc`.
- **npm optional dependencies.** Platform-specific binaries (esbuild,
  lightningcss, sharp) resolve differently on macOS vs Linux. We publish
  from Linux `x86_64`; build in a Linux container to match.
- **`SOURCE_DATE_EPOCH` not exported.** Without it, embedded timestamps
  drift every build.
- **Locale.** Non-UTF-8 or non-`C` locales change source-map path
  ordering in some tools.
- **Uncommitted changes.** `git status` must be clean; a stray `.env`
  or edited file will change the bundle.

For a fully sealed environment, use the reference Docker recipe below.

---

## 8. Reference container (optional)

```dockerfile
FROM node:20.11.1-bookworm-slim
ENV TZ=UTC LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates zip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct 2>/dev/null || echo 0) \
 && npm ci \
 && npm run build \
 && npm run package:ext:chrome \
 && npm run package:ext:firefox
CMD ["sh", "-c", "find dist public/aegis-extension-*.zip -type f -exec sha256sum {} \\;"]
```

Build and run:

```bash
docker build -t aegis-repro .
docker run --rm aegis-repro > local-hashes.txt
```

The hash set in `local-hashes.txt` must match the published
`build-hashes.txt` for that release tag.

---

## 9. Reporting a mismatch

If you produce a mismatch that isn't explained by section 7, please open
an issue with:

- the release tag,
- your platform (`uname -a`, Node version),
- the diff between local and published hashes,
- and the git commit of any tooling you added to the container.

A reproducibility failure is treated as a security issue and gets the
same triage priority as a vulnerability report.
