#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rail Searcher · 一键推送到 GitHub（iPad / a-Shell 专用）

解决 iPad 上无法一次上传整个文件夹的问题：
本脚本在 a-Shell 里解压 RailSearcher-android.zip，然后通过 GitHub API
把每个文件（含 .github 等隐藏目录、多层嵌套路径）逐个推上去。
推完 GitHub Actions 会自动开始编译 APK。

用法：
    python3 push_github.py
然后按提示输入 用户名 / 仓库名 / Token。
"""

import os
import sys
import json
import ssl
import base64
import zipfile
import urllib.request
import urllib.error

ZIP_NAMES = [
    "RailSearcher-android.zip",
    "RailSearcher-android (1).zip",
    "RailSearcher-android-1.zip",
    # 兼容改名前的旧包
    "CRcheck-android.zip",
    "CRcheck-android (1).zip",
]
# 解压出来的目录名（旧包解压后仍叫 CRcheck-android，两个都认）
ROOT = "RailSearcher-android"
ROOT_ALTS = ["RailSearcher-android", "CRcheck-android"]
API = "https://api.github.com"

# 不需要上传的文件
SKIP_NAMES = {".DS_Store", "local.properties", ".gitignore"}
SKIP_DIRS = {"__pycache__", ".gradle", "build", ".git", ".idea"}


def ssl_ctx():
    """iOS 上可能缺根证书，优先用 certifi"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try:
            return ssl.create_default_context()
        except Exception:
            return None


def find_zip():
    """在常见位置找压缩包"""
    here = os.getcwd()
    cands = [here, os.path.expanduser("~"), os.path.join(os.path.expanduser("~"), "Documents"),
             os.path.join(os.path.expanduser("~"), "Downloads"),
             os.path.join(os.path.expanduser("~"), "tmp")]
    for d in cands:
        if not os.path.isdir(d):
            continue
        for n in ZIP_NAMES:
            p = os.path.join(d, n)
            if os.path.isfile(p):
                return p
        # 兜底：目录里任何含 RailSearcher / CRcheck 的 zip（新旧都认）
        try:
            for n in os.listdir(d):
                low = n.lower()
                if low.endswith(".zip") and ("railsearcher" in low or "crcheck" in low):
                    return os.path.join(d, n)
        except Exception:
            pass
    return None


def unzip(zpath):
    print("解压：%s" % os.path.basename(zpath))
    with zipfile.ZipFile(zpath) as z:
        z.extractall(os.getcwd())
    # 有的解压工具会多包一层 / 旧包解压后仍叫 CRcheck-android，都归一到 ROOT
    for n in os.listdir(os.getcwd()):
        p = os.path.join(os.getcwd(), n)
        if os.path.isdir(p) and os.path.isdir(os.path.join(p, "app")) \
                and not os.path.isfile(os.path.join(p, "settings.gradle")):
            os.rename(p, ROOT)
            break
    if not os.path.isdir(ROOT):
        print("× 解压后没找到 %s 目录" % ROOT)
        sys.exit(1)
    print("√ 已解压到 ./%s" % ROOT)


def looks_like_root(d):
    """判断某个目录是不是工程根目录"""
    return (os.path.isfile(os.path.join(d, "settings.gradle"))
            and os.path.isdir(os.path.join(d, "app")))


def resolve_root():
    """
    定位工程根目录，三种情况都支持：
      A) 当前目录就是工程根（cd 进解压好的文件夹后跑）
      B) 当前目录下有 RailSearcher-android/ 或 CRcheck-android/ 子目录
      C) 当前目录只有 zip（自动解压）
    """
    cwd = os.getcwd()
    if looks_like_root(cwd):
        print("√ 当前目录就是工程根目录")
        return cwd
    for name in ROOT_ALTS:
        sub = os.path.join(cwd, name)
        if looks_like_root(sub):
            print("√ 使用子目录 ./%s" % name)
            return sub
    zp = find_zip()
    if zp:
        unzip(zp)
        for name in ROOT_ALTS:
            if looks_like_root(os.path.join(cwd, name)):
                return os.path.join(cwd, name)
        if looks_like_root(cwd):
            return cwd
        print("× 解压后结构不对，找不到 settings.gradle + app/")
        sys.exit(1)
    print("\n× 没找到工程，也没找到 RailSearcher-android.zip")
    print("  请先用「文件」App 把压缩包存进 a-Shell 文件夹，再重跑本脚本")
    sys.exit(1)


