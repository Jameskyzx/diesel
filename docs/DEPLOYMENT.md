# 部署与运维基线（M2）

本文件是发布前配置与检查的单一入口。红线以 `TASKS.md` §13.6 为准；本文件
把红线展开为可执行矩阵和检查单。

> 当前代码、运行库与历史测量可能处于不同时间点。求职作品的最新可验证状态以
> [STATUS.md](STATUS.md) 为准；本文件保留带日期的历史性能数据，不用新统计覆盖旧测量。

## 1. 环境配置矩阵

| 维度 | 标准开发 | 零配置作品 Demo | CI | 公开只读作品站 / 业务生产 |
| --- | --- | --- | --- | --- |
| 启动入口 | `pnpm dev` | `pnpm demo` | workflow / Playwright custom server | <https://jamesky.site> / 受控部署流水线 |
| `DATABASE_MODE` | `postgres` | `pglite-demo`；仅 development、显式启用 | `pglite-demo`（e2e job） | `postgres`；两类部署均禁止 `pglite-demo` |
| 数据库 | Supabase/PostgreSQL 开发库 | 进程内 PGlite + 真实 Migration | 进程内 PGlite + 真实 Migration | PostgreSQL；Migration 走受控步骤，应用不自动改 schema（ARCH §14） |
| Seed | 只允许显式 Demo + Natural Earth 目录；真实数据经 Draft → Reviewed → Published | 自动运行显式虚构 Demo Seed | 自动运行 Demo Seed | 不运行 Demo Seed；记录按事实/来源逐条分类 |
| AI provider | `gateway` 或 `openai-compatible` | 确定性离线模型；只选择已有只读工具 | 不调用外部模型 | 公开站仅处理已公开数据；业务生产仍需 ADR-017/023 批准 |
| AI 模型 | `AI_MODEL` 为文本模型；图片入口另配 `AI_MULTIMODAL_MODEL` | 不读取外部模型配置 | 测试替身 | 两个模型必须位于服务端；视觉模型须同时支持图片输入与 Function Calling（ADR-125） |
| 密钥 | `.env.local`（gitignore） | 无，且不读取数据库或模型凭据 | GitHub Actions 隔离；gitleaks 扫描 | 只进平台 Secret Manager；不进仓库、日志或任务表 |
| 身份 | `ADMIN_ROLE_BINDINGS_JSON` + 本地 Header 注入（仅受控环境，ADR-036） | 不暴露管理写入作为演示流程 | Playwright 注入测试身份 | 公开站反向代理阻断 `/admin`；业务管理端必须使用可信身份代理（ADR-016） |
| 文档存储 | `.data/knowledge`（仅开发） | 临时 `.data/portfolio-demo-knowledge` | `e2e-knowledge` | 业务生产须用私有对象存储；ADR-031 替身不得用于生产 |
| AI 速率限制 | 默认 30/小时/客户端，进程内固定窗口 | 同左 | 同左 | 同左；多实例按实例独立（见 §6） |
| 核验新鲜度 | 默认 90 天；超过阈值只告警 | 固定 3650 天，避免虚构 fixture 干扰流程演示 | `1`（确定性触发 stale 测试） | 按来源分级 SLA 仍待 ADR-019 签核 |
| 错误脱敏 | 公开 API 只返回 schema 校验的通用错误；日志不保留上游原文（ADR-041） | 同左 | 同左 | 同左 |

### 1.1 零配置作品 Demo

```bash
pnpm install
pnpm demo
```

该入口只绑定 loopback，启动时强制 `development + pglite-demo`，从真实 Migration
建库并使用显式虚构 fixture。离线模型只负责选择现有只读工具；工具输出、引用、
结构化卡片、审计和证据失败关闭仍走正式应用链路。它不代表 PostgreSQL、外部模型、
生产身份或真实产品认证已经完成，面试演示步骤见 [DEMO.md](DEMO.md)。

## 2. 分支保护与合并门（仓库设置）

CI 工作流（`.github/workflows/ci.yml`）提供四个检查：`Lint, typecheck, tests,
build`、`Playwright key flows`、`Secret scanning (gitleaks)`、
`Dependency audit`。

**平台限制（已于 2026-07-30 解除）**：仓库已更名为 `Jameskyzx/diesel`
并公开，分支保护已启用（下述四检查 + strict + 管理员同样受限，单人作品
未要求 PR 评审）。如需重建：

```bash
gh api -X PUT repos/Jameskyzx/diesel/branches/master/protection \
  -H "Accept: application/vnd.github+json" \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Lint, typecheck, tests, build' \
  -f 'required_status_checks[contexts][]=Playwright key flows' \
  -f 'required_status_checks[contexts][]=Secret scanning (gitleaks)' \
  -f 'required_status_checks[contexts][]=Dependency audit' \
  -F enforce_admins=true \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

（`required_pull_request_reviews` 与 `restrictions` 必须显式提供，可为
null；`-F` 发送类型化值，`-f` 发送字符串，括号键必须加引号以免被 shell
当作 glob。）

或在 GitHub 网页：Settings → Branches → Add classic branch protection rule：
分支 `master`；勾选 Require status checks to pass before merging（Strict，
选择上述四个 job）；勾选 Include administrators；勾选 Do not allow force
pushes / deletions。单人作品仓库可不要求 PR review。

## 3. GitHub 原生密钥扫描

CI 的 gitleaks job 覆盖历史扫描。原生 Secret scanning 与 push protection
已于 2026-07-30 随仓库公开启用（Settings → Code security and analysis，
公开仓库免费）；如需重建：

```bash
gh api -X PATCH repos/Jameskyzx/diesel \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

## 4. 公开发布前检查单

下列检查单面向真实业务试点。公开求职作品站已经以只读、管理路由阻断和逐条数据
分类的受限方式上线；这不等于业务生产门已经关闭。

- [x] CI 质量门、Playwright、gitleaks 密钥扫描、依赖审计在每次推送/PR 运行
- [x] `/api/chat` 速率限制与错误脱敏基线（ADR-041）
- [x] HTTPS 主站只对精确 `/api/chat` 设置 10 MiB、关闭请求体缓冲并承接应用 9 MiB
      流式门，其他路由保留较小默认上限；代理以 `$remote_addr` 覆盖
      客户端 `X-Forwarded-For`；IP/备用 HTTP 主机只 301 到规范 HTTPS 域名，不接收
      明文附件。多实例共享计数仍是待办
- [x] 对话附件数量、解码后字节、媒体类型/结构/像素、PDF 页数、15 秒解析 deadline
      与 30,000/40,000 增量字符预算；图片按需切换服务端视觉模型，纯附件意图与事实
      工具门分离，提取内容保持未核验信任边界（ADR-125）
- [x] API JSON/multipart 请求体在解析前按实际流字节限制；低报
      `Content-Length` 返回结构化 413，不能进入 Zod/服务/Repository；JSON 写入只
      接受 `application/json` 或 `application/*+json`
- [x] 站点与 README 求职作品免责声明；业务记录逐条标注 Demo / 已核验来源，
      且明确要求复核原始来源、范围和有效期
- [x] `master` 分支保护与合并门（§2）+ GitHub 原生 Secret scanning（§3）
- [ ] 生产身份代理接入：剥离客户端身份 Header、注入已认证邮箱；`/admin`
      不暴露公网（ADR-016/036）
- [x] 治理数据 v3 快照：只读 repeatable-read 导出、六位微秒与原始 `jsonb::text`、
      SHA-256/严格结构 dry-run、serializable 物理精确恢复与 PGlite 故障回滚演练
- [ ] 生产数据库：责任人确认、生产快照恢复演练、Migration 回滚演练、数据纠错流程
- [ ] 正式 AI 模型、区域、预算与保留策略批准（ADR-017/023）；真实法规文档
      与内部产品资料在批准前不发送给模型
- [ ] 正式 Embedding 与检索基准（ADR-018）；生产私有对象存储替换本地存储
- [ ] 来源许可与法规专家核验完成前，数据不标记 `verified`、不用于销售承诺
- [ ] 监控与告警（健康检查、来源 freshness、审计日志导出）
- [ ] 性能与可访问性复核（bundle、地图加载、查询计划）
- [ ] 依赖公告处置（README「已知依赖风险」中的 high 级工具链公告随上游修复）

### 4.1 待应用 Migration `0007`–`0010` 预检

`0007`–`0010` 会为已有表创建唯一索引或立即校验 CHECK。应用到任何非空数据库前，
先在目标环境只读执行以下查询；每个查询都必须返回 0 行。若有结果，先由数据 owner
确认应保留的实体和修订路径，不得为了让 Migration 通过而静默删除、改标或合并事实。

```sql
-- 0007：同 scope 的市场观测自然键重复。
select country_iso3, metric_code, application_scope, period_start, period_end,
       data_source_id, count(*) as duplicate_count
from market_metrics
where application_scope is not null
group by country_iso3, metric_code, application_scope, period_start, period_end,
         data_source_id
having count(*) > 1;

-- 0007：global scope（NULL）的市场观测自然键重复。
select country_iso3, metric_code, period_start, period_end, data_source_id,
       count(*) as duplicate_count
from market_metrics
where application_scope is null
group by country_iso3, metric_code, period_start, period_end, data_source_id
having count(*) > 1;

-- 0008：国家型辖区必须有 country_iso3，区域/国际辖区必须没有。
select id, code, type, country_iso3
from jurisdictions
where not (
  (type = 'country' and country_iso3 is not null)
  or (type <> 'country' and country_iso3 is null)
);

-- 0009：国家覆盖词表及 Demo 双向分类。
select iso3, data_coverage_status, is_demo
from countries
where data_coverage_status not in ('none', 'demo', 'planned', 'no_data', 'covered')
   or is_demo <> (data_coverage_status = 'demo');

-- 0010：来源类型与 Demo 标志双向分类。
select id, source_type, is_demo
from data_sources
where is_demo <> (source_type = 'demo');
```

通过预检后仍需先完成备份与恢复演练，再按顺序应用 Migration；应用后重新运行这些
查询、`pnpm db:check` 和目标库验收查询。当前工作区仅生成并测试了 Migration，尚未
对本地或远程 PostgreSQL 应用 `0007`–`0010`。

### 4.2 VPS 版本化发布与回滚

当前生产应用固定使用 Node 22、PM2 与 Nginx；PM2 可继续由 root 管理，但 ecosystem
必须把公开 Next.js 进程降权为无登录的 `diesel:diesel`，附件解析器不得以 root 运行。
每次发布创建不可变的
`/opt/diesel/releases/<release-id>`，并通过 `/opt/diesel/current` 原子软链接切换。
不得把运行时 `.env.local`/`.env.production*`、数据库转储、`.git`、本地
`node_modules`、`.next`、`.data`、测试报告/附件或用户文件复制进 release。发布输入只取
当前 Git 提交中的受跟踪文件；未跟踪文件即使留在工作区也不会传输。开始前记录当前软链接
和 Nginx 配置备份路径；这些值是本次回滚凭据。

先在已通过完整门禁的工作站执行；`release_id` 不是秘密，后续 VPS shell 必须复用同一个值。
最终 release 目录必须此前不存在；远端使用不带 `-p` 的 `mkdir` 原子创建并确认目录为空，
同名目录或任何残留内容都必须让发布立即失败，不能复用失败发布的目录。空目录通过检查后、
rsync 前必须确认 `diesel` 组存在，并把 release 根目录固定为 `root:diesel` 0750；否则后续
降权为 `diesel` 的环境、构建产物和持久目录探针无法穿越 root 目录：

