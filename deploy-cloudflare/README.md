# 云端反馈后端（可选）

不部署也能用：意见反馈会存在手机本地，管理模式能看到**本机**提交的反馈。

部署了才能看到**其他用户**提交的反馈。免费，全程网页操作，约 5 分钟。

---

## 部署步骤

1. 打开 <https://dash.cloudflare.com>，注册 / 登录
2. **Workers and Pages → Create → Create Worker**，名字填 `railsearcher-feedback`，点 **Deploy**
3. 点 **Edit code**，删掉默认内容，粘贴 `worker-feedback.js` 全文 → **Deploy**
4. **Settings → Variables and Secrets → Add**：
   - `ADMIN_PASS` = `passwords`，类型选 **Secret**
5. **Settings → Bindings → Add → KV namespace**：
   - 变量名填 **`FEEDBACK`**（必须一字不差）
   - KV 命名空间点 **Create new**，名字随便（如 `railsearcher-fb`），创建后绑定
6. 回到 Worker 概览页，复制网址，形如 `https://railsearcher-feedback.xxx.workers.dev`
7. 打开 App → 查询框输入 `passwords` → 进入管理模式 → 在「云端后端」填入这个网址 → 保存

之后管理模式里「刷新」就能看到所有用户提交的反馈。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/feedback` | 提交，`{"content":"...","device":"...","id":"...","ts":"..."}`，无需口令 |
| GET | `/api/feedback?pw=passwords` | 拉取全部（倒序），需口令 |
| DELETE | `/api/feedback?id=xxx&pw=passwords` | 删除一条，需口令 |

口令不对返回 401。单条内容截断到 2000 字，最多保留 2000 条（超出丢最早的）。

免费额度：Workers 10 万请求/天，KV 10 万读/天、1000 写/天、1 GB 存储——个人用途远远用不完。

---

## 想连浏览器自测

部署后把下面两个地址粘到浏览器地址栏：

```
https://你的地址/api/feedback?pw=passwords
```

应该看到 `{"ok":true,"items":[],"total":0}`（还没人提交的话）。

---

## 进阶：让 App 的查询也走 Worker

默认 App 直连 `12306api.lilv5.cn`，密钥在 APK 里（可被反编译）。若想彻底隐藏密钥，
让 `worker-feedback.js` 同时承担代理：把 App 里 `UPSTREAM` 改成你的 Worker 地址，
Worker 侧再加一段转发逻辑加上密钥头即可（参考另一个工程里的 `deploy-cloudflare/worker.js`）。
这一步是可选的，改完密钥就不在 APK 里了。
