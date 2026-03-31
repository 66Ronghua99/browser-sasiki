# Browser Sasiki

Browser Sasiki 是一个面向编码 agent 的浏览器自动化 skill。它通过 Chrome DevTools 连接到一个已经运行中的 Google Chrome 会话，并暴露一组简洁的 HTTP API，用来打开 workspace、查看实时页面、操作页面元素，以及记录可复用的页面知识。

## 做什么

- 启动或复用一个本地浏览器 daemon。
- 打开逻辑 workspace，并跟踪每个 workspace 内的 tab。
- 以 `search` 或 `full` 模式查询当前实时页面。
- 执行 `navigate`、`click`、`type`、`press` 等浏览器动作。
- 记录可复用的页面知识，并在后续任务里返回 `knowledgeHits`。

## 优势

- 持久会话：一个 daemon 持续持有 Chrome 连接和 workspace 状态，不需要每个动作都重新启动。
- workspace-first：agent 可以围绕 workspace 和 tab 工作，不必反复重建上下文。
- 实时页面查询：返回结果来自当前页面状态，而不是过期快照。
- 集成简单：接口就是 HTTP + JSON，方便 Codex、Claude Code 或自定义工具直接调用。
- 知识可复用：稳定页面 cue 可以沉淀一次，在后续任务中重复利用。

## 安装

### 让编码 agent 直接安装

如果你的 agent 支持从 GitHub 仓库安装 skill，可以使用：

- repo: `66Ronghua99/browser-sasiki`
- path: `.`

可以直接把这句话发给 agent：

```text
Please install the `browser-sasiki` skill from the GitHub repo `66Ronghua99/browser-sasiki` at path `.`, restart your agent if needed, and then use that skill for browser automation tasks.
```

### 给 Codex 做本地手动安装

```bash
git clone https://github.com/66Ronghua99/browser-sasiki.git ~/codes/browser-sasiki
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/browser-sasiki
ln -s ~/codes/browser-sasiki ~/.codex/skills/browser-sasiki
cd ~/codes/browser-sasiki
npm install
```

安装完成后重启 Codex，让新 skill 被加载。

## 使用

### 运行前提

- Node `>=20`
- Google Chrome 已经启动
- 该 Chrome 会话已开启 remote debugging
- 如果 Chrome 弹出 attach 确认，需要允许连接

### 启动或复用 daemon

```bash
node scripts/ensure-browser-session.mjs
```

这个命令会输出 JSON session metadata。读取其中的 `baseUrl` 即可，默认通常是 `http://127.0.0.1:3456`。

### 打开 workspace

```bash
curl -s -X POST "$BASE_URL/workspaces" \
  -H 'content-type: application/json' \
  -d '{}'
```

### 查看 workspace 的 tab

```bash
curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"
```

### 查询当前页面

查询实时页面上的目标内容：

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"search","query":"Search"}'
```

获取完整页面快照：

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"full"}'
```

### 操作页面

导航：

```bash
curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

使用上一次查询结果里的 `uid` 点击元素：

```bash
curl -s -X POST "$BASE_URL/click?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"uid":"uid_demo"}'
```

在当前激活元素中输入文本：

```bash
curl -s -X POST "$BASE_URL/type?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"text":"hello"}'
```

### 可用 endpoint

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

## MIT 协议

使用 [MIT License](LICENSE) 发布。