```bash
set -euo pipefail
test -z "$(git status --porcelain --untracked-files=no)"
release_id="$(date -u +%Y%m%d%H%M%S)"
ssh root@111.228.50.85 "test -d /opt/diesel/releases && \
  mkdir -- /opt/diesel/releases/${release_id} && \
  test -z \"\$(find /opt/diesel/releases/${release_id} -mindepth 1 -maxdepth 1 -print -quit)\" && \
  { getent group diesel >/dev/null 2>&1 || groupadd --system diesel; } && \
  chown root:diesel /opt/diesel/releases/${release_id} && \
  chmod 750 /opt/diesel/releases/${release_id} && \
  test \"\$(stat -c '%U:%G:%a' /opt/diesel/releases/${release_id})\" = root:diesel:750"
git ls-files -z | rsync -a --relative --from0 --files-from=- \
  ./ "root@111.228.50.85:/opt/diesel/releases/${release_id}/"
```

在 VPS 上修改 `/opt/diesel/shared/.env.production.local` 之前，先创建本次
`/opt/diesel/backups/<release-id>` 回滚状态：持久化旧 release 绝对路径，并把共享
环境文件以 `root:root` 0600 和两份 Nginx 配置一起备份。这一步不依赖下一个
shell 的 `previous_release` 变量，且必须在新的 `AI_MULTIMODAL_MODEL` 或其他配置
写入前完成。`shared` 根目录由 `root:diesel`
以 0750 持有，环境文件保持 `root:diesel` 0640；只有 `shared/.data` 由
`diesel:diesel` 持有并可写，因此降权进程无法替换或重指向环境文件。持久
`.data` 从 shared 链入 release，也不把用户文件复制进不可变 release：

```bash
set -euo pipefail
release_id="<与工作站相同的 release-id>"
deployment_state_dir="/opt/diesel/backups/${release_id}"
previous_release_path_file="${deployment_state_dir}/previous-release"
environment_backup="${deployment_state_dir}/env.production.local.pre-switch"
nginx_primary_backup="${deployment_state_dir}/jamesky.site.pre-switch"
nginx_alternate_backup="${deployment_state_dir}/diesel-demo.pre-switch"

if ! getent group diesel >/dev/null 2>&1; then
  groupadd --system diesel
fi
if ! id -u diesel >/dev/null 2>&1; then
  useradd --system --gid diesel --home-dir /opt/diesel/shared --shell /usr/sbin/nologin diesel
fi
export PATH="/opt/node-v22.22.3-linux-x64/bin:${PATH}"
if ! systemctl cat pm2-root.service >/dev/null 2>&1; then
  env -i HOME=/root PATH="${PATH}" pm2 startup systemd -u root --hp /root
  systemctl daemon-reload
  systemctl enable --now pm2-root
fi
systemctl is-enabled --quiet pm2-root
systemctl is-active --quiet pm2-root
install -d -m 0750 -o root -g diesel /opt/diesel/shared
install -d -m 0750 -o diesel -g diesel /opt/diesel/shared/.data
test -f /opt/diesel/shared/.env.production.local
test ! -L /opt/diesel/shared/.env.production.local
chown root:diesel /opt/diesel/shared/.env.production.local
chmod 640 /opt/diesel/shared/.env.production.local
test "$(stat -c '%U:%G:%a' /opt/diesel/shared)" = "root:diesel:750"
test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.data)" = "diesel:diesel:750"
test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.env.production.local)" = "root:diesel:640"

test ! -e "${previous_release_path_file}"
test ! -e "${environment_backup}"
test ! -e "${nginx_primary_backup}"
test ! -e "${nginx_alternate_backup}"
install -d -m 0700 /opt/diesel/backups
install -d -m 0700 "${deployment_state_dir}"
previous_release_absolute="$(readlink -f /opt/diesel/current)"
case "${previous_release_absolute}" in
  /opt/diesel/releases/*) ;;
  *) echo "Refusing to persist an unexpected previous release path" >&2; exit 1 ;;
esac
test -d "${previous_release_absolute}"
printf '%s\n' "${previous_release_absolute}" >"${previous_release_path_file}"
chmod 600 "${previous_release_path_file}"
install -m 0600 -o root -g root \
  /opt/diesel/shared/.env.production.local "${environment_backup}"
cp /etc/nginx/sites-available/jamesky.site "${nginx_primary_backup}"
cp /etc/nginx/sites-available/diesel-demo "${nginx_alternate_backup}"
chmod 600 "${nginx_primary_backup}" "${nginx_alternate_backup}"

release_committed=0
rollback_release_id="${release_id}"
restore_precommit_host_state() (
  set -Eeuo pipefail
  trap - ERR INT TERM HUP EXIT
  rollback_release_id="${1:?rollback release id is required}"
  [[ "${rollback_release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
  fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  export PATH="${fixed_vps_path}"
  rollback_release_dir="/opt/diesel/releases/${rollback_release_id}"
  rollback_state_dir="/opt/diesel/backups/${rollback_release_id}"
  rollback_previous_release_file="${rollback_state_dir}/previous-release"
  rollback_environment_backup="${rollback_state_dir}/env.production.local.pre-switch"
  rollback_nginx_primary_backup="${rollback_state_dir}/jamesky.site.pre-switch"
  rollback_nginx_alternate_backup="${rollback_state_dir}/diesel-demo.pre-switch"
  rollback_publish_commit_marker="${rollback_state_dir}/PUBLISH_COMMITTED"

  # The database/public validation crossed the shared commit point. Never
  # restore an old host around the newly committed governance graph.
  if [ -e "${rollback_publish_commit_marker}" ]; then
    test -f "${rollback_publish_commit_marker}"
    test "$(stat -c '%U:%G:%a' "${rollback_publish_commit_marker}")" = "root:root:600"
    exit 0
  fi

  test "$(stat -c '%U:%G:%a' "${rollback_previous_release_file}")" = "root:root:600"
  test "$(stat -c '%U:%G:%a' "${rollback_environment_backup}")" = "root:root:600"
  test "$(stat -c '%U:%G:%a' "${rollback_nginx_primary_backup}")" = "root:root:600"
  test "$(stat -c '%U:%G:%a' "${rollback_nginx_alternate_backup}")" = "root:root:600"
  IFS= read -r rollback_previous_release <"${rollback_previous_release_file}"
  case "${rollback_previous_release}" in
    /opt/diesel/releases/*) ;;
    *) echo "Refusing to restore an unexpected previous release path" >&2; exit 1 ;;
  esac
  test -d "${rollback_previous_release}"

  environment_restore_path="$(mktemp /opt/diesel/shared/.env.production.local.precommit.XXXXXX)"
  trap 'rm -f "${environment_restore_path}"' EXIT
  install -m 0640 -o root -g diesel \
    "${rollback_environment_backup}" "${environment_restore_path}"
  mv -Tf "${environment_restore_path}" /opt/diesel/shared/.env.production.local
  test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.env.production.local)" = "root:diesel:640"

  nginx_restore_required=0
  if ! cmp -s "${rollback_nginx_primary_backup}" /etc/nginx/sites-available/jamesky.site ||
     ! cmp -s "${rollback_nginx_alternate_backup}" /etc/nginx/sites-available/diesel-demo; then
    nginx_restore_required=1
    cp "${rollback_nginx_primary_backup}" /etc/nginx/sites-available/jamesky.site
    cp "${rollback_nginx_alternate_backup}" /etc/nginx/sites-available/diesel-demo
    nginx -t
  fi

  current_release_absolute="$(readlink -f /opt/diesel/current)"
  current_was_switched=0
  if [ "${current_release_absolute}" = "${rollback_release_dir}" ]; then
    rollback_link="/opt/diesel/current.precommit-rollback-${rollback_release_id}"
    test ! -e "${rollback_link}"
    ln -s "${rollback_previous_release}" "${rollback_link}"
    mv -Tf "${rollback_link}" /opt/diesel/current
    test "$(readlink -f /opt/diesel/current)" = "${rollback_previous_release}"
    current_was_switched=1
  elif [ "${current_release_absolute}" != "${rollback_previous_release}" ]; then
    echo "Refusing to change an unexpected current release" >&2
    exit 1
  fi

  if [ "${current_was_switched}" -eq 1 ]; then
    previous_app_version="$(basename "${rollback_previous_release}")"
    if pm2 describe diesel-demo >/dev/null 2>&1; then
      pm2 delete diesel-demo
    fi
    env -i \
      HOME=/root \
      PATH="${fixed_vps_path}" \
      APP_VERSION="${previous_app_version}" \
      NODE_ENV=production \
      pm2 start /opt/diesel/current/deploy/ecosystem.config.cjs
    pm2_process_pid="$(
      pm2 jlist |
        EXPECTED_APP_VERSION="${previous_app_version}" node -e '
          const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
          const matches = apps.filter((app) => app.name === "diesel-demo");
          const app = matches[0];
          const pm2Environment = app?.pm2_env ?? {};
          const appVersion =
            pm2Environment.APP_VERSION ?? pm2Environment.env?.APP_VERSION;
          if (
            matches.length !== 1 ||
            app?.pm2_env?.status !== "online" ||
            !Number.isInteger(app.pid) ||
            app.pid <= 1 ||
            appVersion !== process.env.EXPECTED_APP_VERSION
          ) {
            throw new Error("Unexpected PM2 process or release version");
          }
          process.stdout.write(String(app.pid));
        '
    )"
    test -n "${pm2_process_pid}"
    pm2 save
    systemctl is-enabled --quiet pm2-root
    systemctl is-active --quiet pm2-root
  fi

  if [ "${nginx_restore_required}" -eq 1 ]; then
    systemctl reload nginx
  fi
  if [ "${current_was_switched}" -eq 1 ]; then
    curl --connect-timeout 10 --fail --max-time 30 \
      --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60 \
      --show-error --silent \
      http://127.0.0.1:8788/api/health |
      EXPECTED_APP_VERSION="${previous_app_version}" node -e '
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body.status !== "ok" || body.version !== process.env.EXPECTED_APP_VERSION) {
            throw new Error("Unexpected application health after pre-commit rollback");
          }
        });
      '
  fi
)
abort_release_and_restore_host() {
  failure_status="$1"
  failed_release_id="$2"
  trap - ERR INT TERM HUP EXIT
  set +e
  restore_precommit_host_state "${failed_release_id}"
  host_restore_status="$?"
  set -e
  if [ "${host_restore_status}" -ne 0 ]; then
    echo "Pre-commit host rollback failed" >&2
    exit 70
  fi
  exit "${failure_status}"
}
trap 'abort_release_and_restore_host "$?" "${rollback_release_id}"' ERR
trap 'abort_release_and_restore_host 130 "${rollback_release_id}"' INT
trap 'abort_release_and_restore_host 143 "${rollback_release_id}"' TERM
trap 'abort_release_and_restore_host 129 "${rollback_release_id}"' HUP
trap 'failure_status="$?"; if [ "${release_committed}" -ne 1 ]; then abort_release_and_restore_host "${failure_status}" "${rollback_release_id}"; fi' EXIT
```

上述保护段完成后，才由 root 受控编辑共享环境文件，确认它包含当前
服务端数据库、模型和 `AI_MULTIMODAL_MODEL` 配置，并恢复/核对
`root:diesel` 0640；不得在终端、日志或工单中打印其值。随后安装冻结依赖并
在 release 内构建。从保护段到 §4.3 公开验收完成必须使用同一个 root shell；
上述 trap 会在依赖安装、build、切换或验收的任一失败/中断/会话退出时，
从持久化状态目录原子恢复发布前共享环境文件与被替换的 Nginx 配置，并依据
`/opt/diesel/current` 的实际指向决定是否需要回切应用和重载旧 PM2。尚未切换
`current` 时绝不重载旧 ecosystem；已经切换时则必须读回旧 `APP_VERSION` 和内网健康。
旧 release 可能来自尚未降权的上一版 ecosystem，因此回滚只验证恰好一个 online
进程、旧版本和健康，不以 `diesel` uid 作为恢复成功条件；新 release 的正常发布仍必须
强制验证 uid 为 `diesel`。只有最终验收成功才会解除 trap。

