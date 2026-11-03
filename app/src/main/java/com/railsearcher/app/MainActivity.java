package com.railsearcher.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Rail Searcher —— 12306api 查询站（Android 版）
 *
 * 页面在 assets/ 里由 WebView 加载；/api/* 请求在 Java 层转发到上游，
 * 密钥只存在于 Java 侧，页面 JS 拿不到。
 *
 * 两种模式：
 *   普通模式 —— 不向页面暴露任何额度 / 计费 / 调用统计信息
 *   管理模式 —— 输入口令解锁，可看额度、调用明细、全部意见反馈
 */
public class MainActivity extends Activity {

    private static final String TAG = "RailSearcher";
    /** 页面 fetch 用的假域名，实际请求由 shouldInterceptRequest 接管 */
    private static final String APP_HOST = "railsearcher.local";
    private static final String UPSTREAM = "https://12306api.lilv5.cn";
    /** 管理模式口令（页面查询框输入它即可解锁） */
    private static final String ADMIN_PASS = "passwords";

    /** 需要透传给页面的响应头：其中 X-Api-* 只在管理模式透传 */
    private static final String[] BILL_HEADERS = {
            "X-Api-Free", "X-Api-Cost", "X-Api-Balance", "X-Api-FreeLeft"
    };
    private static final String[] RATE_HEADERS = {
            "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"
    };

    private static final String PREF = "railsearcher";
    private static final String KEY_ADMIN = "admin_mode";
    private static final String KEY_BACKEND = "backend_url";

    private WebView web;
    private boolean adminMode = false;
    private String backendUrl = "";

    // 本次运行内的调用统计（仅管理模式可见）
    private int statCalls = 0;
    private int statBilled = 0;
    private int statCached = 0;
    private double statCost = 0.0;
    private final List<String> statLog = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences sp = getSharedPreferences(PREF, MODE_PRIVATE);
        adminMode = sp.getBoolean(KEY_ADMIN, false);
        backendUrl = sp.getString(KEY_BACKEND, "");

