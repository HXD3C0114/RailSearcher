# Rail Searcher · Android 版

12306api 查询站的安卓安装包。**纯系统 API**（WebView + HttpURLConnection），零第三方依赖，编译快、体积小。

## 两种模式

| | 普通模式（默认） | 管理模式 |
|---|---|---|
| 进入方式 | 打开就是 | 在**查询输入框**里输入 `passwords` 并点查询 |
| 查询功能 | 全部可用 | 全部可用 |
| 额度 / 余额 / 扣费 | **完全看不到** | 可见 |
| 调用统计、调用明细 | **完全看不到** | 可见 |
| 数据版本 | 可见 | 可见 + 线路数 / 站名数 |
| 意见反馈 | 可提交 | 可提交 + 查看全部 + 删除 + 导出 |
| 官方查询密码 | 隐藏 | 可见 |

管理模式状态会记住，退出点管理面板里的「退出」。

## 它在手机上是怎么工作的

- 页面（HTML/CSS/JS）打包进 APK 的 `assets/`，由 WebView 本地加载，界面断网也能显示
- 所有 `/api/*` 请求由 Java 层拦截后转发到 `https://12306api.lilv5.cn`，请求头里带上密钥
- **密钥只存在 Java 侧**，页面 JS 里看不到，也不会出现在 URL 里
- **计费头只在管理模式透传给页面**；普通模式下 Java 层直接丢弃 `X-Api-Free/Cost/Balance/FreeLeft`，
  `/api/stats` 返回空、反馈列表返回 403，页面上也用 CSS 把相关区块隐藏——双重保险
- 导出 CSV 走原生文件保存，绕过 WebView 不支持 blob 下载的限制
- 意见反馈先写本机文件，若配置了云端后端会异步上传一份

```
RailSearcher-android/
├── push_github.py                    iPad 一键推送脚本（自动建目录 + 上传）
├── .github/workflows/build-apk.yml   GitHub Actions 自动构建
├── github-workflow-build-apk.yml     上面那个的可见副本（隐藏目录不好传）
├── settings.gradle / build.gradle / gradle.properties
├── deploy-cloudflare/                可选的云端反馈后端
└── app/
    ├── build.gradle                  密钥在这里（或 local.properties）
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/railsearcher/app/MainActivity.java
        ├── res/                      图标、主题、应用名
        └── assets/                   index.html / style.css / app.js
```

---

## 路线 1：iPad / 手机上用一键脚本推送（推荐，最省事）

iPad 在 GitHub 网页上**没法一次上传整个文件夹**（网页只认文件，拖文件夹会被忽略，
而且 `.github` 这种隐藏目录还容易丢）。所以包里带了 `push_github.py`：
它在 a-Shell 里跑，自动把整个工程（含隐藏目录、多层嵌套）推到 GitHub。

### 第 1 步：建空仓库 + 生成 Token

浏览器打开 **github.com**（没账号注册一个，免费）：

1. 右上角 **+ → New repository**
   - Repository name：`RailSearcher`
   - 选 **Public**（私有仓库的 Actions 有额度限制）
   - **不要**勾 "Add a README file"（保持完全空白）
   - 点 **Create repository**
2. 生成 Token：右上角头像 → **Settings** → 最下面 **Developer settings**
   → **Personal access tokens → Tokens (classic)** → **Generate new token (classic)**
   - Note 填 `RailSearcher`
   - 勾选 **`repo`**（整个勾上）
   - 点 **Generate**，复制那串 `ghp_xxxxxxxx`——**只显示这一次**，先粘到备忘录里

### 第 2 步：把工程放到 iPad 上

1. 把 `RailSearcher-android.zip` 存进 iPad 的「文件」App（微信发给自己 → 用其他应用打开 → 存储到"文件"）
2. 在「文件」App 里**点一下这个 zip**，iPad 会自动解压出 `RailSearcher-android` 文件夹
3. 把这个 `RailSearcher-android` **文件夹**移动到 **我的 iPad → a-Shell**

### 第 3 步：跑脚本

打开 a-Shell：

```
ls
```

看到 `RailSearcher-android` 就 `cd` 进去并运行：

```
cd RailSearcher-android
python3 push_github.py
```

按提示输入：

```
GitHub 用户名: 你的用户名
仓库名 (如 RailSearcher): RailSearcher
Token（粘贴后回车）: ghp_xxxxxxxxxxxx
```

脚本会自动上传 19 个文件（含 `.github/workflows/build-apk.yml`），每个都打 √。
跑完会告诉成功率，失败会列出原因。

> 如果提示证书错误，先执行一次 `pip install certifi` 再重跑。

### 第 4 步：触发构建

1. 浏览器打开 `https://github.com/你的用户名/RailSearcher`，能看到文件都在了
2. 点 **Actions** → 若提示 "I understand my workflows, go ahead and enable them"，点它
3. 左侧 **Build Rail Searcher APK** → 右侧 **Run workflow** → 再点 **Run workflow**
4. 等 2–4 分钟，那一条变绿（✓）后点进去
5. 最下面 **Artifacts** → **Rail-Searcher-apk** 下载，解压出 `Rail-Searcher-1.0-debug.apk`