VPS 当前不预设 `pg_dump`；§4.3 会在同一个治理维护锁内完成 fresh JSON 快照、SHA-256
校验、dry-run、无净变化的 `--apply` 恢复演练、97 国写入和公开验收。生产 install 只信任
当前 Git 提交中已在工作站通过完整门禁的版本控制 lockfile，使用
`--frozen-lockfile --trust-lockfile`，避免 pnpm 11 在 registry TLS 故障时卡在逐项在线 lockfile
供应链验证。registry 默认仍为 `https://registry.npmjs.org`；确需受控镜像时只给该命令设置
`PNPM_REGISTRY`，由 pnpm 11 可识别的命令级 `--config.registry` 读取，不得写入全局 pnpm/npm
配置。只有依赖安装、完整门禁和构建都成功后
才写入 `.deploy-ready`：

```bash
set -euo pipefail
release_id="<与工作站相同的 release-id>"
release_dir="/opt/diesel/releases/${release_id}"
deployment_state_dir="/opt/diesel/backups/${release_id}"
test "$(stat -c '%U:%G:%a' /opt/diesel/shared)" = "root:diesel:750"
test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.data)" = "diesel:diesel:750"
test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.env.production.local)" = "root:diesel:640"
test "$(stat -c '%U:%G:%a' "${deployment_state_dir}/env.production.local.pre-switch")" = "root:root:600"

ln -s /opt/diesel/shared/.env.production.local "${release_dir}/.env.production.local"
ln -s /opt/diesel/shared/.data "${release_dir}/.data"
cd "${release_dir}"
export PATH="/opt/node-v22.22.3-linux-x64/bin:${PATH}"
corepack pnpm --config.registry="${PNPM_REGISTRY:-https://registry.npmjs.org}" \
  install --frozen-lockfile --trust-lockfile
env -i \
  HOME=/root \
  PATH="${PATH}" \
  APP_VERSION="${release_id}" \
  NODE_ENV=production \
  corepack pnpm build
chown -R root:diesel "${release_dir}/.next"
chmod -R u=rwX,g=rX,o= "${release_dir}/.next"
install -d -o diesel -g diesel "${release_dir}/.next/cache"
chown -R diesel:diesel "${release_dir}/.next/cache"
runuser -u diesel -- test -r "${release_dir}/.env.production.local"
runuser -u diesel -- test -w "${release_dir}/.data"
runuser -u diesel -- sh -c 'probe="$(mktemp /opt/diesel/shared/.data/.write-probe.XXXXXX)" && rm -f "${probe}"'
runuser -u diesel -- test -x "${release_dir}/node_modules/next/dist/bin/next"
runuser -u diesel -- test -x "${release_dir}/.next/server"
runuser -u diesel -- test -r "${release_dir}/.next/BUILD_ID"
runuser -u diesel -- test -r "${release_dir}/.next/required-server-files.json"
runuser -u diesel -- test -r "${release_dir}/.next/server/app-paths-manifest.json"
touch .deploy-ready
```

先持久化旧 release 绝对路径并备份将被替换的 Nginx 文件，再安装仓库中的主域名和备用域名配置。`nginx -t` 不通过
时不得 reload 或切换应用。配置通过后，使用同目录临时软链接和原子重命名切换
`current`，再删除 PM2 同名旧定义并以新版本环境 clean start：

```bash
set -euo pipefail
test -f "${release_dir}/.deploy-ready"
deployment_state_dir="/opt/diesel/backups/${release_id}"
previous_release_path_file="${deployment_state_dir}/previous-release"
environment_backup="${deployment_state_dir}/env.production.local.pre-switch"
nginx_primary_backup="${deployment_state_dir}/jamesky.site.pre-switch"
nginx_alternate_backup="${deployment_state_dir}/diesel-demo.pre-switch"
test "$(stat -c '%U:%G:%a' "${previous_release_path_file}")" = "root:root:600"
test "$(stat -c '%U:%G:%a' "${environment_backup}")" = "root:root:600"
test "$(stat -c '%U:%G:%a' "${nginx_primary_backup}")" = "root:root:600"
test "$(stat -c '%U:%G:%a' "${nginx_alternate_backup}")" = "root:root:600"
cp "${release_dir}/deploy/nginx/jamesky.site.conf" /etc/nginx/sites-available/jamesky.site
cp "${release_dir}/deploy/nginx/diesel-demo.conf" /etc/nginx/sites-available/diesel-demo
nginx -t

ln -s "${release_dir}" /opt/diesel/current.next
mv -Tf /opt/diesel/current.next /opt/diesel/current
if pm2 describe diesel-demo >/dev/null 2>&1; then
  pm2 delete diesel-demo
fi
env -i \
  HOME=/root \
  PATH="${PATH}" \
  APP_VERSION="${release_id}" \
  NODE_ENV=production \
  pm2 start /opt/diesel/current/deploy/ecosystem.config.cjs
pm2_process_pid="$(
  pm2 jlist |
    EXPECTED_APP_VERSION="${release_id}" node -e '
      const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const matches = apps.filter((app) => app.name === "diesel-demo");
      const app = matches[0];
      const pm2Environment = app?.pm2_env ?? {};
      const appVersion =
        pm2Environment.APP_VERSION ?? pm2Environment.env?.APP_VERSION;
      if (
        matches.length !== 1 ||
        app?.pm2_env?.status !== "online" ||
        !Number.isInteger(app.pid) ||
        app.pid <= 1 ||
        appVersion !== process.env.EXPECTED_APP_VERSION
      ) {
        throw new Error("Unexpected PM2 process or release version");
      }
      process.stdout.write(String(app.pid));
    '
)"
test "$(ps -o uid= -p "${pm2_process_pid}" | tr -d '[:space:]')" = "$(id -u diesel)"
curl --connect-timeout 10 --fail --max-time 30 \
  --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60 \
  --show-error --silent \
  http://127.0.0.1:8788/api/health |
  EXPECTED_APP_VERSION="${release_id}" node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "ok" || body.version !== process.env.EXPECTED_APP_VERSION) {
        throw new Error("Unexpected application health after PM2 start");
      }
    });
  '
pm2 save
systemctl is-enabled --quiet pm2-root
systemctl is-active --quiet pm2-root
systemctl reload nginx
```

PM2 替换进程定义时的 CLI 环境只允许 `HOME` / `PATH` / `APP_VERSION` /
`NODE_ENV`；不得继承 root shell 里的 `DATABASE_URL`、`AI_*` 或其他秘密。
ecosystem 再作第二层防护：`interpreter: "none"` 以 `/usr/bin/env -i` 启动固定的
Node 22，只注入明文 allowlist，并用 `--env-file=.env.production.local` 让 Next.js
进程从当前 release 中由 root 管理的软链接加载服务端配置。因此即使
root 所有的 PM2 daemon 保留了旧环境，实际应用也不会继承。发布时先删除同名的旧
PM2 进程定义，再从目标 ecosystem 启动；这是为了确保首次从旧的 Next CLI 定义迁移到
`/usr/bin/env -i` 定义时不会把新参数误传给旧脚本。每次启动后必须在
`pm2 save` 前确认恰好一个
`diesel-demo` 处于 `online`、实际 OS uid 为 `diesel`，且 PM2 中的 `APP_VERSION`
等于目标 release。VPS 若尚无 `pm2-root.service`，先以清洁 CLI 环境执行一次
`pm2 startup systemd -u root --hp /root`；每次保存 dump 后都 fail-closed 确认该 unit
同时 `enabled` 且 `active`，不得只生成 dump 却无主机重启复活链路。

发布验收至少包括：内网与公网 `/api/health` 均返回 `ok` 和新 `APP_VERSION`，首页、
`/chat`、代表国家页返回 200；HTTP IP/备用域名跳转到 `https://jamesky.site`；主域名
发送超过 1 MiB 但仍在应用 9 MiB 上限内的合法附件时，请求必须到达应用而不是返回
Nginx 413 HTML；1×1 图片应由应用返回结构化 400，至少 11×11 的有效图片必须进入已配置
视觉模型路径；超限、损坏图片和超页 PDF 也应返回应用的结构化 4xx。法规数据发布还要
完成 §4.3 的目标国四 scope 与公开 API 读回。

任何一项失败都回滚应用和配置。将 `current` 原子指回持久化文件中的发布前
release，原子恢复同一 `release_id` 状态目录中的共享环境文件与两份 Nginx
备份，核对环境文件为 `root:diesel` 0640，再依次执行 `nginx -t`、
PM2 delete+start 与 Nginx reload，并重新跑上述健康/页面检查。验收完成前不得删除前一
release、共享环境备份或 Nginx 备份；数据库迁移和法规治理发布必须按各自备份/纠错流程回滚，不能靠
应用软链接假装撤销数据库状态。

```bash
set -euo pipefail
release_id="<失败发布的 release-id>"
[[ "${release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="${fixed_vps_path}"
deployment_state_dir="/opt/diesel/backups/${release_id}"
environment_backup="${deployment_state_dir}/env.production.local.pre-switch"
test ! -e "${deployment_state_dir}/PUBLISH_COMMITTED"
test "$(stat -c '%U:%G:%a' "${environment_backup}")" = "root:root:600"
IFS= read -r previous_release_absolute <"${deployment_state_dir}/previous-release"
case "${previous_release_absolute}" in
  /opt/diesel/releases/*) ;;
  *) echo "Refusing to restore an unexpected previous release path" >&2; exit 1 ;;
esac
test -d "${previous_release_absolute}"
test ! -e "/opt/diesel/current.rollback-${release_id}"
ln -s "${previous_release_absolute}" "/opt/diesel/current.rollback-${release_id}"
mv -Tf "/opt/diesel/current.rollback-${release_id}" /opt/diesel/current
cp "${deployment_state_dir}/jamesky.site.pre-switch" /etc/nginx/sites-available/jamesky.site
cp "${deployment_state_dir}/diesel-demo.pre-switch" /etc/nginx/sites-available/diesel-demo
environment_restore_path="$(mktemp /opt/diesel/shared/.env.production.local.rollback.XXXXXX)"
trap 'rm -f "${environment_restore_path}"' EXIT
install -m 0640 -o root -g diesel "${environment_backup}" "${environment_restore_path}"
mv -Tf "${environment_restore_path}" /opt/diesel/shared/.env.production.local
test "$(stat -c '%U:%G:%a' /opt/diesel/shared/.env.production.local)" = "root:diesel:640"
nginx -t
previous_app_version="$(basename "${previous_release_absolute}")"
if pm2 describe diesel-demo >/dev/null 2>&1; then
  pm2 delete diesel-demo
fi
env -i \
  HOME=/root \
  PATH="${fixed_vps_path}" \
  APP_VERSION="${previous_app_version}" \
  NODE_ENV=production \
  pm2 start /opt/diesel/current/deploy/ecosystem.config.cjs
pm2_process_pid="$(
  pm2 jlist |
    EXPECTED_APP_VERSION="${previous_app_version}" node -e '
      const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const matches = apps.filter((app) => app.name === "diesel-demo");
      const app = matches[0];
      const pm2Environment = app?.pm2_env ?? {};
      const appVersion =
        pm2Environment.APP_VERSION ?? pm2Environment.env?.APP_VERSION;
      if (
        matches.length !== 1 ||
        app?.pm2_env?.status !== "online" ||
        !Number.isInteger(app.pid) ||
        app.pid <= 1 ||
        appVersion !== process.env.EXPECTED_APP_VERSION
      ) {
        throw new Error("Unexpected PM2 process or release version");
      }
      process.stdout.write(String(app.pid));
    '
)"
test -n "${pm2_process_pid}"
pm2 save
systemctl is-enabled --quiet pm2-root
systemctl is-active --quiet pm2-root
systemctl reload nginx
curl --connect-timeout 10 --fail --max-time 30 \
  --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60 \
  --show-error --silent \
  http://127.0.0.1:8788/api/health |
  EXPECTED_APP_VERSION="${previous_app_version}" node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "ok" || body.version !== process.env.EXPECTED_APP_VERSION) {
        throw new Error("Unexpected application health after manual host rollback");
      }
    });
  '
```

