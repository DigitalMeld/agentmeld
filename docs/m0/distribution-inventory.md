# M0 runtime distribution inventory

Updated: 2026-09-18. This records the local qualification image, not an approved release artifact. AgentMeld source licensing remains an owner decision. No image is published.

## Verified scope

[Machine-readable inventory](runtime-inventory.json) records image `sha256:d3eff9a0d415b5f47293139997a8edc37d80805aae52bf7c815a8e4d4074ad01`, Linux ARM64, installed package versions, declared npm licenses and available notice-file SHA-256 hashes. The image's package lock matches the local lock byte-for-byte. Dockerfile and Cargo lock hashes describe the checkout; they are not an attestation of embedded build provenance.

| Surface | Observed inventory | Evidence boundary |
| --- | --- | --- |
| npm | 4 installed packages | Package manifests and top-level notice files, including platform packages |
| Debian | 199 installed packages | Version/architecture from dpkg; all 199 copyright files present and hashed |
| Rust | 22 locked packages including AgentMeld | Local offline Cargo metadata; includes target-specific dependencies, not a linked-binary SBOM |
| Node | Exact runtime version in JSON | `/usr/local/LICENSE` present and hashed |
| Browsers | Playwright browser manifest plus three installed notice files | Manifest includes downloadable products not necessarily installed; notice paths identify installed assets |

All four installed npm packages declare Apache-2.0: Codex launcher/platform package and Playwright/Core. Declarations are not independent verification of all embedded dependencies or distribution rights.

## Packaging findings

- Codex launcher 0.154.0 and Linux ARM64 platform package declare Apache-2.0. Neither has a top-level notice file in this installation. Before distributing the native binary, collect the matching upstream license and applicable embedded-component notices; the npm declaration alone is insufficient packaging evidence.
- Playwright and Playwright Core 1.63.0 include LICENSE and NOTICE files. Installed browser assets include a 2,257,005-byte headless-shell license bundle, a Widevine license file in the full Chromium tree, and an FFmpeg LGPLv2.1 notice. This probe hashes those files without claiming that one license describes the entire browser distribution. Review which assets the alpha actually needs and their matching source/notice obligations before release.
- The active runtime no longer installs Claude Agent SDK or its platform binary. The prior mixed image inventory and historical startup probe are preserved in Git at `296ba2bcb9016c8706e50b76c02bdc04e2e17667`. Offline replay fixtures remain roadmap references; they do not install or invoke Claude.
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

## Codex-only rebuild verification

On original Codex-only image `sha256:7a1816efc7b11137feaac11afe47b666d0cccb7cdfe9a1783a5420260ffc9ffc`, removing the historical Claude SDK dependency reduced installed npm packages from 107 to four and the local Docker image size from 1,002,601,281 to 782,876,169 bytes. These are Docker-reported image sizes, not disk reclamation or download savings; the older image remains retained locally. Codex 0.154.0 and Playwright 1.63.0 pins are unchanged.

The new image passed native Codex initialization and missing-session rejection, renderer sandbox checks, viewer takeover/resume/privacy/restart checks, native command/patch/image credential-boundary probes, synthetic credential-volume persistence across replacement containers, and the restricted provider TLS egress probe. No subscription login or live inference occurred. All 168 default tests plus formatting, lint, build and documentation checks passed. Prior resource and disk-limit reports retain their original image IDs; their measurements are not silently transferred to this image.

The current inventory refresh includes the separate-browser fixture scripts. Dependency versions/counts are unchanged; its new image passed the [browser isolation probe](browser-isolation.md). The original rebuild measurements above remain tied to their named image.

The live subscription image adds the standard Debian CA bundle and its OpenSSL dependency. All 199 installed Debian packages have copyright-file evidence. This fixes native TLS verification; Node-only TLS tests were insufficient. The refreshed image passes the [live subscription checkpoint](codex-subscription.md#verified-live-subscription-checkpoint).

The latest image adds the explicit live execution probe and protocol client. Package versions/counts remain unchanged. Its [live execution results](codex-subscription.md#live-execution-follow-up) distinguish verified command success and conversation recovery from the unresolved command-error notification gap. Earlier regression results remain tied to their recorded images.

The command-error follow-up adds qualification-only native-history correlation and an offline lifecycle diagnostic. Package inventories remain unchanged. Live model-facing error evidence passes while the UI event gap remains explicitly open.

The latest image adds the [live control probe](live-control.md). Runtime package versions and counts remain unchanged; mediated approval and cancellation evidence is tied to this exact image.
