# 管理员登录

[English](README.md) | 中文

这个可选的 Cordis 插件为标准 `dsh web` 增加一个管理员账号。账号密码和原有启动 token 都使用 Connection 现有的 owner Peer 与签名 HttpOnly Cookie，不改动上游实现、认证格式、Agent、工作区或会话存储。

## 安装使用

使用 Node.js 24.9 或更新版本，安装与仓库根目录 `package.json` 版本一致的官方 `@deepseek-ai/dsh`（当前为 `0.2.2-rc.1`）。在本仓库目录中设置密码并加载插件；`--patch` 必须放在应用参数之前：

```sh
node custom/admin-auth/password.mjs --username admin
dsh web --patch "$PWD/custom/admin-auth/cordis.patch.yml" --no-open
```

命令会隐藏输入，并要求确认密码。密码长度为 12–1024 个 UTF-8 字节。账号记录保存在 `$DSH_HOME/admin-auth.json`；未设置 `DSH_HOME` 时为 `~/.dsh/admin-auth.json`。文件只保存随机盐和 scrypt 哈希，权限为仅所有者可读写，必须放在仓库之外。设置密码和启动服务应使用相同的 `DSH_HOME`。自动化时可通过管道与 `--password-stdin` 传入密码，不要把密码写进命令参数。

打开不带 token 的服务地址会显示登录页面；dsh 输出的完整 `?token=...` 链接保留原有行为，并以该管理员身份登录。完整链接相当于管理员凭据，请妥善保管。两种方式均进入原有 Web 界面，之后照常选择工作区并配置模型。

如需每次 `dsh web` 都启用插件，在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中追加 `insert` 项，id 为 `soufock-admin-auth`，`name` 为本目录 `plugin.mjs` 的**绝对路径**，保留原有配置。此时不要再传入命令行 overlay，以免重复插入同一 id。删除这条配置即可恢复上游的 token 登录入口。

## 配置与运维

overlay 支持 `credentialFile`（可选的账号文件绝对路径）、`maxAttempts`（默认 10 次）、`windowSeconds`（默认 60 秒）和 `maxBodyBytes`（默认 8192）。限流在插件实例内全局生效，错误账号也计入；同一时刻只进行一次密码校验，不依赖可能被伪造的代理客户端 IP。重启或重载插件会重置限流窗口，原 token 恢复入口不受密码限流影响。

再次运行密码命令即可修改密码或账号，新登录立即读取新记录，无需重启。已经签发的会话继续遵循上游 Cookie 有效期，token 登录签发的会话同样如此。修改密码不等于撤销现有会话。如需撤销全部会话，应通过上游凭据管理机制轮换浏览器会话签名凭据；不要删除整个凭据文件，其中可能包含模型凭据。

`GET /auth/me` 要求有效的原有会话 Cookie，返回 `{"username":"admin","role":"admin"}`，其中账号名随实际配置变化。两种登录方式的身份一致，均有完整 owner 权限。`POST /auth/logout` 要求会话 Cookie 与同源 `Origin` 头，会使浏览器中的 `dsh-auth-*` Cookie 过期并跳回登录入口。退出只删除当前浏览器 Cookie，不会在服务端撤销已被复制的 Cookie。同源浏览器可使用 `fetch('./auth/logout', { method: 'POST' })` 调用。

插件启动时账号文件缺失或格式错误，会阻止该插件加载；运行中删除或破坏文件会使密码登录失败并显示通用错误，不会放行请求。token 认证仍由 Connection 负责。插件在 `/` 提供登录表单，认证后交给标准前端的 `/index.html` 资源渲染，其他静态资源和 API 仍由上游处理。它面向标准 Web profile，不用于桌面端或无界面 profile。

远程部署时，保留 DSH 原有的 Host/Origin 白名单和监听地址配置，在监听器或可信反向代理上启用 HTTPS；代理应保留 `Host`、`Origin`，并转发 `/auth/*`、`/api/*` 及 WebSocket 路由。使用路径前缀时，应先去掉前缀再转发。本插件不会开放防火墙，也不会放宽 Connection 的信任检查。Cookie 的有效期、持久化、签名及原生 TLS 的 `Secure` 属性仍由上游负责。

## 验证与同步上游

插件不依赖 npm 包，也不需要编译：

```sh
node --test custom/admin-auth/tests/*.test.mjs
```

测试通过临时目录与密码启动真实已安装的 `dsh web`，检查密码和 token 登录、同一管理员身份、API 保护、错误凭据、跨站请求防护、退出、密码轮换、请求大小和限流。通过 `DSH_BIN` 可以指定更新后的 dsh 可执行文件，无需模型 API 密钥。

专用 CI 还会通过 Playwright 1.65.0 运行 `tests/browser-smoke.mjs`。本地验证时，在仓库之外安装 Playwright 和 Chromium，将 `DSH_PLAYWRIGHT_MODULE` 指向 Playwright 的 `index.mjs` 绝对路径，再运行 `node custom/admin-auth/tests/browser-smoke.mjs`。可用 `DSH_CHROMIUM` 指定现有 Chromium，可用 `DSH_BROWSER_ARTIFACTS` 指定截图目录。该检查覆盖原生表单提交、键盘焦点、手机和横屏布局、明暗主题、错误提示、两种登录方式以及真实浏览器 Cookie 的退出行为。Playwright 仅用于测试，插件运行不需要它。

本仓库保留 GitHub fork 关系，`origin` 指向 `Soufock/dsh`。首次添加官方上游：

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
```

在工作区干净时合并上游，不重写本地改造的提交：

```sh
git fetch upstream master
git switch master
git merge upstream/master
# 安装此时 package.json 声明的官方 dsh 版本。
node --test custom/admin-auth/tests/*.test.mjs
git push origin master
```

自定义代码全部位于 `custom/admin-auth/`，此外只新增专门的 CI 工作流；上游文件不变，因此无需反复向 Connection、BrowserAuth 或 frontend-static 打补丁。测试使用这些模块的公开方法，以检测上游 API 或路由变化。没有合并冲突不代表运行一定兼容；更新后还应在浏览器中检查手机宽度、明暗主题、错误反馈、密码登录、token 登录和退出。

## 模型体验

插件不增加工具、提示词或模型上下文。两种登录方式使用同一个 owner Peer，共享工作区、会话和权限，不实现多用户或租户隔离。