### 4.3 按国家定向发布法规 fixture

#### 可重复执行合同：2026-08-11 的 97 国 accepted 闭包（KEN 去重）

以下命令是每个新 release 必须从头执行的定向发布/归档合同；不得因
`20260812031745` 已成功执行而在未来发布中跳段。先完成备份与恢复演练，再逐国运行；
DZA、ETH、NGA 会由脚本归档已发布的 retired regulation/limit，再发布当前
no-data 图。LKA 应读回 `2018-07-13` 起道路 5+5 与工程 24 条，农业 no-data；
KHM、LAO、MMR、MNG 应各读回两条精确来源且四 scope no-data。每条命令后必须
记录目标库四 scope 查询、治理归档结果和公开 API/页面读回，
成功前不得更新 `STATUS.md` 的运行库快照。

ACCEPTANCE #199–#200 / ADR-128 另要求在基础 35 条后重新定向发布 MAR、KEN：MAR
只把第二条主 source 从咨询矩阵替换为 BO n°7028 / Arrêté 2251-21；KEN 只把 LN180
刷新为 `eng@2025-03-24` 最新合并表达式并保留 LN13。两次 refresh 不改变两国
四 scope no-data、regulation/limit 图或稳定 33 国计数，且不得因重复出现 KEN 命令而
误解为两项不同法规结论。

ACCEPTANCE #201–#204 / ADR-129 再在 MAR/KEN 后追加 QAT、KWT、OMN、JOR 四次
定向 source refresh。四国各发布恰好两条 accepted source，统一
`verifiedAt=2026-08-10T18:48:04Z`，membership `validFrom` 保持 `2026-08-09`；
每国仍为四 scope no-data、零 regulation/limits。不得用 GSO MY2026 国家标签推断
国内 Euro V 已实施，也不得把旧 portal/固定源/在用车来源重新写回当前双源图。

ACCEPTANCE #205–#208 / ADR-130 再在 QAT/KWT/OMN/JOR 后追加 IRN、IRQ、LBN、SYR
四次定向 source refresh。四国各发布恰好两条 accepted source，统一
`verifiedAt=2026-08-10T18:55:45Z`，membership `validFrom=2026-08-10`；每国仍为
四 scope no-data、零 regulation/limits。IRN Article 4 日程已确认可读，但仍不得从
Euro/Stage 标签补全表与循环；IRQ 未公开 TR 167 排放附件，LBN 的在用车实施缺口和
SYR 的进口/车龄政策也不得升级为新发动机法规。YEM 本轮 no-change。

ACCEPTANCE #209–#243 / ADR-131 再按 GUY/HTI/JAM/BLZ/CUB、LBR/LBY/MLI/MRT/NER、
GTM/HND/NIC/PRY/URY、PRK/PSE/SDN/PRI/NCL、ERI/GAB/GMB/GNB/GNQ、
MOZ/LSO/MDG/MUS/FJI、CAF/COD/COG/GIN/DJI 的顺序追加 35 次 current source
定向刷新。每国发布恰好两条 accepted source；除 URY 保留既有 1 regulation / 18 limits
外，其余 34 国均四 scope no-data、零 regulation/limit。URY 只纠正 V5 source 的
`publishedOn=2025-11-13`；底层 Decree/首版 homologation regulation 继续保持
`effectiveFrom=2023-05-14` 与 9+9 道路限值。`2025-11-17` 仅是当前 V5 程序版本启用日，
不得覆写为底层 regulation 的生效日。

基础 35 个国家命令已经包含 KEN；#200 的 KEN source refresh 必须由该既有 KEN 命令
完成，不得再追加重复命令。既有 44 条与 #209–#243 的 35 条无 ISO3 重复，去重后的
上述 79 国是追加完整性/当前双源收口前的历史小计。ACCEPTANCE #244–#247 /
ADR-133 再追加 AUS、PNG、CAN、USA 的数值完整性发布；#248–#259 / ADR-134
追加 BRN、BTN、SLB、TLS、MWI、SLE、SOM、SSD、TCD、SLV、SUR、TTO 的 current
双源图。ACCEPTANCE #262–#264 / ADR-136 进一步将 ARE 通用 numeric 生效日纠正为
`2027-07-01`（2026 只保留 new-model regulation metadata），并补齐 USA/CAN 40 CFR
1039.101 法定展示的全部 P<8…130≤P≤560 variable-speed 功率带。按 §1039.140 / §1065.20(e) ties-to-even，
三位 raw 查询翻译依次为 `[0,7.5)`、`[7.5,18.501)`、
`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`；
raw bounds 不替代法定展示标签，560、560.001 与 560.500 kW 均命中最高带，
560.501 kW 无结果。
加拿大 SOR/2020-258 §1(4) 同时纳入 calculation methods。CAN/USA 以
`2026-08-11T05:21:45.000Z` 重新签核，target 分别为 48/70 limits。这三国已在既有队列中，
不增加命令。最后按 ACCEPTANCE #260–#261 / ADR-135 追加 CHN 与 MLT，分别发布 GB 20891
完整历史/当前功率带与可寻址 EU-27 成员图。按 target-selection 代码顺序追加后，
本节当前清单合计 97 个唯一国家命令。

公开 `/api/countries` 的部署前快照只有 175 国；与 178 国代码目录只读对比后确认缺少
LIE、SGP、MLT。LIE/SGP 均已有更早批次签核的完整 fixture（LIE：2 regulations / 80 limits；
SGP：2 regulations / 40 limits），不是本轮新研究结论；本次只追加两条定向同步命令，
MLT 则按 #260 新增目录、1:10m 几何和 EU 成员关系。发布后公开目录必须达到 178 国。

以下代码必须在 §4.2 保留的同一 VPS shell、同一 `release_dir` 中执行。维护锁 wrapper
使用 PostgreSQL advisory lock 覆盖整个子进程生命周期；拿不到锁即失败关闭，持锁期间管理
后台或另一发布进程不得并行治理写入。子 shell 的 `ERR`、`INT`、`TERM`、`HUP`、`EXIT`
trap 会在
任一国家发布或后续公开验收失败/中断时，只执行一次已校验的 `snapshot_path` /
`snapshot_sha256` 事务恢复并以非零状态停止；恢复输出也必须进入发布记录。97 国写入、公开
目录计数、97 个国家页面和代表性语义读回全部成功后，子进程才把 0600
`RECOVERY_REQUIRED` 在同一状态目录原子重命名为 0600 `PUBLISH_COMMITTED`；这次
rename 是数据库与 host 之间唯一的跨域 commit point。commit 前任何失败都恢复旧快照，随后
host 回滚；commit 后即使 wrapper heartbeat 或父 shell 再失败，child trap 与 host trap 也都
禁止恢复旧状态，必须保留新应用 + 新治理图。`RECOVERY_REQUIRED` 覆盖无法捕获的 wrapper
`SIGKILL`、主机重启或连接会话丢失：出现该 marker 时不得开始下一次发布，必须由新维护锁
会话使用其中对应的 snapshot/SHA 完成人工恢复并重新验收。
此处 `DATABASE_URL` 必须直连 PostgreSQL 或使用 session pooling，不得指向 transaction
pooling 端点。wrapper 只启用一个连接，关闭 idle/max-lifetime 回收并以 15 秒 TCP keepalive
固定持锁会话；它每 10 秒核验 backend PID、两把 session advisory lock 的原持有状态及可重入/
平衡解锁结果。PID 变化、锁丢失、查询失败或 5 秒探针超时都会立即向子进程发送 `SIGTERM`，
继续等待其 rollback trap 和退出，最后令 wrapper 以非零状态失败。
不要把 `DATABASE_URL` 或其他秘密拼入命令行；wrapper 由 `env -i` 清除父 Shell 的同名或
陈旧变量，只显式注入 `HOME`、固定 Node 22 `PATH`、`NODE_ENV=production`、
`DATABASE_MODE=postgres` 与非秘密 `release_id`，再由 Node 22 的
`--env-file=.env.production.local` 权威加载其余生产配置。连接前的无输出预检必须确认生产
模式和 `DATABASE_URL` 的 PostgreSQL 协议；显式生产值也确保恢复授权不能被开发/PGlite
分支旁路。维护锁内先扫描
`/opt/diesel/backups/**/RECOVERY_REQUIRED` 与 `PUBLISH_COMMITTED`，任意旧 marker 都会在
fresh 快照前失败关闭。
发布后公开验收函数同时保存为该 release 的 0700 脚本，仅供正常发布复用；人工恢复改用
发布前 snapshot 的 v3 深比较契约，不得要求恢复后的旧状态满足 post-publish 覆盖数。
wrapper 非零且没有 `PUBLISH_COMMITTED` 表示它已尝试恢复治理快照；此时主机层仍必须独立
读取切换前持久化状态，原子恢复 `current`、删除 PM2 同名进程并从旧 release ecosystem
重新启动、恢复两份 Nginx 配置，重新
`nginx -t` 后 reload，并读回旧版本内网健康接口。wrapper 即使非零，只要 commit marker
存在就必须按已提交处理、保留新 host 并做最小健康复核；wrapper 零退出却缺少 marker 则是
协议违例，必须失败关闭并回滚 host。主机回滚失败使整次发布以 70 停止。

