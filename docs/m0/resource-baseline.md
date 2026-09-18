# Sustained offline resource baseline

Updated: 2026-09-18. This is a synthetic workload measurement, not authenticated inference, a capacity recommendation or a long-duration leak test.

## Method

The dedicated Linux ARM64 VM has 2 vCPUs and 4 GiB RAM. The worker is limited to one CPU, 1 GiB memory, 256 PIDs and 256 MiB temporary storage, with offline networking and the explicit Codex AppArmor/seccomp policy. The browser keeps Chromium sandboxing enabled. The native app-server is initialized and remains alive throughout the sample.

Measure 60 seconds idle, 60 seconds active and 30 seconds cooldown. Each active cycle starts a separate native app-server turn through the synthetic Responses fixture, writes an incremented workspace counter through its native command tool, reads that exact value back, clicks a browser counter, verifies its new value and captures a bounded screenshot. A one-second pause follows each cycle. Idle/cooldown also sample once per second. A completed model turn without the expected file write cannot pass.

The active fixture uses pinned GPT-5.5 tool configuration and no model service or credentials. Starting a native process per cycle measures repeated short tasks; it does not model a long-lived authenticated conversation. A separate initialized app-server remains idle, so total memory includes that process as well as the active turn, browser and Node bridge.

Memory is cgroup-charged memory, including caches, not summed process RSS. `memory.peak` captures short peaks missed by one-second samples. CPU is cgroup usage delta divided by elapsed time and one core's capacity. Work-cycle latency excludes the deliberate pause and includes native startup/tool completion, file readback, browser action and screenshot. Report percentile/max values from this exact fixture, not provider token latency. Reject a run with an OOM kill or fewer than ten successful work cycles.

## Verified result

The 2026-09-18 run completed in 152.023 seconds on image `sha256:3b205a247945f54798b053bf02cf1ca51b3f0145d5652319c2b55f16c15e1276`. All 51 active cycles verified the native file write and browser counter. There were zero OOM kills; peak charged memory was 222,339,072 bytes (212.04 MiB) against a 1 GiB limit.

| Phase | Duration | Median charged memory | CPU, one core |
| --- | --- | --- | --- |
| Idle | 60.324 s | 170,962,944 bytes | 0.235% |
| Active | 61.055 s | 182,648,832 bytes | 13.974% |
| Cooldown | 30.138 s | 185,241,600 bytes | 0.216% |

Startup was 129.92 ms. Work-cycle latency was p50 196.48 ms, p95 213.04 ms and p99/max 231.19 ms. These are synthetic tool/browser cycle measurements with a deliberate pause between cycles, not inference latency or maximum throughput. Final cooldown memory was 185,323,520 bytes versus 170,700,800 bytes at initial idle; longer soaks are still needed before drawing retention conclusions.

The final image also passed the native/browser regression (2.898 seconds) with renderer sandboxing enabled. Both runs used seccomp SHA-256 `f83a12f2118b84e27e85c075a587d655d3538df0e52762414f2ba808c9af3225` and AppArmor source SHA-256 `dff3fe377e911c14fc42803be051ae127623924464bf8225cc8b85ec9fa35645`.

## Reproduction

Prepare and load the [Codex sandbox policy](codex-credential-boundary.md#reproduction), build the [M0 image](README.md), then run:

```sh
python3 scripts/probe-container.py --context colima-agentmeld-m0 --probe resource --seccomp-profile codex --workspace resource-baseline
```

This opt-in probe runs for about 150 seconds; its launcher has a separate 240-second deadline and owns its container cleanup. It is not included in the default suite. Reports and image/policy hashes remain under ignored `.local/m0/evidence/`; the local summary is `.local/m0/resource-baseline.log`.

## Acceptance limits

The declared VM/container profile is a tested fixture environment, not a minimum supported Mac configuration. Live subscription workloads, remote clients, persistent browser profiles, large artifacts, concurrent work, VM overhead, sleep/reconnect and longer soak measurements remain unqualified. Cooldown memory above initial idle is not by itself a leak diagnosis. The bounded disk experiment is separate; this measurement still uses the existing fixture bind mount.
