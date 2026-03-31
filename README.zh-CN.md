# Browser Sasiki

Browser Sasiki 是一个面向编码 agent 的 workspace-first 浏览器自动化 skill。它只暴露 HTTP 前门：一个长生命周期 daemon 负责持有 Chrome 会话，agent 通过 direct DevTools 支撑的 JSON endpoint 与它交互，而不是走一堆一次性 CLI wrapper。

## 真源

- 在 Sasiki monorepo 里，`skill/` 是唯一真源。
- 公开仓库 `66Ronghua99/browser-sasiki` 是这个目录的发布镜像。
- 日常开发先改 `Sasiki/skill`，确认无误后再从 Sasiki 发布到镜像仓库。

## 安装

### 通过公开镜像让 agent 安装

如果你的编码 agent 支持从 GitHub 仓库安装 skill，使用下面这个源：

- repo: `66Ronghua99/browser-sasiki`
- path: `.`

可以直接把这句话发给 agent：

```text
Please install the `browser-sasiki` skill from the GitHub repo `66Ronghua99/browser-sasiki` at path `.`, restart your agent if needed, and then use that skill for browser automation tasks.
```

### 给 Codex 做本地手动安装

如果你希望保留一个本地 checkout，并让 Codex 通过软连接加载这个 skill，不要手工复制文件，直接把 skill 根目录软连接到 `~/.codex/skills/browser-sasiki`。

从独立镜像仓库安装：

```bash
git clone https://github.com/66Ronghua99/browser-sasiki.git ~/codes/browser-sasiki
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/browser-sasiki
ln -s ~/codes/browser-sasiki ~/.codex/skills/browser-sasiki
cd ~/codes/browser-sasiki
npm install
```

从 Sasiki monorepo 真源安装：

```bash
git clone https://github.com/66Ronghua99/Sasiki.git ~/codes/Sasiki
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/browser-sasiki
ln -s ~/codes/Sasiki/skill ~/.codex/skills/browser-sasiki
cd ~/codes/Sasiki/skill
npm install
```

安装完成后重启 Codex，让新 skill 被重新加载。后续如果依赖有变化，回到同一个 skill 根目录再次执行 `npm install` 即可。

## 工作目录

下面这些命令都应该在 skill 根目录执行。

如果你当前在 Sasiki monorepo：

```bash
cd skill
```

如果你当前就在独立仓库 `browser-sasiki` 根目录，那已经在正确位置了。

## 运行前提

- Node `>=20`
- 目标 Google Chrome 已经启动，并且就是你想自动化的那个会话
- 这个 Chrome 会话已经开启 remote debugging
- 如果 Chrome 弹出 attach 确认，需要允许 daemon 连接

## 快速开始

通过 startup helper 启动或复用 daemon：

```bash
node scripts/ensure-browser-session.mjs
```

这个命令会输出 session metadata。读取里面的 `baseUrl`，后续 HTTP 请求都用它。默认通常是 `http://127.0.0.1:3456`。

如果你想额外确认 health：

```bash
curl -s "$BASE_URL/health"
```

打开一个 workspace：

```bash
curl -s -X POST "$BASE_URL/workspaces" \
  -H 'content-type: application/json' \
  -d '{}'
```

列出这个 workspace 的 tab：

```bash
curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"
```

选择一个 tab：

```bash
curl -s -X POST "$BASE_URL/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo" \
  -H 'content-type: application/json' \
  -d '{}'
```

查看当前页面：

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"search","query":"Search"}'
```

查看完整页面快照文本：

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"full"}'
```

执行导航：

```bash
curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

## 当前 endpoint

- `GET /health`
- `POST /workspaces`
- `GET /tabs`
- `POST /select-tab`
- `POST /navigate`
- `POST /click`
- `POST /type`
- `POST /press`
- `POST /query`
- `POST /record-knowledge`
- `POST /shutdown`

## 请求字段

- `workspaceRef`: 逻辑 workspace 名称
- `workspaceTabRef`: workspace 内部的 tab handle
- `url`: `/navigate` 的绝对 URL
- `uid`: 最新快照里的元素句柄
- `text`: `/type` 的输入文本
- `key`: `/press` 的键盘按键
- `mode`: `/query` 必填，取值只能是 `search` 或 `full`
- `query`, `role`, `uid`: `/query` 的搜索条件
- `guide`, `keywords`, `rationale`: `/record-knowledge` 的持久化知识字段

## `query` 用法

- `workspaceRef` 表示 live workspace 查询。
- `workspaceTabRef` 表示显式指定该 workspace 里的某个 tab。
- 同一次请求只使用一种 workspace scope。
- 想要精简 `matches`，优先用 `mode: "search"`。
- 想要整页 `snapshotText`，再用 `mode: "full"`。
- `mode: "search"` 时，至少提供 `query`、`role`、`uid` 其中一个。
- `mode: "full"` 时，不要再传 selector 字段。

## 运行时真相

- `browser-sessiond` 是 Chrome attach、workspace state、snapshot 和 knowledgeHits 的唯一 owner。
- `ensure-browser-session.mjs` 只是 startup shell front door；它负责启动或复用 daemon，并打印 session metadata。
- 启动完成后，所有动作都直接走 HTTP；`/workspaces`、`/tabs`、`/query` 和 mutation endpoint 没有额外的 shell RPC 层。
- `knowledgeHits` 是任务执行时默认的可复用知识入口。
- `record-knowledge` 是唯一显式的持久化写入口，同页同 cue 的重复写入会保持幂等。
- 正常响应暴露的是 workspace identity 和 page identity，而不是本地 snapshot 路径。
- `uid` 是浏览器动作和 `/query` 唯一公开的元素句柄。

## 存储数据

- 运行时临时状态：`~/.sasiki/browser-skill/tmp/`
- 持久化页面知识：`knowledge/page-knowledge.jsonl`

## 验证

在 skill 根目录执行测试：

```bash
npm test
```

## 发布

`skill/` 一直是唯一真源。要把它发布到独立镜像仓库，请在 Sasiki 仓库根目录执行：

```bash
node scripts/publish
```

如果只想先看 subtree split 和 push 计划，不修改远端：

```bash
node scripts/publish --dry-run
```