```bash
rollback_host_release_after_governance_failure() {
  restore_precommit_host_state "${release_id}"
}

fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="${fixed_vps_path}"
governance_env=(
  env -i
  HOME=/root
  PATH="${fixed_vps_path}"
  NODE_ENV=production
  DATABASE_MODE=postgres
  release_id="${release_id}"
)
"${governance_env[@]}" node --env-file=.env.production.local -e '
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.DATABASE_MODE !== "postgres"
  ) {
    throw new Error("Governance commands require NODE_ENV=production and DATABASE_MODE=postgres");
  }
  const databaseUrl = process.env.DATABASE_URL;
  let databaseProtocol = "";
  try {
    databaseProtocol = new URL(databaseUrl ?? "").protocol;
  } catch {}
  if (!["postgres:", "postgresql:"].includes(databaseProtocol)) {
    throw new Error("Governance commands require a PostgreSQL DATABASE_URL");
  }
'
if "${governance_env[@]}" node --env-file=.env.production.local --import tsx \
  scripts/db/with-governance-maintenance-lock.ts -- bash -s <<'GOVERNANCE_PUBLISH'
set -Eeuo pipefail
snapshot_dir="/opt/diesel/backups/${release_id}"
snapshot_path="${snapshot_dir}/governance-before.json"
rehearsal_path="${snapshot_dir}/governance-after-rehearsal.json"
recovery_marker="${snapshot_dir}/RECOVERY_REQUIRED"
publish_commit_marker="${snapshot_dir}/PUBLISH_COMMITTED"
install -d -m 0700 /opt/diesel/backups
existing_recovery_marker="$(find /opt/diesel/backups -name RECOVERY_REQUIRED -print -quit)"
if [ -n "${existing_recovery_marker}" ]; then
  echo "An unresolved governance recovery marker blocks this publish" >&2
  exit 1
fi
existing_publish_commit_marker="$(find /opt/diesel/backups -name PUBLISH_COMMITTED -print -quit)"
if [ -n "${existing_publish_commit_marker}" ]; then
  echo "An unresolved governance publish commit marker blocks this publish" >&2
  exit 1
fi
install -d -m 0700 "${snapshot_dir}"
test ! -e "${publish_commit_marker}"
public_validation_script="${snapshot_dir}/validate-public-governance.sh"
{
  printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail'
  sed -n \
    '/^# GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_BEGIN$/,/^# GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_END$/p' \
    docs/DEPLOYMENT.md
  printf '%s\n' 'validate_public_governance "$@"'
} >"${public_validation_script}"
chmod 700 "${public_validation_script}"
grep -q '^validate_public_governance() {' "${public_validation_script}"
bash -n "${public_validation_script}"
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/export-governance-snapshot.ts \
  --output="${snapshot_path}"
test "$(stat -c '%a' "${snapshot_path}")" = "600"
snapshot_sha256="$(sha256sum "${snapshot_path}" | awk '{print $1}')"
test "${#snapshot_sha256}" -eq 64
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/restore-governance-snapshot.ts \
  --input="${snapshot_path}" --sha256="${snapshot_sha256}"

restore_in_progress=0
restore_governance_on_failure() {
  restore_status="${1:-1}"
  if [ -e "${publish_commit_marker}" ]; then
    trap - ERR INT TERM HUP EXIT
    if [ ! -f "${publish_commit_marker}" ] ||
       [ "$(stat -c '%U:%G:%a' "${publish_commit_marker}")" != "root:root:600" ]; then
      exit 70
    fi
    exit "${restore_status}"
  fi
  if [ "${restore_status}" -eq 0 ]; then
    restore_status=1
  fi
  if [ "${restore_in_progress}" -eq 1 ]; then
    trap - ERR INT TERM HUP EXIT
    exit 70
  fi
  restore_in_progress=1
  trap - ERR INT TERM HUP EXIT
  set +e
  corepack pnpm exec tsx --env-file=.env.production.local \
    scripts/db/restore-governance-snapshot.ts \
    --input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply
  recovery_status="$?"
  set -e
  if [ "${recovery_status}" -ne 0 ]; then
    echo "Governance recovery failed after publish interruption" >&2
    exit 70
  fi
  rm -f "${recovery_marker}"
  exit "${restore_status}"
}
trap 'restore_governance_on_failure "$?"' ERR
trap 'restore_governance_on_failure 130' INT
trap 'restore_governance_on_failure 143' TERM
trap 'restore_governance_on_failure 129' HUP
trap 'restore_governance_on_failure "$?"' EXIT

printf '%s\t%s\n' "${snapshot_sha256}" "${snapshot_path}" >"${recovery_marker}"
chmod 600 "${recovery_marker}"
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/restore-governance-snapshot.ts \
  --input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/export-governance-snapshot.ts \
  --output="${rehearsal_path}"
node -e '
  const { readFileSync } = require("node:fs");
  const { isDeepStrictEqual } = require("node:util");
  const before = JSON.parse(readFileSync(process.argv[1], "utf8"));
  const after = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (
    !isDeepStrictEqual(before.tableCounts, after.tableCounts) ||
    !isDeepStrictEqual(before.tables, after.tables)
  ) {
    throw new Error("Governance restore rehearsal changed the protected tables");
  }
' "${snapshot_path}" "${rehearsal_path}"

corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CRI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ECU
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PAN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=DOM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PHL
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PAK
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SAU
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ARE
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ISR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ZAF
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=EGY
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GHA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=KEN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=RWA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=TZA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ZMB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ZWE
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CIV
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=DZA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=TUN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ETH
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CMR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SEN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=NGA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=UGA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=BWA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=NAM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SWZ
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=KHM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LAO
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LKA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MMR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MNG
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LIE
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SGP
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MAR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=QAT
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=KWT
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=OMN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=JOR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=IRN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=IRQ
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LBN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SYR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GUY
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=HTI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=JAM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=BLZ
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CUB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LBR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LBY
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MLI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MRT
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=NER
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GTM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=HND
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=NIC
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PRY
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=URY
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PRK
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PSE
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SDN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PRI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=NCL
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=ERI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GAB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GMB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GNB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GNQ
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MOZ
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=LSO
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MDG
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MUS
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=FJI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CAF
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=COD
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=COG
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=GIN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=DJI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=AUS
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=PNG
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=BRN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=BTN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SLB
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=TLS
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MWI
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SLE
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SOM
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SSD
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=TCD
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SLV
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=SUR
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=TTO
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CAN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=USA
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=CHN
corepack pnpm exec tsx --env-file=.env.production.local scripts/db/ingest-accepted-fixtures.ts --country=MLT

# 写入成功还不是发布成功。以下公开读回仍在同一维护锁和恢复 trap 内；
# 任一 curl、JSON 断言、数量或语义不符都会恢复治理快照。
# GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_BEGIN
validate_public_governance() {
release_id="${1:?expected app version is required}"
export release_id
public_origin="https://jamesky.site"
# Expected target/full graph closure: 97 jurisdictions / 28 regulations / 651 limits / 203 sources.
published_countries="CRI ECU PAN DOM PHL PAK SAU ARE ISR ZAF EGY GHA KEN RWA TZA ZMB ZWE CIV DZA TUN ETH CMR SEN NGA UGA BWA NAM SWZ KHM LAO LKA MMR MNG LIE SGP MAR QAT KWT OMN JOR IRN IRQ LBN SYR GUY HTI JAM BLZ CUB LBR LBY MLI MRT NER GTM HND NIC PRY URY PRK PSE SDN PRI NCL ERI GAB GMB GNB GNQ MOZ LSO MDG MUS FJI CAF COD COG GIN DJI AUS PNG BRN BTN SLB TLS MWI SLE SOM SSD TCD SLV SUR TTO CAN USA CHN MLT"
export PUBLISHED_COUNTRIES="${published_countries}"
curl_common=(
  --connect-timeout 10
  --fail
  --max-time 30
  --retry 2
  --show-error
  --silent
)

curl "${curl_common[@]}" \
  "${public_origin}/api/health" |
  node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "ok" || body.version !== process.env.release_id) {
        throw new Error(`Unexpected public health payload: ${JSON.stringify(body)}`);
      }
    });
  '

curl "${curl_common[@]}" \
  "${public_origin}/api/countries" |
  node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const countries = Array.isArray(body.countries) ? body.countries : [];
      const expected = process.env.PUBLISHED_COUNTRIES.trim().split(/\s+/u);
      const byIso3 = new Map(countries.map((country) => [country.iso3, country]));
      if (body.status !== "ok" || countries.length !== 178 || byIso3.size !== 178) {
        throw new Error(`Expected 178 unique public countries, received ${countries.length}/${byIso3.size}`);
      }
      const incomplete = expected.filter(
        (iso3) => byIso3.get(iso3)?.dataCoverageStatus !== "covered",
      );
      if (incomplete.length > 0) {
        throw new Error(`Pending countries not publicly covered: ${incomplete.join(",")}`);
      }
    });
  '

assert_http_200() {
  request_url="$1"
  response_status="$(curl "${curl_common[@]}" --output /dev/null \
    --write-out '%{http_code}' "${request_url}")"
  test "${response_status}" = "200"
}

assert_http_200 "${public_origin}/"
assert_http_200 "${public_origin}/chat"
for iso3 in ${published_countries}; do
  assert_http_200 "${public_origin}/countries/${iso3}"
  curl "${curl_common[@]}" \
    "${public_origin}/api/countries/${iso3}?asOf=2026-08-11" |
    COUNTRY_ISO3="${iso3}" node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          body.status !== "available" ||
          body.asOf !== "2026-08-11" ||
          body.country?.iso3 !== process.env.COUNTRY_ISO3 ||
          body.country?.dataCoverageStatus !== "covered"
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} public detail payload`);
        }
      });
    '
done

