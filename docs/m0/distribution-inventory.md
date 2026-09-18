# M0 runtime distribution inventory

Updated: 2026-09-18. This records the local qualification image, not an approved release artifact. AgentMeld source licensing remains an owner decision. No image is published.

## Verified scope

[Machine-readable inventory](runtime-inventory.json) records image `sha256:3b205a247945f54798b053bf02cf1ca51b3f0145d5652319c2b55f16c15e1276`, Linux ARM64, installed package versions, declared npm licenses and available notice-file SHA-256 hashes. The image's package lock matches the local lock byte-for-byte. Dockerfile and Cargo lock hashes describe the checkout; they are not an attestation of embedded build provenance.

| Surface | Observed inventory | Evidence boundary |
| --- | --- | --- |
| npm | 107 installed packages | Package manifests and top-level notice files, including platform packages |
| Debian | 197 installed packages | Version/architecture from dpkg; all 197 copyright files present and hashed |
| Rust | 22 locked packages including AgentMeld | Local offline Cargo metadata; includes target-specific dependencies, not a linked-binary SBOM |
| Node | Exact runtime version in JSON | `/usr/local/LICENSE` present and hashed |
| Browsers | Playwright browser manifest plus three installed notice files | Manifest includes downloadable products not necessarily installed; notice paths identify installed assets |

npm declarations: 90 MIT, seven ISC, four Apache-2.0, two BSD-3-Clause, one BSD-2-Clause, one Unlicense and two packages referring to separate license documents. Declarations are not independent verification of all embedded dependencies or distribution rights.

## Packaging findings

- Codex launcher 0.154.0 and Linux ARM64 platform package declare Apache-2.0. Neither has a top-level notice file in this installation. Before distributing the native binary, collect the matching upstream license and applicable embedded-component notices; the npm declaration alone is insufficient packaging evidence.
- Playwright and Playwright Core 1.63.0 include LICENSE and NOTICE files. Installed browser assets include a 2,257,005-byte headless-shell license bundle, a Widevine license file in the full Chromium tree, and an FFmpeg LGPLv2.1 notice. This probe hashes those files without claiming that one license describes the entire browser distribution. Review which assets the alpha actually needs and their matching source/notice obligations before release.
- The prototype still installs Claude Agent SDK 0.3.274 and its platform binary for historical tests. Both refer to separate license documents. Claude is outside alpha scope; exclude these from the alpha runtime rather than treating this mixed qualification image as the release image. Historical tests can remain separately reproducible.
- AgentMeld has no selected source license. Dependencies do not license AgentMeld itself. A proposed license in a spec is not an applied license.
- The Rust builder image is a separate build stage. Its full operating-system/toolchain inventory and transitive contents of vendor executables are outside this runtime inventory. This report does not claim a complete source-offer or release-notice bundle.

## Reproduction

With the existing dedicated VM running and Rust available on PATH:

```sh
python3 scripts/inventory-runtime.py --context colima-agentmeld-m0
```

The command resolves the image to an immutable ID and starts a unique, offline, read-only, non-root container with no mounts, no capabilities and bounded resources. It reads installed metadata via a script supplied on stdin, then removes its container even after timeout. It performs offline local Cargo resolution and refuses an image whose package lock differs from the checkout. No provider, credential store, network request or package installation is involved.

Fresh reports remain under ignored `.local/m0/inventory/`; the checked-in JSON is the reviewed snapshot above. Refresh it whenever the distributed image or dependency locks change. This inventory closes the M0 installed-package evidence gap; native embedded-component attribution, source-license selection and final release packaging remain open.

Validation: the explicit inventory passed against the pinned image. A disposable checkout with a deliberately different package lock was rejected before any report was saved. All 168 default local tests plus formatting, lint, build and documentation checks passed; the inventory command itself remains opt-in and starts no container during default verification.
