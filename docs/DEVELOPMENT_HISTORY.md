# Development history evidence

> Status: local archive. The full-history secret scan passed on 2026-08-20,
> but the public-redistribution license gate remains unresolved. The canonical,
> deployable code line is `master`.

The public `master` history begins with a consolidated project snapshot. A
separate local branch, `codex/fde-multimodal-global-regulations`, preserves the
earlier incremental implementation history: 50 commits rooted at `a2810e6`.
The two branches have unrelated Git histories, so the archive must never be
merged into, rebased onto, or treated as the release source for `master`.

## Representative milestones

Once the audited archive branch is published, these commits are the shortest
review path through the implementation process:

| Commit | Evidence |
| --- | --- |
| `592d8ed` | First M3 slice: governed publication of signed facts and explicit coverage states. |
| `77eaa07` | M4 user slice: shareable filter URLs, source freshness, loading, empty, and error states. |
| `47c453b` | Follow-up that addresses 16 findings from an adversarial review of the M4 diff. |
| `b50dae6` | Zero-configuration portfolio demo using the real migration and service boundaries. |
| `6be0289` | Simulated persona workflow hardening and the final state of the archived line. |

These milestones are process evidence, not proof that the archived code is
currently secure, deployable, or synchronized with production.

## Publication gate

The archive may be pushed only after all of the following are true:

1. A full-history secret scan passes using the same pinned gitleaks policy as
   CI, including the synthetic-secret canary.
2. Historical binary assets, copied material, and source licenses have been
   reviewed for public redistribution.
3. The remote branch is named `codex/fde-development-history-archive` and is
   labelled in repository documentation as non-canonical and non-deployable.
4. `README.md` links only the representative milestones above and continues to
   identify `master` and `docs/STATUS.md` as the current code and release truth.

If any check fails, the branch remains local and the failed item is documented;
the history must not be published merely to improve the portfolio narrative.

### 2026-08-20 audit record

- The official gitleaks 8.21.2 Darwin arm64 archive matched its published
  checksum. With the repository policy and redaction enabled, it reported no
  findings across all 42 non-merge patches reachable from the 50-commit branch;
  the other eight commits are merges. A synthetic-secret canary was detected
  and returned the configured non-zero exit code.
- All six distinct `package.json` / `pnpm-lock.yaml` states installed in
  isolation with pnpm 11.9.0, `--frozen-lockfile`, and `--ignore-scripts`.
  Dependency metadata contained no unknown or strong-copyleft licenses. It did
  include MPL-2.0 components and the optional sharp/libvips binary chain under
  LGPL-3.0-or-later.
- The archived history has no project `LICENSE` or `NOTICE`, no package license
  declaration, and no written policy for weak-copyleft binaries or required
  notices. Dependency metadata scanning therefore passed, but the overall
  public-redistribution license gate did not. The target remote branch was not
  created or pushed.

---

# 开发历史证据

> 状态：本地归档。2026-08-20 的完整历史密钥扫描已通过，但公开再分发许可证门仍未
> 解决。唯一可部署的规范代码线仍是 `master`。

公开 `master` 以一次项目快照开始；本地分支
`codex/fde-multimodal-global-regulations` 保留了更早的 50 个增量提交，根提交为
`a2810e6`。两条分支的 Git 历史互不相关，因此不得把归档分支合并或 rebase 到
`master`，也不得把它作为生产 release 来源。

归档发布前必须通过与 CI 相同的全历史密钥扫描、历史资产与许可证复核，并以
`codex/fde-development-history-archive` 发布。README 只链接上表中的代表性里程碑，
同时明确这些提交证明的是迭代过程，不代表旧代码仍然安全、可部署或与生产一致。
任何检查失败时都应保持本地归档并记录原因，不能为了作品叙事强行公开。

2026-08-20 审计记录：官方 gitleaks 8.21.2 二进制 checksum 一致；50 个提交中 42 个
非合并补丁全部扫描且无命中，另 8 个为 merge，合成 secret canary 能正确失败。六个
不同依赖快照均使用 pnpm 11.9.0、frozen lockfile 和 ignore-scripts 在隔离目录安装并
生成许可证清单；Unknown 与强 copyleft 均为 0，但存在 MPL-2.0 组件及
LGPL-3.0-or-later 的可选 sharp/libvips 二进制链。该历史从未包含项目 LICENSE、NOTICE、
package license 字段或弱 copyleft/NOTICE 政策，因此第三方依赖元数据扫描通过，但公开
再分发总门禁不能判为通过；目标远端 archive 分支未创建、未推送。
