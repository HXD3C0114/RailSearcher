// ===== Rail Searcher · 意见反馈后端（Cloudflare Worker + KV）=====
//
// 作用：存所有用户提交的意见反馈，供 App 的「管理模式」拉取查看。
// 不部署也能用（反馈只存本机）；部署了才能看到其他用户提交的内容。
//
// 部署：
//   1) Cloudflare → Workers and Pages → Create → Create Worker
//   2) 粘贴本文件 → Deploy
//   3) Settings → Variables and Secrets 添加：
//        ADMIN_PASS = passwords        （类型 Secret）
//   4) Settings → Bindings → KV Namespace → 变量名填 FEEDBACK，绑定一个 KV 命名空间
//   5) 把得到的 https://xxx.workers.dev 填进 App「管理模式 → 云端后端」
//
// 存储：KV 里单个 key "list" 存 JSON 数组。反馈量不大（单条几 KB、总量远低于 25MB）足够用。

const KEY = "list";
const MAX_ITEMS = 2000;      // 最多保留条数，超出丢最早的
const MAX_LEN = 2000;        // 单条内容最大字符数

function cors(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json; charset=utf-8",
  }, extra || {});
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: cors() });
}

async function readList(env) {
  const raw = await env.FEEDBACK.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function writeList(env, list) {
  await env.FEEDBACK.put(KEY, JSON.stringify(list));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (path !== "/api/feedback") {
      return json({ ok: false, error: "not_found", message: "接口不存在" }, 404);
    }

    if (!env.FEEDBACK) {
      return json({ ok: false, error: "no_kv",
        message: "未绑定 KV。去 Settings → Bindings 添加变量名 FEEDBACK" }, 500);
    }

    const pass = env.ADMIN_PASS || "passwords";

    // ---- 提交（无需口令） ----
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const content = String(body.content || "").trim().slice(0, MAX_LEN);
      if (!content) return json({ ok: false, error: "empty" }, 400);

      const item = {
        id: body.id || crypto.randomUUID(),
        ts: body.ts || new Date().toISOString().slice(0, 19).replace("T", " "),
        content: content,
        device: String(body.device || "").slice(0, 60),
      };
      const list = await readList(env);
      list.push(item);
      if (list.length > MAX_ITEMS) list.splice(0, list.length - MAX_ITEMS);
      await writeList(env, list);
      return json({ ok: true, id: item.id });
    }

    // ---- 以下需要口令 ----
    if (url.searchParams.get("pw") !== pass) {
      return json({ ok: false, error: "unauthorized", message: "口令错误" }, 401);
    }

    // ---- 列表 ----
    if (request.method === "GET") {
      const list = await readList(env);
      list.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
      return json({ ok: true, items: list, total: list.length });
    }

    // ---- 删除 ----
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ ok: false, error: "no_id" }, 400);
      const list = await readList(env);
      const next = list.filter(function (o) { return o.id !== id; });
      await writeList(env, next);
      return json({ ok: true, removed: list.length - next.length });
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  },
};
