---
name: parent-timezone
description: >-
  修改国际化家长时区。通过管台接口更新 parent 的 timeZone 字段。
  支持通过手机号搜索家长获取 parentId。需要浏览器登录管台获取认证 token。
  支持 sa、k2、us、jp、tw、vn 六个站点。Token 自动缓存，修改后自动验证。
  Use when the user mentions 修改时区、家长时区、timeZone、parent timezone、时区修改工单。
---

# 国际化家长时区修改 Skill

## 核心原则

**通过管台 API 修改家长时区。Token 自动缓存复用，修改后自动验证结果。**

- 脚本：`timezone.mjs`（位于本 SKILL.md 同目录下）
- Token 缓存：`.tokens.json`（同目录，自动管理，8 小时过期）
- 无外部依赖，Node.js 18+ 即可运行

## 路径约定

**`SKILL_DIR`** = 本 SKILL.md 所在目录的绝对路径。Agent 读取本文件时已知此路径。

以下所有命令中的 `$SKILL_DIR` 均指此目录，例如：
- 如果本文件位于 `~/.cursor/skills/parent-timezone/SKILL.md`，则 `$SKILL_DIR` = `~/.cursor/skills/parent-timezone`
- 如果位于 `~/.qclaw/skills/parent-timezone/SKILL.md`，则 `$SKILL_DIR` = `~/.qclaw/skills/parent-timezone`

**Agent 执行命令时，必须将 `$SKILL_DIR` 替换为实际绝对路径。**

## 站点配置

| 站点 | code | 管台域名 | 默认国家码 |
|------|------|---------|-----------|
| 沙特 SA | `sa` | `sa-manager.lionabc.com` | 966 |
| K2 | `k2` | `k2-manager.lionabc.com` | - |
| 美国 US | `us` | `us-manager.lionabc.com` | 1 |
| 日本 JP | `jp` | `jp-manager.lionabc.com` | 81 |
| 台湾 TW | `tw` | `tw-manager.lionabc.com` | 886 |
| 越南 VN | `vn` | `vn-manager.lionabc.com` | 84 |

## 完整工作流程（傻瓜式）

### 第一步：收集信息

向用户询问（可用 AskQuestion 工具）：

1. **所属业务站点**：sa / k2 / us / jp / tw / vn
2. **家长标识**：parentId（优先），或手机号（用于搜索）
3. **目标时区**：用户可能说国家/城市名，需转换为 `GMT±HH:00` 格式

### 常见时区映射

| 用户表述 | 时区值 |
|----------|--------|
| 中国、北京 | GMT+08:00 |
| 韩国、首尔 | GMT+09:00 |
| 日本、东京 | GMT+09:00 |
| 台湾、台北 | GMT+08:00 |
| 沙特、利雅得 | GMT+03:00 |
| 越南、河内 | GMT+07:00 |
| 美东、纽约 | GMT-05:00 |
| 美西、洛杉矶 | GMT-08:00 |
| 英国、伦敦 | GMT+00:00 |
| 印度、孟买 | GMT+05:30 |
| 泰国、曼谷 | GMT+07:00 |
| 新加坡 | GMT+08:00 |
| 澳洲东部、悉尼 | GMT+10:00 |

### 第二步：获取认证 Token

**脚本自动管理 Token 缓存，按站点存储，8 小时有效。**

先检查是否有缓存 token：

```bash
node $SKILL_DIR/timezone.mjs token-status
```

- **有有效缓存** → 直接跳到第三步，不传 `--token` 参数即可自动使用缓存
- **无缓存或已过期** → 需要浏览器认证，流程如下：

#### 浏览器认证流程

1. 用 `browser_navigate` 打开对应站点管台首页：`https://{site}-manager.lionabc.com/`
2. 站点会自动重定向到 SSO 登录页，等待用户完成登录
3. 登录完成后，执行 cookie 提取：

```
browser_navigate → javascript:void(document.title=document.cookie)
```

4. 从返回的 Page Title 中用正则 `/intlAuthToken=([^;]+)/` 提取 token
5. 保存 token 到缓存：

```bash
node $SKILL_DIR/timezone.mjs save-token --site {site} --token {token}
```

**后续操作自动使用缓存 token，无需再传 `--token`。**

#### 当 Token 失效时

脚本调用 API 遇到认证失败会自动清除缓存并以 exit code 2 退出，输出 `AUTH_EXPIRED`。
此时需重新走浏览器认证流程。

### 第三步：搜索家长（可选）

如果用户只提供了手机号：

```bash
node $SKILL_DIR/timezone.mjs search \
  --site {site} --phone {phone} [--country-code {code}]
```

**必须添加 `required_permissions: ["full_network"]`**

不传 `--country-code` 时使用站点默认国家码。如果搜出多个结果，展示给用户确认。

### 第四步：执行修改（自动验证）

```bash
node $SKILL_DIR/timezone.mjs update \
  --site {site} --parent-id {parentId} --timezone "{timezone}"
```

**必须添加 `required_permissions: ["full_network"]`**

update 命令执行后会**自动调用详情接口验证**，输出包含：
- 修改是否成功
- 家长完整信息（parentId、phone、email、timeZone、children 等）
- 验证结果：✅ VERIFIED 或 ⚠️ MISMATCH

### 第五步：单独验证（可选）

如果需要单独查看家长当前时区：

```bash
node $SKILL_DIR/timezone.mjs verify \
  --site {site} --parent-id {parentId}
```

## 快速示例

```bash
# 检查 token 缓存状态
node $SKILL_DIR/timezone.mjs token-status

# 保存 token（浏览器提取后）
node $SKILL_DIR/timezone.mjs save-token --site sa --token 7822ac52-xxx

# 搜索家长（自动使用缓存 token）
node $SKILL_DIR/timezone.mjs search --site sa --phone 509471425

# 修改时区 + 自动验证
node $SKILL_DIR/timezone.mjs update --site sa --parent-id 12501913 --timezone "GMT+08:00"

# 单独验证
node $SKILL_DIR/timezone.mjs verify --site sa --parent-id 12501913
```

## 注意事项

- Token 8 小时自动过期，过期后需重新浏览器认证
- 传入 `--token` 会自动刷新缓存，不传则用缓存
- exit code 2 表示认证问题，需重新浏览器认证
- 时区格式必须为 `GMT±HH:MM`
- 所有 Shell 调用必须加 `required_permissions: ["full_network"]`