assert_country_detail() {
  iso3="$1"
  expected_regulations="$2"
  required_source_fragment="$3"
  expected_effective_from="${4:-}"
  expected_source_published_on="${5:-}"
  expected_jurisdiction_code="${6:-}"
  expected_jurisdiction_source_id="${7:-}"
  expected_membership_source_id="${8:-}"
  curl "${curl_common[@]}" \
    "${public_origin}/api/countries/${iso3}?asOf=2026-08-11" |
    COUNTRY_ISO3="${iso3}" \
    EXPECTED_REGULATIONS="${expected_regulations}" \
    REQUIRED_SOURCE_FRAGMENT="${required_source_fragment}" \
    EXPECTED_EFFECTIVE_FROM="${expected_effective_from}" \
    EXPECTED_SOURCE_PUBLISHED_ON="${expected_source_published_on}" \
    EXPECTED_JURISDICTION_CODE="${expected_jurisdiction_code}" \
    EXPECTED_JURISDICTION_SOURCE_ID="${expected_jurisdiction_source_id}" \
    EXPECTED_MEMBERSHIP_SOURCE_ID="${expected_membership_source_id}" \
    node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const country = body.country;
        const expectedCount = Number(process.env.EXPECTED_REGULATIONS);
        const requiredSource = process.env.REQUIRED_SOURCE_FRAGMENT;
        const expectedEffectiveFrom = process.env.EXPECTED_EFFECTIVE_FROM;
        const expectedSourcePublishedOn = process.env.EXPECTED_SOURCE_PUBLISHED_ON;
        const expectedJurisdictionCode = process.env.EXPECTED_JURISDICTION_CODE;
        const expectedJurisdictionSourceId = process.env.EXPECTED_JURISDICTION_SOURCE_ID;
        const expectedMembershipSourceId = process.env.EXPECTED_MEMBERSHIP_SOURCE_ID;
        if (
          body.status !== "available" ||
          country?.iso3 !== process.env.COUNTRY_ISO3 ||
          country?.dataCoverageStatus !== "covered" ||
          country.currentEffectiveRegulations.length !== expectedCount
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} public detail payload`);
        }
        if (expectedJurisdictionCode) {
          const matchingJurisdictions = country.jurisdictions.filter(
            (jurisdiction) => jurisdiction.code === expectedJurisdictionCode,
          );
          const jurisdiction = matchingJurisdictions[0];
          if (
            matchingJurisdictions.length !== 1 ||
            jurisdiction.type !== "country" ||
            jurisdiction.source.id !== expectedJurisdictionSourceId ||
            jurisdiction.membershipSource.id !== expectedMembershipSourceId
          ) {
            throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} national source graph`);
          }
        }
        if (
          requiredSource &&
          !country.sources.some((source) => source.title.includes(requiredSource))
        ) {
          throw new Error(`Missing ${process.env.COUNTRY_ISO3} accepted source: ${requiredSource}`);
        }
        if (
          expectedEffectiveFrom &&
          !country.currentEffectiveRegulations.some(
            (regulation) => regulation.effectiveFrom === expectedEffectiveFrom,
          )
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} regulation effective date`);
        }
        if (
          expectedSourcePublishedOn &&
          !country.sources.some(
            (source) =>
              source.title.includes(requiredSource) &&
              source.publishedOn === expectedSourcePublishedOn,
          )
        ) {
          throw new Error(`Unexpected ${process.env.COUNTRY_ISO3} source publication date`);
        }
      });
    '
}

# 代表性语义：退役 numeric 图归零、metadata-only 法规保留、LIE/SGP 图补齐、
# URY 仅刷新 V5 source 日期，以及七批 source-only 国家继续失败关闭。
assert_country_detail DZA 0 "" "" "" DZ-NATIONAL 10000000-0000-4000-8000-000000000543 10000000-0000-4000-8000-000000000544
assert_country_detail ETH 0 "" "" "" ET-NATIONAL 10000000-0000-4000-8000-000000000551 10000000-0000-4000-8000-000000000552
assert_country_detail NGA 0 "" "" "" NG-NATIONAL 10000000-0000-4000-8000-000000000722 10000000-0000-4000-8000-000000000400
assert_country_detail UGA 1 "Air Quality Standards" "" "" UG-NATIONAL 10000000-0000-4000-8000-000000000573 10000000-0000-4000-8000-000000000574
assert_country_detail LIE 2 "LGBl. 1996 Nr. 143" "" "" LI-NATIONAL 10000000-0000-4000-8000-000000000282 10000000-0000-4000-8000-000000000282
assert_country_detail SGP 2 "S 480/2017" "" "" SG-NEA 10000000-0000-4000-8000-000000000275 10000000-0000-4000-8000-000000000274
assert_country_detail LKA 1 "Gazette" "" "" LK-NATIONAL 10000000-0000-4000-8000-000000000529 10000000-0000-4000-8000-000000000530
assert_country_detail URY 1 "Vehicle-emission homologation procedure V5" 2023-05-14 2025-11-13 UY-NATIONAL 10000000-0000-4000-8000-000000000561 10000000-0000-4000-8000-000000000562
assert_country_detail GUY 0 "Environmental Protection (Air Quality) Regulations" "" "" GY-NATIONAL 10000000-0000-4000-8000-000000000648 10000000-0000-4000-8000-000000000649
assert_country_detail GMB 0 "Environmental Quality Standards" "" "" GM-NATIONAL 10000000-0000-4000-8000-000000000640 10000000-0000-4000-8000-000000000641
assert_country_detail DJI 0 "Code de la Route" "" "" DJ-NATIONAL 10000000-0000-4000-8000-000000000632 10000000-0000-4000-8000-000000000633
assert_country_detail AUS 1 "Vehicle Standard (Australian Design Rule 80/04" 2025-11-01
assert_country_detail PNG 1 "Road Traffic Rules"
assert_country_detail CAN 2 "On-Road Vehicle and Engine Emission Regulations"
assert_country_detail USA 2 "40 CFR § 1036.104"
assert_country_detail CHN 3 "GB 20891-2014" "" "" CN-MEE 10000000-0000-4000-8000-000000000732 10000000-0000-4000-8000-000000000201
assert_country_detail MLT 2 "EU countries: official country profiles and accession dates"
assert_country_detail BRN 0 "Road Traffic Regulations (Chapter 68)"
assert_country_detail BTN 0 "Environmental Standards, 2020"
assert_country_detail SLB 0 "Road Transport Act (Cap. 131)"
assert_country_detail TLS 0 "Lei de Bases do Ambiente"
assert_country_detail MWI 0 "Road Traffic Act"
assert_country_detail SLE 0 "The Environment Protection Agency Act, 2022"
assert_country_detail SOM 0 "Environmental Protection and Management Act"
assert_country_detail SSD 0 "National Bureau of Standards Act, 2012"
assert_country_detail TCD 0 "Décret n° 904/PR/PM/MERH/2009"
assert_country_detail SLV 0 "Acuerdo No. 126"
assert_country_detail SUR 0 "Milieu Raamwet"
assert_country_detail TTO 0 "The Air Pollution Rules, 2014"
}
# GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_END

validate_public_governance "${release_id}"

test ! -e "${publish_commit_marker}"
mv -Tf "${recovery_marker}" "${publish_commit_marker}"
test ! -e "${recovery_marker}"
test "$(stat -c '%U:%G:%a' "${publish_commit_marker}")" = "root:root:600"
trap - ERR INT TERM HUP EXIT
GOVERNANCE_PUBLISH
then
  governance_status=0
else
  governance_status="$?"
fi
publish_commit_marker="/opt/diesel/backups/${release_id}/PUBLISH_COMMITTED"
if [ -e "${publish_commit_marker}" ]; then
  test -f "${publish_commit_marker}"
  test "$(stat -c '%U:%G:%a' "${publish_commit_marker}")" = "root:root:600"
  IFS=$'\t' read -r committed_snapshot_sha256 committed_snapshot_path <"${publish_commit_marker}"
  [[ "${committed_snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]]
  test "${committed_snapshot_path}" = "/opt/diesel/backups/${release_id}/governance-before.json"
  test -f "${committed_snapshot_path}"
  test "$(readlink -f /opt/diesel/current)" = "/opt/diesel/releases/${release_id}"
  if [ "${governance_status}" -ne 0 ]; then
    echo "Governance wrapper exited nonzero after the publish commit point; preserving the committed release" >&2
  fi
  governance_status=0

  # From this point every failure must preserve the new host + new database.
  release_committed=1
  trap - ERR INT TERM HUP EXIT
  for committed_health_origin in http://127.0.0.1:8788 https://jamesky.site; do
    curl --connect-timeout 10 --fail --max-time 30 --retry 2 --show-error --silent \
      "${committed_health_origin}/api/health" |
      EXPECTED_APP_VERSION="${release_id}" node -e '
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body.status !== "ok" || body.version !== process.env.EXPECTED_APP_VERSION) {
            throw new Error("Unexpected application health after governance commit");
          }
        });
      '
  done
  rm -f "${publish_commit_marker}"
elif [ "${governance_status}" -eq 0 ]; then
  echo "Governance wrapper exited successfully without the required publish commit marker" >&2
  governance_status=70
fi
if [ "${governance_status}" -ne 0 ]; then
  set +e
  rollback_host_release_after_governance_failure
  host_rollback_status="$?"
  set -e
  if [ "${host_rollback_status}" -ne 0 ]; then
    echo "Host-level release rollback failed after governance failure" >&2
    exit 70
  fi
  exit "${governance_status}"
fi
release_committed=1
trap - ERR INT TERM HUP EXIT
```

若 wrapper 被 `SIGKILL`、主机重启或 session heartbeat 失败而留下
`RECOVERY_REQUIRED`，先停止管理写入，
在对应 release 目录执行下列恢复。恢复目标是发布前快照，不能套用发布后的 178 国/97 国
`covered` 验收；同一新维护锁会话必须在 restore 后重新导出 v3 快照，并对原 snapshot 的
`tableCounts` 与 `tables` 做深比较，再确认当前在役应用健康及版本。全部成功后最后一条命令
才可删除 marker；任一步失败均保留 marker，之后再决定重试发布或回滚应用。
`expected_app_version` 从当前原子软链接取得，因此应用已回滚时也验证实际在役版本，而不是
盲目要求中断发布的版本：

```bash
set -euo pipefail
release_id="<marker 对应的 release-id>"
[[ "${release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
release_dir="/opt/diesel/releases/${release_id}"
fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
test -d "${release_dir}"
test -f "${release_dir}/.deploy-ready"
cd "${release_dir}"
export PATH="${fixed_vps_path}"
recovery_marker="/opt/diesel/backups/${release_id}/RECOVERY_REQUIRED"
publish_commit_marker="/opt/diesel/backups/${release_id}/PUBLISH_COMMITTED"
test ! -e "${publish_commit_marker}"
test "$(stat -c '%a' "${recovery_marker}")" = "600"
IFS=$'\t' read -r snapshot_sha256 snapshot_path <"${recovery_marker}"
[[ "${snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]]
test -f "${snapshot_path}"
expected_app_version="$(basename "$(readlink -f /opt/diesel/current)")"
test -n "${expected_app_version}"
governance_env=(
  env -i
  HOME=/root
  PATH="${fixed_vps_path}"
  NODE_ENV=production
  DATABASE_MODE=postgres
  release_id="${release_id}"
)
"${governance_env[@]}" node --env-file=.env.production.local -e '
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.DATABASE_MODE !== "postgres"
  ) {
    throw new Error("Governance commands require NODE_ENV=production and DATABASE_MODE=postgres");
  }
  const databaseUrl = process.env.DATABASE_URL;
  let databaseProtocol = "";
  try {
    databaseProtocol = new URL(databaseUrl ?? "").protocol;
  } catch {}
  if (!["postgres:", "postgresql:"].includes(databaseProtocol)) {
    throw new Error("Governance commands require a PostgreSQL DATABASE_URL");
  }
'
"${governance_env[@]}" node --env-file=.env.production.local --import tsx \
  scripts/db/with-governance-maintenance-lock.ts -- bash -s -- \
  "${recovery_marker}" "${snapshot_path}" "${snapshot_sha256}" \
  "${expected_app_version}" <<'GOVERNANCE_RECOVERY'
set -Eeuo pipefail
recovery_marker="$1"
snapshot_path="$2"
snapshot_sha256="$3"
expected_app_version="$4"
recovery_export_path="${snapshot_path%.json}-after-recovery-$(date -u +%Y%m%d%H%M%S).json"
test ! -e "${recovery_export_path}"
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/restore-governance-snapshot.ts \
  --input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply
corepack pnpm exec tsx --env-file=.env.production.local \
  scripts/db/export-governance-snapshot.ts \
  --output="${recovery_export_path}"
test "$(stat -c '%a' "${recovery_export_path}")" = "600"
node -e '
  const { readFileSync } = require("node:fs");
  const { isDeepStrictEqual } = require("node:util");
  const before = JSON.parse(readFileSync(process.argv[1], "utf8"));
  const after = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (
    !isDeepStrictEqual(before.tableCounts, after.tableCounts) ||
    !isDeepStrictEqual(before.tables, after.tables)
  ) {
    throw new Error("Governance recovery does not match the pre-publish snapshot");
  }
' "${snapshot_path}" "${recovery_export_path}"
curl --connect-timeout 10 --fail --max-time 30 --retry 2 --show-error --silent \
  https://jamesky.site/api/health |
  EXPECTED_APP_VERSION="${expected_app_version}" node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "ok" || body.version !== process.env.EXPECTED_APP_VERSION) {
        throw new Error("Unexpected public health payload after governance recovery");
      }
    });
  '
rm -f "${recovery_marker}"
GOVERNANCE_RECOVERY
```

若遗留的是 `PUBLISH_COMMITTED`，数据库与新应用已经越过 commit point；绝不能再执行上述
snapshot restore，也不能把 `current` 回指旧 release。先确认 `current` 仍是 marker 对应的
新 release，复用发布时保存的完整公开验证脚本；验证通过后只删除 commit marker。验证失败
则保留 marker，并修复/前滚新 host 后重试，禁止恢复旧快照：

```bash
set -euo pipefail
release_id="<commit marker 对应的 release-id>"
[[ "${release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
release_dir="/opt/diesel/releases/${release_id}"
publish_commit_marker="/opt/diesel/backups/${release_id}/PUBLISH_COMMITTED"
recovery_marker="/opt/diesel/backups/${release_id}/RECOVERY_REQUIRED"
public_validation_script="/opt/diesel/backups/${release_id}/validate-public-governance.sh"
fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
test -d "${release_dir}"
test "$(readlink -f /opt/diesel/current)" = "${release_dir}"
test ! -e "${recovery_marker}"
test -f "${publish_commit_marker}"
test "$(stat -c '%U:%G:%a' "${publish_commit_marker}")" = "root:root:600"
IFS=$'\t' read -r committed_snapshot_sha256 committed_snapshot_path <"${publish_commit_marker}"
[[ "${committed_snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]]
test "${committed_snapshot_path}" = "/opt/diesel/backups/${release_id}/governance-before.json"
test -f "${committed_snapshot_path}"
test "$(stat -c '%a' "${public_validation_script}")" = "700"
cd "${release_dir}"
export PATH="${fixed_vps_path}"
bash "${public_validation_script}" "${release_id}"
rm -f "${publish_commit_marker}"
```