def collect(root):
    """收集待上传的相对路径"""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn in SKIP_NAMES or fn.endswith(".pyc"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            out.append((rel, full))
    out.sort()
    return out


def api(method, path, token, body=None):
    url = API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "RailSearcher-iPad/1.0")
    if data:
        req.add_header("Content-Type", "application/json")
    ctx = ssl_ctx()
    kw = {"timeout": 60}
    if ctx is not None:
        kw["context"] = ctx
    try:
        with urllib.request.urlopen(req, **kw) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        try:
            return e.code, json.loads(raw) if raw else {}
        except Exception:
            return e.code, {"message": raw[:200]}
    except Exception as e:
        return 0, {"message": "%s: %s" % (type(e).__name__, e)}


def get_sha(owner, repo, path, token):
    code, j = api("GET", "/repos/%s/%s/contents/%s" % (owner, repo, path), token)
    if code == 200 and isinstance(j, dict):
        return j.get("sha")
    return None


def push_file(owner, repo, rel, full, token):
    try:
        with open(full, "rb") as f:
            raw = f.read()
    except Exception as e:
        return False, "读取失败 %s" % e
    content = base64.b64encode(raw).decode("ascii")

    body = {"message": "Add %s" % rel, "content": content}
    code, j = api("PUT", "/repos/%s/%s/contents/%s" % (owner, repo, rel), token, body)

    if code == 422:  # 已存在，带上 sha 再推一次（更新）
        sha = get_sha(owner, repo, rel, token)
        if sha:
            body["sha"] = sha
            body["message"] = "Update %s" % rel
            code, j = api("PUT", "/repos/%s/%s/contents/%s" % (owner, repo, rel), token, body)

    if code in (200, 201):
        return True, ""
    msg = j.get("message", "") if isinstance(j, dict) else str(j)
    return False, "HTTP %s %s" % (code, msg)


def main():
    print("=" * 50)
    print(" Rail Searcher · 一键推送到 GitHub")
    print("=" * 50)

    # 1 定位工程目录（自动处理 已解压 / 子目录 / 压缩包 三种情况）
    root = resolve_root()

    files = collect(root)
    if not files:
        print("× 没找到可上传的文件")
        sys.exit(1)
    print("√ 待上传 %d 个文件" % len(files))

    # 2 收信息
    print("\n" + "-" * 50)
    owner = input("GitHub 用户名: ").strip()
    repo = input("仓库名 (如 RailSearcher): ").strip()
    print("Token（粘贴后回车，输入会显示，注意周围）:")
    token = input("> ").strip()

    if not owner or not repo or not token:
        print("× 信息不完整")
        sys.exit(1)

    # 3 校验仓库可访问
    print("\n检查仓库…")
    code, j = api("GET", "/repos/%s/%s" % (owner, repo), token)
    if code != 200:
        msg = j.get("message", "") if isinstance(j, dict) else ""
        print("× 打不开仓库 %s/%s （HTTP %s %s）" % (owner, repo, code, msg))
        if code == 401:
            print("  Token 无效或过期，重新生成一个")
        elif code == 404:
            print("  仓库不存在，或 Token 没勾 repo 权限")
        sys.exit(1)
    print("√ 仓库可访问")

    # 4 逐个上传
    print("\n开始上传…")
    ok, bad = 0, []
    for i, (rel, full) in enumerate(files, 1):
        good, err = push_file(owner, repo, rel, full, token)
        if good:
            ok += 1
            print("  [%d/%d] √ %s" % (i, len(files), rel))
        else:
            bad.append((rel, err))
            print("  [%d/%d] × %s  (%s)" % (i, len(files), rel, err))

    print("\n" + "=" * 50)
    print(" 上传完成：成功 %d，失败 %d" % (ok, len(bad)))
    if bad:
        print("\n失败明细：")
        for rel, err in bad:
            print("  - %s : %s" % (rel, err))

    print("\n下一步：")
    print("  1) 浏览器打开 https://github.com/%s/%s" % (owner, repo))
    print("  2) 点顶部 Actions")
    print("  3) 若提示启用 workflow，点 \"I understand my workflows\"")
    print("  4) 左侧选 Build Rail Searcher APK → Run workflow")
    print("  5) 2–4 分钟后变绿，点进去，最下面 Artifacts 下载 Rail-Searcher-apk")
    print("=" * 50)


if __name__ == "__main__":
    main()
