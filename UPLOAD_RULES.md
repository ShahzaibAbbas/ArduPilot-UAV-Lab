# Upload And Backup Rules

These rules keep the project clean for GitHub while preserving a local recovery copy.

## Supported packaging command

Run `npm run github:upload` from the project directory. This snapshots current source files, including uncommitted changes, and writes a matching backup ZIP before creating the upload staging tree. Git is not required. Use `npm run github:upload -- --version v0.1.0-my-release` for a custom version; reusing an existing version is rejected.

The ZIP contains source at its root and a `SOURCE_MANIFEST.json` with sizes and SHA-256 hashes. Packages are capped at 100 MB and individual files at 20 MB. Extract it and upload the contents (including hidden `.gitignore` and `.github/`) to GitHub. The archive omits local assistant setup scripts and machine inventory reports. Existing local ZIP helper scripts are legacy; use the npm command for this workflow.

## GitHub Upload Folder

- `github uploading/` is a local staging folder only.
- Do not commit or upload `github uploading/` to GitHub.
- When preparing a GitHub upload, create a fresh versioned folder such as `github uploading/Ardupilot_Simulator_v0.07/`.
- The GitHub upload folder version must match the backup ZIP version for the same pass. For example, if the backup is `backups/Ardupilot_Simulator_v0.07.zip`, copy the source code into `github uploading/Ardupilot_Simulator_v0.07/`.
- Copy only source and project files into that folder:
  - `src/`, `server/`, `public/`, `scripts/`, `docs/`, `.github/`
  - `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
  - launch scripts, `README.md`, `AGENTS.md`, `.gitignore`, and this rules file
- Do not copy generated/runtime files:
  - `node_modules/`, `dist/`, `data/`, `backups/`, `Updates/`
  - `*.log`, `*.zip`, `.env*`, private keys, firmware binaries, coverage output, editor caches, browser test output

## ZIP Backup Rule

- Before deleting files, updating software, or preparing a GitHub upload, create a ZIP backup in `backups/`.
- Use a versioned name, for example `backups/Ardupilot_Simulator_v0.07.zip`.
- The backup should contain the clean project source, not dependency or runtime folders.
- Keep the newest backup after every cleanup/upload pass.
- Do not delete backup ZIPs unless the user explicitly asks.

## Cleanup Rule

- Runtime and generated folders are safe to remove because they can be recreated:
  - `node_modules/` with `npm install`
  - `dist/` with `npm run build`
  - `data/` by running the app
  - `github uploading/` by preparing a new upload staging copy
  - `Updates/` by downloading/applying the update again
- Keep source files, launch scripts, docs, package files, and configuration files.