上述 97 个唯一国家命令已于 2026-08-12 在 release `20260812031745` 中执行：前 33 条属于 #166–#198（其中第 13 条 KEN 同时
发布 #200 的最新 source 图），第 34–35 条补齐 LIE/SGP 既有签核图的运行库目录缺口，
第 36 条执行 #199 的 MAR source-only refresh，第 37–40 条执行 #201–#204 的
QAT/KWT/OMN/JOR refresh，第 41–44 条执行 #205–#208 的 IRN/IRQ/LBN/SYR refresh，
第 45–79 条依序执行 #209–#243 的 35 国 source-currentness refresh；第 80–81 条执行
#244–#245 的 AUS/PNG 完整性发布，第 82–93 条执行 #248–#259 的十二国双源刷新，
第 94–95 条执行 #246–#247 的 CAN/USA 完整性发布，并包含 ADR-136 的六功率带及
ties-to-even raw 查询端点纠错（560/560.001/560.500 kW 同属最高带，560.501 kW
无结果）；
第 96–97 条执行 #261 CHN 与 #260 MLT 的完整图发布。ARE 的第 8 条命令同时
应用 ADR-136 的 `2027-07-01` 通用 numeric 边界。
五国新增来源的 `verifiedAt` 为 `2026-08-10T17:38:18Z`；MAR/KEN 刷新来源的
`verifiedAt` 为 `2026-08-10T18:48:04Z`；QAT/KWT/OMN/JOR 八条刷新来源也统一为
该时刻；IRN/IRQ/LBN/SYR 八条刷新来源统一为 `2026-08-10T18:55:45Z`。#209–#243
七批来源的 `verifiedAt` 依次为 `2026-08-10T19:36:45Z`、
`2026-08-10T19:46:12Z`、`2026-08-10T20:09:01Z`、`2026-08-10T20:20:37Z`、
`2026-08-10T20:39:16Z`、`2026-08-10T20:50:58Z`、`2026-08-10T21:00:43Z`。
最终定向/full selection 闭包为
`97 jurisdictions / 28 regulations / 651 limits / 203 sources`。本次发布已完成目标库、
公开 API/页面与覆盖状态读回。

#### 2026-08-12 生产执行记录

- release：`20260812031745`；Git：`a779901`；当前软链接、内部/公网 health 均返回该版本。
- governance v3：fresh snapshot、SHA dry-run、serializable `--apply` 恢复演练、第二份
  snapshot 深比较、97 国逐项发布与目标图/scope 验收全部通过；跨域 commit marker 已
  原子提交并在公开验收后清理，未遗留 `RECOVERY_REQUIRED` 或 `PUBLISH_COMMITTED`。
- 公网：178 个唯一国家目录均为 `covered`，97 个本轮目标国家页面/API 与代表性法规
  语义通过；CHN 当前 3 条有效法规（含保留 Demo）及 CN-MEE/HJ 1014 来源链读回正确。
- 运行：应用由 `diesel` uid 执行，Nginx 与 PM2 持久化检查通过；多模态边界及真实视觉
  流式请求通过。共享环境文件仍为 root 管理的 0640 普通文件，未输出任何秘密。

#### Superseded 历史操作说明（保留审计文本；非当前生产状态、不得执行下方历史样例命令）

新增国家法规或来源边界时使用 ISO 3166-1 alpha-3 参数，只发布该国家依赖的来源、
辖区成员关系、可用法规、限值和覆盖状态，并运行聚焦验收：

```bash
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=NGA

# 只有官方来源、没有可发布限值的国家分别定向发布
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=EGY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=GHA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ISR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PAK
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=QAT
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=KWT
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=OMN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=JOR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=KHM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LAO
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LKA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MNG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CRI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ECU
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=DOM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=DZA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=TUN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ETH
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=GTM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=HND
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PAN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=URY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ZMB
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ZWE
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=RWA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CIV
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CMR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SEN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MOZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SWZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LSO
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MDG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MUS
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MWI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=FJI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BLZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BRN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BTN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CAF
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=COD
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=COG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CUB
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=JAM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PRK
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PRY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PSE
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SDN
```

参数由 Zod 校验；`--country` 不能重复、不能与 `--market-only` 同用，目标国家必须已有
目录和完整辖区成员关系。存在法规时每条法规必须有至少一条限值；没有法规时发布后会
验证四个 scope 均为 no-data。该模式不绕过未来核验时间校验，也不会处理其他国家，
因此一国的合法记录不会被无关的未来日期阻断。

> **Superseded 历史发布记录**：以下 2026-08-09/10 叙述保留用于审计轨迹，不能证明
> #166–#243 当前 accepted 事实已进入生产。尤其 DZA、ETH、NGA 的旧 numeric 结论与
> RWA/PHL/SAU/ARE/ZAF/ISR 的旧 no-data 结论均已被 ADR-126 覆盖；KHM/LAO/LKA/MMR/MNG
> 的旧日期或发布状态已被 ADR-127 覆盖；MAR/KEN 的旧 source currentness 已被
> ADR-128 覆盖；QAT/KWT/OMN/JOR 的旧 portal/source 组合已被 ADR-129 覆盖；
> IRN/IRQ/LBN/SYR 的旧 source 组合与证据表述已被 ADR-130 覆盖。本轮仅以本节的
> “当前待执行清单”为部署指令；#209–#243 的 35 国 current source 与 URY 日期纠错
> 由 ADR-131 覆盖，仍未进入生产。

2026-08-09 已按上述流程完成 CRI、ECU、DOM、DZA 的 Supabase 定向发布与公开站读回。
CRI、ECU、DOM 均发布精确官方来源边界并保持四个 scope no-data；DZA 发布 1 条现行法规、
28 条车辆级限值。四国目标图、覆盖状态与聚焦验收均通过，公开 API 返回 `available` /
`covered`，`/countries/CRI`、`/countries/ECU`、`/countries/DOM`、`/countries/DZA`
均返回 HTTP 200。

2026-08-10 已完成 TUN、ETH、GTM、HND、PAN、URY 的 Supabase 定向治理发布与公开站
读回。TUN/GTM/HND/PAN 发布精确来源边界并通过四 scope no-data 验收；ETH 发布
Directive 1051/2025 / ES 6725:2022 及 3 条 N2/N3 限值；URY 发布 Decreto 135/021
及卡车/客车共 18 条 ESC/ETC 限值。六国目标图与 `covered` 状态全部通过，公开国家
API 均返回 `available`；ETH/URY 返回对应现行法规，六个 `/countries/{ISO3}` 页面均
返回 HTTP 200。

2026-08-10 已完成 CMR、SEN、MOZ、SWZ 的 Supabase 定向治理发布与公开站读回。四国
均发布精确官方来源边界，通过目标图、`covered` 和四 scope no-data 验收；公开国家
API 返回 `available`、统一核验时间 `2026-08-10T04:26:52Z` 与新来源链，四个
`/countries/{ISO3}` 页面均返回 HTTP 200。当前公开材料不足以发布新重型发动机数值，
因此四国 `currentEffectiveRegulations` 均为空是预期结果，不是发布遗漏。

2026-08-10 已完成 LSO、MDG、MUS、MWI 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T04:44:14Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。MUS 在远程目录中尚不存在，首次运行于两条来源发布后按活跃父记录
校验失败；定向脚本现会对缺失的静态目录国家先用治理流程发布 `planned`，完整目标图
成功后才提升为 `covered`，幂等重试通过。四国 `currentEffectiveRegulations` 为空是
已核验的法规边界，不是发布遗漏。

2026-08-10 已完成 FJI、BLZ、BRN、BTN 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T05:06:30Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。FJI 的 FRCS 进口法律解释/Euro 4 准入、BLZ 的部长后续规定、BRN/BTN 的适行性/在用车
HSU 数值均未升级为新发动机限值，故 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已完成 CAF、COD、COG、CUB 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T05:38:27Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。项目柴油烟雾缓解、空气污染授权和车辆尾气/不透光度周期检查均未
升级为新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=DJI`、`--country=ERI`、`--country=GAB`、
`--country=GIN` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
 no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T06:21:10Z` 与八条精确
来源，`/countries/DJI`、`/countries/ERI`、`/countries/GAB`、`/countries/GIN` 均返回
HTTP 200。环境法中的一般义务/后续标准授权和车辆尾气、烟度、适行性检查均未升级为
新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=GMB`、`--country=GNB`、`--country=GNQ`、
`--country=GRL` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T06:44:56Z` 与八条精确
来源，`/countries/GMB`、`/countries/GNB`、`/countries/GNQ`、`/countries/GRL` 均返回
HTTP 200。环境空气浓度、专门立法授权、内阁审议方案、目视/在用车检查与定性烟气
义务均未升级为新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是
预期结果。

2026-08-10 已依次执行 `--country=GUY`、`--country=HTI`、`--country=IRN`、
`--country=IRQ` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T07:34:48Z` 与八条精确
来源，`/countries/GUY`、`/countries/HTI`、`/countries/IRN`、`/countries/IRQ` 均返回
HTTP 200。后续车辆标准授权、适行性/进口检查、Euro 标签、当时未完整读回的法规日程、环境
空气/活动排放及车辆尾气监测职责均未升级为新发动机型式认证限值，故四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=JAM`、`--country=LBN`、`--country=LBR`、
`--country=LBY` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T07:58:42Z` 与八条精确
来源，`/countries/JAM`、`/countries/LBN`、`/countries/LBR`、`/countries/LBY` 均返回
HTTP 200。旧车型/进口车辆表、一般标准委托、政策材料、未公开法规汇编和车辆检查
授权均未泛化为当前新重型发动机型式认证限值，故四国 `currentEffectiveRegulations`
为空是预期结果。VPS 健康接口同时确认运行 `multimodal-20260810071517`，公网 `/chat`
服务端页面读回文件/图片入口与附件格式说明。

2026-08-10 已依次执行 `--country=MLI`、`--country=MMR`、`--country=MRT`、
`--country=NCL` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T08:31:37Z` 与八条精确
来源，`/countries/MLI`、`/countries/MMR`、`/countries/MRT`、`/countries/NCL` 均返回
HTTP 200。在用车尾气/烟度检查、固定源/项目限值、框架法实施授权、环境空气监测和
车辆检查周期均未升级为新重型发动机型式认证限值，故四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=NER`、`--country=NIC`、`--country=PNG`、
`--country=PRI` 四次 Supabase 定向治理发布。四国均通过目标图与 `covered` 验收；
NER/NIC/PRI 四 scope no-data 通过，PNG 发布仅限 2012+、GVW >4,500 kg 柴油卡车的
ADR 80/03 代表路径 8 条，客车/工程/农业维持 no-data。公开国家 API 读回统一核验
时间 `2026-08-10T09:11:38Z`，仅 PNG 返回现行法规，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。工作树快照在 VPS 以版本 `country-20260810093046` 完成生产构建、
原子软链接切换和 PM2 reload；内网及公网 `/api/health` 均返回该版本与 `ok`，首页、
`/chat` 和四国页面均为 200，公网对话页读回文件选择入口及图片/PDF/文本接受类型。

2026-08-10 已依次执行 `--country=PRK`、`--country=PRY`、`--country=PSE`、
`--country=SDN` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T09:48:06Z` 及八条精确
来源，PRK 不再包含韩国 `.go.kr` 来源，四个 `/countries/{ISO3}` 页面均返回 HTTP 200。
本批只更新运行库数据，现有网页代码会动态读取 PostgreSQL，因此无需再次构建或切换 VPS
版本；一般标准授权、车辆/进口检查与交通减缓政策均未升级为发动机型式认证限值，四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=SLB`、`--country=SLE`、`--country=SLV`、
`--country=SOM` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T10:20:51Z` 及八条精确
来源，四个 `/countries/{ISO3}` 页面均返回 HTTP 200。本批只更新运行库数据，现有网页
代码会动态读取 PostgreSQL，因此无需再次构建或切换 VPS 版本；整车许可/检查、气候 KPI、
Euro 提案/情景假设、在用车 opacity 检查、后续标准授权和未来政策方向均未升级为新重型
发动机型式认证限值，四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=SSD`、`--country=SUR`、`--country=SYR`、
`--country=TCD` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T10:54:10Z`、各自两条精确
边界来源及空的 `currentEffectiveRegulations` / `futureAdoptedRegulations`，
`/countries/SSD`、`/countries/SUR`、`/countries/SYR`、`/countries/TCD` 均返回
HTTP 200。本批只更新运行库数据，现有网页动态读取 PostgreSQL，因此无需再次构建或切换
VPS 版本；一般标准授权、复检设施、在用车/车队政策、噪声 homologation、清单排放因子
和未来减缓措施均未升级为新重型柴油发动机认证限值。

