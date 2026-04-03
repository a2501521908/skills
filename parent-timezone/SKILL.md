---
name: parent-timezone
description: >-
  修改国际化家长时区。通过管台接口更新 parent 的 timeZone 字段。
  支持通过手机号搜索家长获取 parentId。通过 API 直接登录认证获取 token。
  支持 sa、k2、us、jp、tw、vn 六个站点。Token 自动缓存，密码自动保存，修改后自动验证。
  Use when the user mentions 修改时区、家长时区、timeZone、parent timezone、时区修改工单。
---

# 国际化家长时区修改 Skill

## 核心原则

**通过管台 API 修改家长时区。API 直接认证，密码用户全自动续期，Token 缓存复用，修改后自动验证。**

- 脚本：`timezone.mjs`（位于本 SKILL.md 同目录下）
- Token 缓存：`.tokens.json`（同目录，自动管理，8 小时过期）
- 密码缓存：`.credentials.json`（同目录，密码用户自动保存，token 过期自动重新登录）
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
2. **家长标识**：用户会给一串数字，需要判断是手机号还是 parentId
3. **目标时区**：用户可能说国家/城市名，需转换为 `GMT±HH:00` 格式

### 手机号 vs parentId 判断策略

用户给的数字，按以下规则判断：

| 特征 | 判定 | 说明 |
|------|------|------|
| 7~15 位数字（含前导零） | **手机号** | 国际手机号通常 7~15 位 |
| `0000` 或 `00000` 开头 | **测试手机号** | 系统测试账号约定 |
| 1~6 位纯数字（无前导零） | **parentId** | parentId 通常较短 |
| 用户明确说"手机号" | **手机号** | 以用户明确说法为准 |
| 用户明确说"parentId/pid/用户ID" | **parentId** | 以用户明确说法为准 |

**如果无法确定，必须向用户确认！** 例如："这个数字是手机号还是 parentId？"

- 如果是**手机号**：先走第三步搜索，从结果中获取 parentId
- 如果是**parentId**：直接走第四步修改

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

### 第二步：认证（API 直接登录）

**认证通过 API 直接登录，无需打开浏览器！**

#### 首次认证

1. 向用户询问**公司邮箱**（如 `xxx@vipkid.com.cn`）
2. 查询登录策略：

```bash
node $SKILL_DIR/timezone.mjs login-strategy --site {site} --user {email}
```

3. 根据策略类型：
   - **PASSWORD** → 向用户询问密码，执行登录：
   ```bash
   node $SKILL_DIR/timezone.mjs auth --site {site} --user {email} --password {password}
   ```
   密码将自动保存到 `.credentials.json`，**后续 token 过期时全自动重新登录，无需再次输入**。

   - **PASSWORD_OTP** → 先发送验证码，再向用户询问收到的验证码：
   ```bash
   # 发送验证码（钉钉/邮箱）
   node $SKILL_DIR/timezone.mjs send-otp --site {site} --email {email}
   # 用户提供验证码后登录
   node $SKILL_DIR/timezone.mjs auth --site {site} --user {email} --password {otp_code} --login-type PASSWORD_OTP
   ```

**所有 Shell 调用必须添加 `required_permissions: ["full_network"]`**

#### Token 自动续期

- 所有业务命令（search/update/verify）自动使用缓存 token，无需传 `--token`
- Token 过期时：
  - PASSWORD 用户：**全自动重新登录**，无需任何用户交互
  - PASSWORD_OTP 用户：需要重新走 OTP 流程
- 传入 `--token` 可手动覆盖并刷新缓存

### 第三步：搜索家长（手机号时必须）

如果是手机号，**必须先搜索获取 parentId，严禁直接拿手机号当 parentId 去修改！**

```bash
node $SKILL_DIR/timezone.mjs search \
  --site {site} --phone {phone} [--country-code {code}]
```

**必须添加 `required_permissions: ["full_network"]`**

不传 `--country-code` 时使用站点默认国家码。

#### 搜索结果处理策略

| 结果数量 | Agent 行为 |
|----------|-----------|
| **0 条** | 告知用户未找到，确认手机号和站点是否正确 |
| **1 条** | 直接使用该 parentId 进入第四步 |
| **≥2 条** | **必须用 AskQuestion 让用户选择！** 列出所有结果的 parentId、name、phone、email、status，让用户明确指定哪一个 |

**多条结果示例**（使用 AskQuestion）：

搜到多个家长，请选择：
- A: parentId=12501913, name=test, phone=966-000****001, status=TEST
- B: parentId=12501920, name=张三, phone=966-000****001, status=ACTIVE
- C: parentId=12502000, name=李四, phone=86-000****001, status=ACTIVE

**绝对不要自动选第一个！必须让用户确认。**

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
# 查看 token & 凭据状态
node $SKILL_DIR/timezone.mjs token-status

# 查询登录策略
node $SKILL_DIR/timezone.mjs login-strategy --site sa --user xxx@vipkid.com.cn

# API 登录（密码模式 - 自动保存）
node $SKILL_DIR/timezone.mjs auth --site sa --user xxx@vipkid.com.cn --password mypassword

# API 登录（OTP 模式）
node $SKILL_DIR/timezone.mjs send-otp --site sa --email xxx@vipkid.com.cn
node $SKILL_DIR/timezone.mjs auth --site sa --user xxx@vipkid.com.cn --password 123456 --login-type PASSWORD_OTP

# 搜索家长（自动使用缓存 token）
node $SKILL_DIR/timezone.mjs search --site sa --phone 509471425

# 修改时区 + 自动验证
node $SKILL_DIR/timezone.mjs update --site sa --parent-id 12501913 --timezone "GMT+08:00"

# 单独验证
node $SKILL_DIR/timezone.mjs verify --site sa --parent-id 12501913
```

## 注意事项

- Token 8 小时自动过期
- PASSWORD 用户：凭据自动保存，token 过期全自动重新登录
- PASSWORD_OTP 用户：token 过期需重新发送验证码
- exit code 2 表示认证问题，需重新登录
- 时区格式必须为 `GMT±HH:MM`
- 所有 Shell 调用必须加 `required_permissions: ["full_network"]`