        web = new WebView(this);
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        ws.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ws.setSafeBrowsingEnabled(false);
        }

        // CSV 导出桥接
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void saveCsv(final String filename, final String content) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        saveText(filename, content);
                    }
                });
            }
        }, "RailSearcher");

        // 管理模式 / 意见反馈桥接
        web.addJavascriptInterface(new Object() {

            /** 口令校验（同步返回，页面据此切换模式） */
            @JavascriptInterface
            public boolean unlock(String pw) {
                boolean ok = ADMIN_PASS.equals(pw == null ? "" : pw.trim());
                if (ok) {
                    adminMode = true;
                    getSharedPreferences(PREF, MODE_PRIVATE).edit()
                            .putBoolean(KEY_ADMIN, true).apply();
                }
                return ok;
            }

            @JavascriptInterface
            public boolean isAdmin() {
                return adminMode;
            }

            @JavascriptInterface
            public void logout() {
                adminMode = false;
                getSharedPreferences(PREF, MODE_PRIVATE).edit()
                        .putBoolean(KEY_ADMIN, false).apply();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (web != null) web.reload();
                    }
                });
            }

            @JavascriptInterface
            public String getBackend() {
                return backendUrl == null ? "" : backendUrl;
            }

            @JavascriptInterface
            public boolean setBackend(String url) {
                backendUrl = (url == null ? "" : url.trim());
                getSharedPreferences(PREF, MODE_PRIVATE).edit()
                        .putString(KEY_BACKEND, backendUrl).apply();
                return true;
            }

            /** 提交意见反馈：先落本地，再异步上传云端（若已配置后端） */
            @JavascriptInterface
            public boolean submitFeedback(String text) {
                if (text == null || text.trim().isEmpty()) return false;
                final JSONObject item = new JSONObject();
                try {
                    item.put("id", UUID.randomUUID().toString());
                    item.put("ts", now());
                    item.put("content", text.trim());
                    item.put("device", Build.MODEL == null ? "" : Build.MODEL);
                    item.put("synced", 0);
                } catch (Exception e) {
                    return false;
                }
                appendLocal(item);
                if (!backendUrl.isEmpty()) {
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            uploadFeedback(item, backendUrl);
                        }
                    }).start();
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, "反馈已提交，谢谢！", Toast.LENGTH_SHORT).show();
                    }
                });
                return true;
            }

            /** 删除一条反馈（本地或云端） */
            @JavascriptInterface
            public boolean delFeedback(String id, boolean remote) {
                if (remote && !backendUrl.isEmpty()) {
                    final String url = backendUrl + "/api/feedback?id=" + Uri.encode(id)
                            + "&pw=" + Uri.encode(ADMIN_PASS);
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            httpDelete(url);
                        }
                    }).start();
                }
                removeLocal(id);
                return true;
            }

            /** 清空本地反馈 */
            @JavascriptInterface
            public boolean clearLocalFeedback() {
                try {
                    File f = feedbackFile();
                    if (f.exists()) f.delete();
                } catch (Exception e) {
                    Log.w(TAG, "clear failed", e);
                }
                return true;
            }
        }, "CRAdmin");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    if (!APP_HOST.equals(uri.getHost())) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        } catch (Exception e) {
                            Log.w(TAG, "open external link failed", e);
                        }
                        return true;
                    }
                }
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!APP_HOST.equals(uri.getHost())) {
                    return null;   // 页面 / CSS / JS 正常从 assets 加载
                }
                String method = request.getMethod();
                if ("OPTIONS".equalsIgnoreCase(method)) {
                    return corsPreflight();
                }
                WebResourceResponse local = handleLocal(uri.getPath());
                if (local != null) {
                    return local;
                }
                return proxyToUpstream(uri);
            }
        });

        web.loadUrl("file:///android_asset/index.html");
    }

    /* ==================== 本地路由 ==================== */

    /** 纯本地接口：不请求上游、不计费 */
    private WebResourceResponse handleLocal(String path) {
        if (path == null) return null;

        if ("/api/ping".equals(path)) {
            return json(200, "{\"ok\":true,\"key_set\":true,\"base_url\":\"" + UPSTREAM + "\"}");
        }
        if ("/api/config".equals(path)) {
            // 查询密码属于后台信息，只在管理模式返回
            String pw = adminMode ? "HXD3C0114" : "";
            return json(200, "{\"ok\":true,\"admin\":" + adminMode +
                    ",\"backend\":\"" + esc(backendUrl) +
                    "\",\"user_password\":\"" + pw + "\"}");
        }
        if ("/api/cache/clear".equals(path)) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (web != null) web.clearCache(true);
                }
            });
            return json(200, "{\"ok\":true,\"message\":\"已清空 WebView 缓存\"}");
        }
        if ("/api/stats".equals(path)) {
            // 普通模式不暴露任何调用统计
            if (!adminMode) {
                return json(200, "{\"ok\":true,\"stats\":null,\"log\":[]}");
            }
            return json(200, statsJson());
        }
        if ("/api/feedback".equals(path)) {
            // 反馈列表仅管理模式可拉取
            if (!adminMode) {
                return json(403, "{\"ok\":false,\"error\":\"forbidden\"," +
                        "\"message\":\"仅管理模式可查看反馈列表\"}");
            }
            return json(200, feedbackListJson());
        }
        return null;
    }

    private synchronized String statsJson() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"stats\":{\"calls\":").append(statCalls)
                .append(",\"billed\":").append(statBilled)
                .append(",\"cached\":").append(statCached)
                .append(",\"cost\":").append(statCost)
                .append("},\"log\":[");
        for (int i = statLog.size() - 1, n = 0; i >= 0 && n < 30; i--, n++) {
            if (n > 0) sb.append(",");
            sb.append(statLog.get(i));
        }
        sb.append("]}");
        return sb.toString();
    }

    /* ==================== 上游代理 ==================== */

    /** 转发 /api/* 到上游；计费头只在管理模式透传 */
    private WebResourceResponse proxyToUpstream(Uri uri) {
        String path = uri.getPath();
        if (path == null) path = "/";
        String query = uri.getQuery();
        String url = UPSTREAM + path + (query != null && !query.isEmpty() ? ("?" + query) : "");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-API-Key", BuildConfig.API_KEY);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "RailSearcher-Android/1.0");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(25000);
            conn.setInstanceFollowRedirects(true);

            int code = conn.getResponseCode();
            InputStream is = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
            if (is == null) is = new ByteArrayInputStream(new byte[0]);

            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Access-Control-Expose-Headers",
                    "X-Api-Free, X-Api-Cost, X-Api-Balance, X-Api-FreeLeft, " +
                            "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After");
            headers.put("Cache-Control", "no-store");

            // 频率 / 重试提示两种模式都给（属于可用性提示，不是额度）
            for (String h : RATE_HEADERS) {
                String v = conn.getHeaderField(h);
                if (v != null) headers.put(h, v);
            }
            // 额度 / 计费信息：仅管理模式
            if (adminMode) {
                for (String h : BILL_HEADERS) {
                    String v = conn.getHeaderField(h);
                    if (v != null) headers.put(h, v);
                }
            }

            // 统计（仅管理模式可见）
            String costStr = conn.getHeaderField("X-Api-Cost");
            String freeLeft = conn.getHeaderField("X-Api-FreeLeft");
            synchronized (this) {
                statCalls++;
                if (code == 200) {
                    statBilled++;
                    try {
                        statCost += Double.parseDouble(costStr == null ? "0" : costStr);
                    } catch (Exception ignore) {
                    }
                }
                statLog.add("{\"ts\":\"" + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date())
                        + "\",\"path\":\"" + esc(path) + "\",\"status\":" + code
                        + ",\"cached\":false,\"cost\":" + (costStr == null ? "null" : ("\"" + esc(costStr) + "\""))
                        + ",\"free_left\":" + (freeLeft == null ? "null" : ("\"" + esc(freeLeft) + "\""))
                        + ",\"ms\":0}");
                if (statLog.size() > 60) statLog.remove(0);
            }

            return new WebResourceResponse("application/json", "utf-8", code,
                    reasonOf(code), headers, is);
        } catch (Exception e) {
            Log.w(TAG, "upstream failed: " + url, e);
            return json(503, "{\"ok\":false,\"status\":0,\"error\":\"network_error\"," +
                    "\"message\":\"无法连接上游服务（" + esc(e.getClass().getSimpleName()) + "）\"," +
                    "\"tip\":\"检查网络连接后重试\"}");
        }
    }

    private WebResourceResponse corsPreflight() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        return new WebResourceResponse("text/plain", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse json(int code, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Expose-Headers",
                "X-Api-Free, X-Api-Cost, X-Api-Balance, X-Api-FreeLeft, " +
                        "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After");
        return new WebResourceResponse("application/json", "utf-8", code, reasonOf(code),
                headers, new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static String reasonOf(int code) {
        switch (code) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 402: return "Payment Required";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            default:  return "Service Unavailable";
        }
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ");
    }

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
    }

    /* ==================== 意见反馈存储 ==================== */

    private File feedbackFile() {
        return new File(getFilesDir(), "feedback.json");
    }

    /** 读取本地反馈（按时间倒序） */
    private List<JSONObject> readLocal() {
        List<JSONObject> list = new ArrayList<>();
        try {
            File f = feedbackFile();
            if (!f.exists()) return list;
            byte[] raw = new byte[(int) f.length()];
            InputStream is = new java.io.FileInputStream(f);
            int read = 0;
            while (read < raw.length) {
                int r = is.read(raw, read, raw.length - read);
                if (r < 0) break;
                read += r;
            }
            is.close();
            JSONArray arr = new JSONArray(new String(raw, StandardCharsets.UTF_8));
            for (int i = arr.length() - 1; i >= 0; i--) {
                list.add(arr.getJSONObject(i));
            }
        } catch (Exception e) {
            Log.w(TAG, "read feedback failed", e);
        }
        return list;
    }

    private void writeLocal(List<JSONObject> list) {
        try {
            JSONArray arr = new JSONArray();
            for (int i = list.size() - 1; i >= 0; i--) arr.put(list.get(i));
            File f = feedbackFile();
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.close();
        } catch (Exception e) {
            Log.w(TAG, "write feedback failed", e);
        }
    }

    private synchronized void appendLocal(JSONObject item) {
        List<JSONObject> list = readLocal();
        list.add(0, item);
        writeLocal(list);
    }

    private synchronized void removeLocal(String id) {
        List<JSONObject> list = readLocal();
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject o : list) {
            if (!id.equals(o.optString("id"))) out.add(o);
        }
        writeLocal(out);
    }

    /** 管理模式拉取：本地 + 云端合并 */
    private String feedbackListJson() {
        JSONArray arr = new JSONArray();
        try {
            for (JSONObject o : readLocal()) {
                o.put("src", "本机");
                arr.put(o);
            }
            if (!backendUrl.isEmpty()) {
                String remote = httpGet(backendUrl + "/api/feedback?pw=" + Uri.encode(ADMIN_PASS));
                if (remote != null) {
                    JSONObject rj = new JSONObject(remote);
                    JSONArray items = rj.optJSONArray("items");
                    if (items != null) {
                        for (int i = items.length() - 1; i >= 0; i--) {
                            JSONObject o = items.getJSONObject(i);
                            o.put("src", "云端");
                            arr.put(o);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "feedback list failed", e);
        }
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true);
            out.put("items", arr);
            out.put("backend", backendUrl);
        } catch (Exception ignore) {
        }
        return out.toString();
    }

    /** 上传一条反馈到云端 */
    private void uploadFeedback(JSONObject item, String base) {
        try {
            byte[] body = item.toString().getBytes(StandardCharsets.UTF_8);
            HttpURLConnection conn = (HttpURLConnection)
                    new URL(base + "/api/feedback").openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();
            int code = conn.getResponseCode();
            conn.disconnect();
            Log.i(TAG, "feedback uploaded: " + code);
        } catch (Exception e) {
            Log.w(TAG, "upload failed", e);
        }
    }

    private String httpGet(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            int code = conn.getResponseCode();
            InputStream is = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
            if (is == null) return null;
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            is.close();
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "httpGet failed: " + url, e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void httpDelete(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("DELETE");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            int code = conn.getResponseCode();
            conn.disconnect();
            Log.i(TAG, "feedback deleted: " + code);
        } catch (Exception e) {
            Log.w(TAG, "httpDelete failed", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /* ==================== 其它 ==================== */

    /** CSV 存到 App 私有目录，无需权限 */
    private void saveText(String filename, String content) {
        try {
            if (filename == null || filename.trim().isEmpty()) filename = "export";
            if (!filename.toLowerCase(Locale.US).endsWith(".csv")) filename = filename + ".csv";
            String stamp = new SimpleDateFormat("HHmmss", Locale.US).format(new Date());
            String safeName = filename.replace("/", "_").replace(":", "_");
            File dir = new File(getExternalFilesDir(null), "RailSearcher");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("cannot create dir");
            File out = new File(dir, stamp + "_" + safeName);
            FileOutputStream fos = new FileOutputStream(out);
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.close();
            Toast.makeText(this, "已保存：" + out.getAbsolutePath(), Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Log.w(TAG, "save failed", e);
            Toast.makeText(this, "保存失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