2026-08-10 已依次执行 `--country=TGO`、`--country=TLS`、`--country=TTO`、
`--country=TWN` 四次 Supabase 定向治理发布。四国均通过目标图和 `covered` 验收；
TGO/TLS/TTO 四 scope no-data 通过，TWN 发布 regulation `0464` 及道路卡车/客车各
16 条 WHSC/WHTC/WNTE 代表路径限值，共 32 条，工程与农业保持 no-data。公开国家 API
读回统一核验时间 `2026-08-10T11:21:32Z`、八条精确来源及台湾当前有效法规；
`/countries/TGO`、`/countries/TLS`、`/countries/TTO`、`/countries/TWN` 与
`/api/health` 均返回 HTTP 200。本批只更新运行库数据，网页动态读取 PostgreSQL，
无需再次构建或切换 VPS 版本；发布前完整 `lint`、`typecheck`、498 项测试和生产构建均
通过。另补齐四国在无参数全量 ingest 的 `coveredCountryIso3`，避免全量路径漏升覆盖状态。

2026-08-10 已依次执行 `--country=VEN`、`--country=VUT`、`--country=YEM`、
`--country=ATA`、`--country=ATF`、`--country=ESH`、`--country=FLK` 七次 Supabase
定向治理发布。VEN 发布 regulation `0465` 与道路卡车/客车各 5 条 fixture limit，共
10 条；生产读回进一步验证 1999-12-31 无结果、MY2000 归一化边界、85/85.001 kW 两侧
PM `0.612/0.36 g/kWh`、CO/HC/NOx 值、Directive 91/542/EEC 代表路径及两个非道路
scope 空结果。VUT/YEM 与 ATA/ATF/ESH/FLK 均通过四 scope no-data、精确来源图和
`covered` 验收；特殊地区只发布国际/属地治理边界，不推断主权归属。公开国家 API 读回
统一核验时间 `2026-08-10T11:58:54Z`、十条精确来源和预期法规状态，七个
`/countries/{ISO3}` 页面及 `/api/health` 均返回 HTTP 200。发布前最终 `lint`、
`typecheck`、506 项测试和生产构建均通过。本批只更新运行库数据，网页动态读取
PostgreSQL，因此无需重建或切换 VPS；健康接口继续运行 `country-20260810093046`。

2026-08-10 已完成 ARG、CHL、COL、ISL、IDN、MYS、NZL、NGA、NOR、PER、RUS、CHE、
GBR、VNM 共 14 国 accepted fixture 图的生产数据库同步。同步沿用各自既有签核的 source、
jurisdiction、membership、regulation/limit 与 no-data 边界，不重算限值、不改变代表路径，
也不因 `covered` 状态把空 scope 补成法规。本项是运行库数据同步；网页动态读取 PostgreSQL，
无需为相同代码重新构建或切换 VPS 版本。

2026-08-10 已完成 IND、PHL、SAU、ZAF、ARE 的生产定向治理发布。IND 同步已签核的
BS VI、CEV-IV/V 与 TREM-IV/V 图；PHL、SAU、ZAF、ARE 同步精确官方来源和四 scope
no-data 图。后四国的 `covered` 只表示来源边界已发布，不表示已取得完整的新重型柴油
发动机型式认证数值；不得从 DAO/GSO/SANS/ECE 引用、机械安全规则或标准目录补值。

2026-08-10 已完成 UKR、MDA 的生产定向治理发布。UKR 发布 Law No. 2739-IV / Order
No. 521 国内链与 `[2016-01-01, 2027-01-01)` Euro V B2 压燃机道路代表路径，卡车、
客车各 9 条，construction/agriculture no-data；2027-01-01 到达 Euro VI 法定门槛时
Euro V 记录停止，完整乌克兰 Euro VI 技术链发布前失败关闭。MDA 只发布 2026-07-01
主法 draft 公告与 2026-07-17 配套草案咨询，四 scope no-data，不创建 regulation。
两国来源实际核验时刻分别为 `2026-08-10T12:59:02Z`、
`2026-08-10T13:04:28Z`。

2026-08-10 已完成 THA、ALB、SRB、BIH、MKD、MNE、NPL 七次生产定向治理发布与
发布后验收。实际发布图为：
THA 自 2024-01-01 道路各 9 条；BIH 自 2019-06-01 道路各 12 条；MNE 自
2018-10-15、P>15 kW 道路各 16 条（schema 边界 15.001 kW）；NPL 自
2025-06-23、GVW >3,500 kg 道路各 16 条；ALB/SRB/MKD 四 scope no-data，四个道路
法规国家的 construction/agriculture 亦 no-data。七国目标图、`covered` 与定向查询均
通过；公网 `/api/countries/{ISO3}` 全部返回 `available/covered`，THA/BIH/MNE/NPL 各
显示 1 条当前有效法规，ALB/SRB/MKD 显示 0 条；七个 `/countries/{ISO3}` 页面均返回
HTTP 200。随后幂等重发 UKR/MDA，使生产签核时间分别刷新为
`2026-08-10T12:59:02Z` 与 `2026-08-10T13:04:28Z`。本次公开总表快照为 175 国：
156 `covered`、19 `no_data`。

2026-08-10 已依次完成 ARM、AZE、GEO、UZB、KAZ、TJK、KGZ、TKM、AFG、
AGO、BDI、BEN、BFA、BGD、BHS、BLR、BOL、MAR、KEN 最终 19 国的生产定向
治理发布（ACCEPTANCE #147–#165，ADR-124）。每国均通过目标图、`covered` 与
scope/date/power 语义验收；实际图为 20 个 jurisdiction、12 个 regulation、157 条
limit 与 40 个精确来源。ARM/BLR/KAZ/KGZ 道路各 9 条与农业四功率带，GEO 道路
各 9 条，UZB 仅农业 H 带 3 条，BGD/BOL 道路各 4 条，其余未闭合 scope 保持 no-data。

发布前审查修复了共享 EAEU 法域的替换语义：单国发布 regional/international
jurisdiction 时保留全部已签核成员，避免后发国家归档先前成员；公网读回确认 ARM、
BLR、KAZ、KGZ、RUS 五个 EAEU membership 均活跃，日期分别为 2015-01-02、
2015-01-01、2015-01-01、2015-08-12、2015-01-01。公开 `/api/countries` 返回
175 国、175 `covered` / 0 `no_data`；19 个详情 API、19 个 `/countries/{ISO3}` 页面、
首页与 `/api/health` 均返回成功。网页动态读取 PostgreSQL，本批无需重建或切换 VPS。

## 5. 性能、许可与可访问性基线（历史测量）

以下数字是 2026-07-30 至 2026-08-05 的带日期快照，不是当前运行库计数。最新目录、
几何、fixture 与公开站状态见 [STATUS.md](STATUS.md)。

- **客户端 bundle**：2026-08-05 已用 `next/dynamic` 将 MapLibre GL 拆为纯客户端
  按需 chunk，并通过页面 `react-loadable-manifest` 验证。拆分前地图 chunk 为
  1.40 MB / gzip 370 KB；拆分后为 1.04 MB / gzip 275 KB，且不再属于首页同步
  模块。地图数据 API 完成后加载该 chunk，期间显示固定高度的初始化状态，避免
  布局跳动。
- **地图数据（2026-07-30）**：`world-countries.geojson` 252 KB / gzip 约 92 KB（174 个
  ISO3 要素，仅保留 ISO3 + name 属性）；`world-countries-index.json`
  5.9 KB / gzip 1.7 KB。
- **数据库查询计划（2026-07-30，seeded PGlite，174 行目录）**：`listMapSummaries`
  约 1 ms（174 行排序 + 6 来源连接）；`findByIso3` 走 `countries_pkey`
  约 0.02 ms；市场指标走 `market_metrics_country_period_idx`；法规走
  `country_jurisdictions` 索引嵌套循环。无病态计划。生产 PostgreSQL 依赖
  autovacuum ANALYZE 维持统计信息（PGlite 无统计，计划器行数估计偏低但
  不影响本规模结论）。
- **生产依赖许可审计**（`pnpm licenses list --prod`）：全部为宽松许可
  （MIT 300 / ISC 27 / Apache-2.0 22 / BSD 系 16 / 0BSD、BlueOak、Unlicense、
  CC-BY-4.0、Python-2.0 等）；唯一 copyleft 为 `@img/sharp-libvips-*`
  （LGPL-3.0-or-later，既供 Next 图像优化，也供聊天图片附件的服务端格式/尺寸核验与
  强制像素解码；原生二进制不进浏览器 bundle，自托管容器分发时按 LGPL 动态链接
  义务处理）。
- **可访问性**：键盘国家选择器、焦点管理与触控流程已被 Playwright 覆盖；
  发布前的专项 axe 审计仍列在 §4 检查单。

## 6. 已知限制

- 速率限制计数为进程内固定窗口：多实例部署时每个实例独立计数（有效上限 =
  配置值 × 实例数）。共享计数（如 Upstash/Redis）属于生产基础设施决策，
  不随本基线引入。
- 限流按 `x-forwarded-for` 首段识别客户端：无代理直连时客户端可伪造该头
  绕过按客户端限流。限流是滥用缓解，不是访问控制；公开部署必须位于可信
  代理之后。
- 限流配额按 `POST /api/chat` 次数消耗，无论请求最终是否成功（包括 400
  与 503）。这是有意设计：路由在解析/配置/审计之前先限流，以保护后续的
  数据库写入与模型调用；副作用是 AI 配置故障期间激进重试的客户端可能在
  故障修复后仍被限流至多一小时，运维处置为临时调高
  `AI_CHAT_RATE_LIMIT_PER_HOUR` 或等待窗口滚动。无代理部署时所有无头
  客户端共享 `unknown-client` 单一配额桶。
- gitleaks 与依赖审计使用固定版本/级别；新增公告由 audit job 在 critical
  级别拦截，high 级工具链公告登记于 README 等待上游修复。
