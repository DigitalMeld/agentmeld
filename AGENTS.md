# AgentMeld implementation guidance

- Preserve unrelated files and local runtime state. Keep disposable fixtures and probe evidence in ignored `.local/m0/`.
- GitHub Actions and third-party CI connected to GitHub are prohibited. Run `sh scripts/check-local.sh` locally; never add workflow files or automated releases.
- Use GitHub account `BradGroux` and Git author/committer email `3053586+BradGroux@users.noreply.github.com`. Inspect remote automation before publication.
- M0 is qualification work. Distinguish fixtures, real protocol startup, live inference, isolation verification, and full product behavior in every report.
- Never mount host credentials, browser profiles, the Docker socket, or the user home into agent containers. Provider credentials need an explicitly authorized setup path.
- Never disable browser sandboxing, seccomp, macOS SIP, or approval checks just to make a probe pass. Record failures and investigate the owning boundary.
- The default verification suite does not send messages, invoke a paid model, start a container, or read user files. Container and provider probes are explicit separate commands.
- AgentMeld source license selection is pending. Do not copy separately licensed enterprise code, private account exports, or proprietary product assets.

- Document meaningful discoveries and behavior changes in `docs/` as part of the same work. Use `docs/README.md` to locate current specs, dated research, decisions and verification evidence; keep current scope consistent and distinguish planned, implemented, verified and shipped states.
