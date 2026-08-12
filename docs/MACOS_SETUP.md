# macOS 开发环境接手指南

## 1. 获取仓库

优先从私有 Git remote 克隆：

```bash
git clone <private-repository-url> Weichai
cd Weichai
```

如果暂时没有 remote，可将 Windows 生成的 `Weichai.bundle` 安全复制到 Mac，
然后执行：

```bash
git clone Weichai.bundle Weichai
cd Weichai
```

Bundle 只包含已经提交的 Git 内容，不包含 `.env.local`、`.data`、数据库数据、
`node_modules` 或构建产物。

## 2. 安装运行时

仓库的 `.nvmrc` 固定为项目已验证的 Node.js 版本，`package.json` 固定 pnpm
版本。使用 nvm 时：

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@11.9.0 --activate
node --version
pnpm --version
```

预期版本：

```text
v22.22.3
11.9.0
```

随后安装锁文件中的依赖和 Playwright Chromium：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

不要从 Windows 复制 `node_modules`、`.next`、Playwright 浏览器缓存或测试产物；
这些内容可能包含平台相关二进制。

## 3. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少确认：

- `DATABASE_URL` 指向 Mac 可访问的 PostgreSQL/Supabase；示例中的
  `127.0.0.1:54322` 只代表当前机器的本地端口。
- `DATABASE_MODE=postgres` 用于正常开发；`pglite-demo` 只供自动化浏览器测试。
- AI 对话使用服务端配置：接口地址、模型名和 Key 写入本机 `.env.local`，
  不写入浏览器、数据库或 Git；部署时使用平台 Secret Manager。
- `ADMIN_ROLE_BINDINGS_JSON` 只定义服务端角色，不允许浏览器决定角色。

若继续使用同一个远程 Supabase，不需要复制数据库文件。若 Windows 使用的是
本地 PostgreSQL 且需要保留数据，应使用 `pg_dump` 和 `pg_restore`，不要直接
复制 PostgreSQL data directory。

## 4. 文档文件迁移

`.data` 被 Git 忽略。若需要保留开发环境已上传文档，必须把 Windows 项目中的
`.data/knowledge` 单独安全复制到 Mac 项目相同位置，并确保数据库中的
`documents.storage_path` 与这些文件对应。

当前 `.data/e2e-knowledge` 只是 Playwright 临时测试数据，无需迁移。

## 5. 数据库和启动

对一个全新的数据库（需要 PostgreSQL ≥ 12；Drizzle Migration 在单事务中
执行 `ALTER TYPE ... ADD VALUE`）：

```bash
pnpm db:migrate
pnpm db:seed
```

Seed 全部是明确标记的虚构 Demo 数据。若连接的是已有共享数据库，只执行其尚未
应用的 Migration；不要为了接手 Mac 重复导入真实业务数据。

启动：

```bash
pnpm dev
```

打开：

- 应用：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>
- 开发知识库：<http://localhost:3000/dev/knowledge>

`/admin` 依赖可信上游身份代理注入
`oai-authenticated-user-email`。本地直接访问未配置身份代理时显示 not-found
是预期行为；Playwright 使用测试 Header 验收后台权限。

## 6. 接手验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm playwright test
```

所有检查通过后再开始新的实现阶段。

## 7. macOS 注意事项

- `.gitattributes` 将文本文件统一为 LF，避免 Windows CRLF 产生无意义 diff。
- macOS 文件名大小写行为取决于磁盘格式；import 路径仍必须与实际文件名完全一致，
  以保证 Linux CI/部署兼容。
- 不提交 `.env.local`、`.data`、数据库 dump 或 API Key。
- 使用 pnpm，不使用 npm、Yarn 或 Bun 重写 lockfile。
