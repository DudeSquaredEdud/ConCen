# ConCen GitHub Sync Manual

## Goal

Keep one ConCen mind JSON in private GitHub repo. Browser stores sync settings locally, then pushes/pulls file through GitHub Contents API.

## Create Private Repo

1. Open GitHub.
2. Create new repository.
3. Set visibility to **Private**.
4. Pick owner account/org you will use in ConCen.
5. Create default branch, usually `main`.
6. Optional: add empty folder path later by pushing first ConCen file. GitHub folders exist only when files exist.

Good repo names:

- `concen-minds`
- `private-minds`
- `internal-maps`

## Fine-Grained PAT

Create token at GitHub: **Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token**.

Use narrow scope:

- **Repository access:** Only selected repositories
- **Selected repository:** private ConCen sync repo
- **Permissions -> Contents:** Read and write
- **Permissions -> Metadata:** Read-only, automatic/default
- **Expiration:** Shortest practical expiration

No admin, workflow, issues, pull requests, or org-wide access needed.

Store token in password manager. Do not commit token into repo or ConCen mind JSON.

## ConCen UI Fields

Open **File -> GitHub Sync** in ConCen.

- **Owner:** GitHub user/org that owns repo, for example `droneinstorg`
- **Repo:** repo name only, for example `concen-minds`
- **Branch:** branch name, usually `main`
- **Path:** JSON file path inside repo, for example `minds/concen.mind.json`
- **Token:** fine-grained PAT

Click **Save** after filling fields. Settings save in this browser.

Use **Download Settings** to save owner/repo/branch/path/sha as `.concen-github-sync.json`. Token is not included, so settings file is safe to keep beside notes or move to another browser. Use **Open Settings** to restore that file, then paste token and click **Save**.

Existing **Save Copy/Open Mind** exports/imports mind data. **Download Settings/Open Settings** exports/imports GitHub sync target only.

## Push Behavior

**Push** serializes current ConCen mind as formatted JSON and writes it to configured repo path.

Behavior:

- If file does not exist, push creates it.
- If file exists, push updates it.
- Commit message: `Update <path>`.
- Branch comes from UI field.
- Last remote SHA is saved locally after successful push/pull.
- If remote file changed since last known SHA, ConCen asks before overwriting remote copy.

Push needs token with **Contents: Read and write**.

## Pull Behavior

**Pull** reads configured repo path and replaces current browser mind with remote JSON.

Behavior:

- ConCen asks before replacing current browser mind.
- Remote JSON must be valid ConCen mind export.
- Successful pull saves remote SHA locally.
- Pull does not merge local and remote edits.

Before pull, use **Save Copy** if local unsynced work matters.

Pull needs token with repo access and **Contents** permission.

## Common 404 Fixes

GitHub returns 404 for missing files and for private repos your token cannot see.

Check:

- **Owner** exactly matches GitHub owner, no URL, no leading slash.
- **Repo** exactly matches repo name, no `.git`.
- **Branch** exists. `main` vs `master` mismatch causes pull/push errors.
- **Path** has no leading slash. Use `minds/concen.mind.json`, not `/minds/concen.mind.json`.
- Token selected correct private repo under **Only selected repositories**.
- Token has **Contents: Read and write**, not read-only.
- Token not expired or revoked.
- Repo is private but token belongs to account/org member with access.

Pull 404:

- File may not exist yet. Use **Push** first to create configured path.
- Branch/path may differ from GitHub view.

Push 404:

- Token lacks access to repo.
- Token lacks **Contents: Read and write**.
- Branch name is wrong.
- Repo owner/name is wrong.

## Common Other Errors

- **GitHub auth failed:** token invalid, expired, revoked, or lacks repo access.
- **GitHub conflict:** remote SHA changed during write. Pull first, inspect, then push.
- **GitHub rejected path or branch:** invalid file path or branch does not accept write.

## Rotation

When token expires or must rotate:

1. Generate new fine-grained PAT with same narrow permissions.
2. Open **File -> GitHub Sync**.
3. Replace **Token**.
4. Click **Save**.
5. Test **Pull** or **Push**.