---

## 路线 2：手动上传（不用 a-Shell，适合文件少的场合）

GitHub 网页虽不能传文件夹，但有个技巧：**Create new file 的文件名框里填完整路径，
GitHub 会自动建出所有中间目录**。例如文件名框填：

```
app/src/main/java/com/railsearcher/app/MainActivity.java
```

就会自动建出 5 层目录。13 个必需文件各操作一次，内容从解压好的文件里复制粘贴。

如果嫌麻烦，也可以装 **Working Copy**（App Store，免费的 Git 客户端）：
在它里面新建仓库 → 用「文件」App 把整个 `RailSearcher-android` 文件夹拷进去 →
commit → push 到 GitHub。一次搞定，比逐个粘贴舒服。

---

## 路线 2：本地 Android Studio（有电脑时）

1. 装 **Android Studio**（官网免费版即可），首次启动会自动下载 JDK 17 和 Android SDK
2. **File → Open** 选中 `RailSearcher-android` 文件夹
3. 等 Gradle Sync 完成（第一次要下载 Gradle 和 AGP，需联网，几分钟）
4. **Build → Build Bundle(s)/APK(s) → Build APK(s)**
5. 产物在 `app/build/outputs/apk/debug/Rail-Searcher-1.0-debug.apk`

也可以命令行：`./gradlew assembleDebug`（或系统装了 Gradle 8.x 就直接 `gradle assembleDebug`）。

---

## 换密钥

默认已内置你的密钥。想换就在工程根目录建 `local.properties`：

```
API_KEY=sk_12306api_你的新密钥
```

（这个文件已在 `.gitignore` 里，不会上传。）

---

## 版本说明

| 项 | 值 |
|---|---|
| 应用名 | Rail Searcher |
| 包名 | com.railsearcher.app |
| 最低系统 | Android 7.0（API 24） |
| 目标 SDK | 34 |
| 依赖 | 无 |
| 权限 | 仅 INTERNET、ACCESS_NETWORK_STATE |

---

## ⚠️ 关于 APK 里的密钥和口令

APK 可以被反编译（jadx 等工具几分钟就能还原 Java 代码），**写在 App 里的密钥和管理口令无法做到真正保密**。

管理口令 `passwords` 改位置：`MainActivity.java` 里的

```java
private static final String ADMIN_PASS = "passwords";
```

普通模式下后台信息做了**双层屏蔽**（Java 层不给头 + 页面不渲染），但反编译者绕过页面直接看代码仍能知道口令——
所以这层设计防的是「普通用户误看到」，不是防逆向。如果管理功能需要真正隔离，同样建议走服务端。

如果只是自己用、额度不大，问题不大。但如果这个密钥对你重要，建议改成「App → 你自己的服务端 → 上游」的两段式：

- 服务端用现成的 `deploy-cloudflare/worker.js`（密钥存在 Cloudflare 的 Secret 里，拿不到）
- App 里 `UPSTREAM` 改成你的 Worker 地址，它自己不加任何密钥头

改动位置：`MainActivity.java` 里的

```java
private static final String UPSTREAM = "https://12306api.lilv5.cn";
```

---

## 意见反馈

- 普通用户：页面底部「意见反馈」→ 输入内容 → 提交。先存本机，配了云端会一并上传
- 管理模式：能看到**本机 + 云端**的全部反馈，可以单条删除、导出 CSV、清空本机
- 云端后端部署见 `deploy-cloudflare/README.md`，不部署也能用（只是看不到别人的）

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 脚本提示 `certificate verify failed` | iOS 缺根证书，a-Shell 里执行 `pip install certifi` 后重跑 |
| 脚本提示 `打不开仓库 … HTTP 404` | 仓库名拼错，或 Token 没勾 `repo` 权限，重新生成一个 |
| 脚本提示 `HTTP 401` | Token 无效/过期/复制少了字符，重新生成 |
| 上传后 Actions 里没有 workflow | 检查 `.github/workflows/build-apk.yml` 是否上传成功（脚本输出里能看到） |
| Actions 里 Gradle 报错 `SDK location not found` | 确认 workflow 里有 `android-actions/setup-android@v3` 这一步 |
| 装完 App 打不开 / 白屏 | 检查是否授予了网络权限（本 App 只需 INTERNET，系统默认给） |
| 查询一直转圈 | 手机没联网，或上游临时故障；先看页面顶部的状态条提示 |
| 提示 401 | 密钥失效或被停用，联系 lilv5@lilv5.cn |
| 提示 402 | 余额到 -2.00 元透支上限，需充值 |
| 输入 passwords 没反应 | 要输入后点「查询」按钮；口令区分大小写，前后不能有空格 |
| 管理模式看不到别人的反馈 | 需要在「云端后端」填入 Worker 地址，见 `deploy-cloudflare/README.md` |
