(function () {
  "use strict";
  var API = "https://railsearcher.local";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  };
  var has = function (n) { return typeof window[n] !== "undefined" && window[n] !== null; };

  var cur = "line";
  var ADMIN = false;
  var lastBill = null;
  var lastHealth = null;

  /* ==================== 管理模式 ==================== */

  function setAdmin(on) {
    ADMIN = !!on;
    document.body.classList.toggle("admin", ADMIN);
    if (ADMIN) {
      refreshStats();
      loadFeedback();
      try { localStorage.setItem("railsearcher_admin", "1"); } catch (e) {}
    } else {
      try { localStorage.removeItem("railsearcher_admin"); } catch (e) {}
      $("#statLine").textContent = "";
      $("#logBox").textContent = "暂无";
      $("#billBox").innerHTML = "—";
      $("#fbList").textContent = "点击「刷新」加载";
    }
    renderStatus(lastHealth);
  }

  function initAdmin() {
    fetch(API + "/api/config").then(function (r) { return r.json(); }).then(function (j) {
      var backend = (j && j.backend) || "";
      $("#backendInput").value = backend;
      $("#userPw").textContent = (j && j.user_password) ? "（查询密码：" + j.user_password + "）" : "";
      setAdmin(!!(j && j.admin));
    }).catch(function () { setAdmin(false); });
  }

  /* ==================== 顶部状态 ==================== */

  function billHtml() {
    if (!lastBill) return '<span class="dim">查询一次后显示额度</span>';
    var p = [];
    if (lastBill.free_left != null) p.push("本月免费剩余 <b>" + esc(lastBill.free_left) + "</b> 次");
    if (lastBill.balance != null) p.push("余额 <b>" + esc(lastBill.balance) + "</b> 元");
    if (lastBill.cost != null) p.push("本次扣费 <b>" + esc(lastBill.cost) + "</b> 元");
    return p.length ? p.join(" · ") : '<span class="dim">暂无额度数据</span>';
  }

  function renderStatus(h) {
    var el = $("#status");
    if (!h || !h.ok) {
      el.innerHTML = '<span class="bad">' + esc((h && h.message) || "服务状态获取失败") + "</span>" +
        (h && h.tip ? "<br>" + esc(h.tip) : "");
      return;
    }
    var d = h.data || {};
    // 普通模式：只给数据版本，不暴露任何后台信息
    if (!ADMIN) {
      el.innerHTML = "数据版本 <b>" + esc(d.data_version || "-") + "</b>";
      return;
    }
    el.innerHTML =
      "数据版本 <b>" + esc(d.data_version || "-") + "</b> · 线路 <b>" + esc(d.lines) +
      "</b> · 站名 <b>" + esc(d.stations) + "</b>（条目 " + esc(d.station_entries) + "）";
  }

  function loadHealth() {
    fetch(API + "/api/health").then(function (r) { return r.json(); }).then(function (j) {
      lastHealth = j;
      renderStatus(j);
    }).catch(function () { renderStatus(null); });
  }

  /* ==================== 统计 / 日志（仅管理） ==================== */

  function refreshStats() {
    if (!ADMIN) return;
    fetch(API + "/api/stats").then(function (r) { return r.json(); }).then(function (j) {
      var s = j.stats;
      if (!s) { $("#statLine").textContent = ""; $("#logBox").textContent = "暂无"; return; }
      $("#statLine").textContent = "本次会话：调用 " + s.calls + " 次 · 计费 " + s.billed +
        " 次 · 累计 " + (s.cost || 0).toFixed(4) + " 元";
      var box = $("#logBox");
      if (!j.log || !j.log.length) { box.textContent = "暂无"; return; }
      box.innerHTML = j.log.map(function (l) {
        return "<div><span class='s'>" + esc(l.ts) + "</span><span class='s " +
          (l.status === 200 ? "" : "bad") + "'>" + esc(l.status || "ERR") + "</span>" +
          "<span style='flex:1;overflow:hidden;text-overflow:ellipsis'>" +
          esc(decodeURIComponent(l.path)) + "</span>" +
          "<span class='s'>" + (l.cached ? "缓存" : esc(l.cost || "0")) + "</span></div>";
      }).join("");
    }).catch(function () {});
  }

  /* ==================== 线路名联想 ==================== */

  function loadLines() {
    fetch(API + "/api/lines").then(function (r) { return r.json(); }).then(function (j) {
      if (j.bill && j.bill.free_left != null) {
        lastBill = j.bill;
        if (ADMIN) $("#billBox").innerHTML = billHtml();
      }
      if (!j.ok || !Array.isArray(j.data)) return;
      $("#lineList").innerHTML = j.data.map(function (n) {
        return "<option value='" + esc(n) + "'></option>";
      }).join("");
    }).catch(function () {});
  }

  /* ==================== Tab / 查询 ==================== */

  $$("#tabs .tab").forEach(function (b) {
    b.addEventListener("click", function () {
      cur = b.dataset.t;
      $$("#tabs .tab").forEach(function (x) { x.classList.toggle("on", x === b); });
      $$(".pane").forEach(function (p) { p.classList.toggle("on", p.id === "p-" + cur); });
      $("#result").innerHTML = "";
    });
  });

  function go(type, value) {
    $$("#tabs .tab").forEach(function (x) { x.classList.toggle("on", x.dataset.t === type); });
    $$(".pane").forEach(function (p) { p.classList.toggle("on", p.id === "p-" + type); });
    cur = type;
    $("#p-" + type + " input").value = value;
    $("#result").innerHTML = "";
    submit(type, value);
  }

  function submit(type, value) {
    // 口令：查询框输入 passwords 进入管理模式
    if (value === "passwords" && has("CRAdmin")) {
      if (window.CRAdmin.unlock(value)) {
        setAdmin(true);
        $("#result").innerHTML = "<div class='card'><h2>已进入管理模式</h2>" +
          "<div class='meta'>可查看额度、调用明细与全部意见反馈</div></div>";
        loadHealth();
      }
      return;
    }
    var res = $("#result");
    res.innerHTML = "<div class='loading'>查询中…</div>";
    var q = (type === "train" || type === "stock") ? "no" : "name";
    fetch(API + "/api/" + type + "?" + q + "=" + encodeURIComponent(value))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.bill && j.bill.free_left != null) {
          lastBill = j.bill;
          if (ADMIN) $("#billBox").innerHTML = billHtml();
        }
        if (!j.ok) { res.innerHTML = errHtml(j, value); refreshStats(); return; }
        res.innerHTML = render[type](j.data, j);
        bindResult();
        refreshStats();
      })
      .catch(function (e) {
        res.innerHTML = "<div class='err'><div class='t'>请求失败</div>" +
          "<div class='s'>" + esc(e) + "</div></div>";
      });
  }

  function errHtml(j, value) {
    var tip = j.tip ? "<div class='s'>" + esc(j.tip) + "</div>" : "";
    var extra = "";
    if (j.status === 429 && j.bill && j.bill.retry_after) {
      extra = "<div class='s'>请 " + esc(j.bill.retry_after) + " 秒后重试</div>";
    }
    return "<div class='err'><div class='t'>" + esc(j.message || ("HTTP " + j.status)) +
      "：<b>" + esc(value) + "</b></div>" + tip + extra + "</div>";
  }

  /* ==================== CSV 导出 ==================== */

  function csvBtn(rows, name, head) {
    var csv = "\ufeff" + [head].concat(rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    })).join("\n");
    CSV_STORE[String(name)] = { name: String(name), content: csv };
    var key = String(name).replace(/'/g, "").replace(/"/g, "");
    return "<button class='mini' style='background:#eef2f7;color:#1a73e8;border:1px solid #d8e2f0' " +
      "onclick='window.__csvExport(\"" + esc(key) + "\")'>导出 CSV</button>";
  }

  var CSV_STORE = {};
  window.__csvExport = function (key) {
    var item = CSV_STORE[key];
    if (!item) return;
    if (has("RailSearcher") && window.RailSearcher.saveCsv) {
      window.RailSearcher.saveCsv(item.name, item.content);
    } else {
      var blob = new Blob([item.content], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = item.name + ".csv";
      a.click();
    }
  };

  /* ==================== 结果渲染 ==================== */

  var render = {
    line: function (d) {
      var st = d.stations || [];
      var kms = st.map(function (s) { return s.mileage; }).filter(function (v) { return typeof v === "number"; });
      var max = kms.length ? Math.max.apply(null, kms) : 0;
      var min = kms.length ? Math.min.apply(null, kms) : 0;
      var noCode = st.filter(function (s) { return !s.code || s.code === "N/A"; }).length;
      var rows = st.map(function (s, i) { return [i + 1, s.name, s.code, s.mileage, s.code_source]; });
      return "<div class='card'><h2>" + esc(d.name) + "</h2>" +
        "<div class='meta'>数据版本 " + esc(d.updated_at) + "</div>" +
        "<div class='kv'><span>站点 <b>" + st.length + "</b></span><span>里程 <b>" + min + "–" + max +
        "</b> km</span><span>无电报码 <b>" + noCode + "</b></span></div>" +
        "<div style='margin-bottom:8px'>" + csvBtn(rows, d.name, "站序,站名,电报码,里程,码源") + "</div>" +
        "<div class='scroll'><table><thead><tr><th>#</th><th>站名</th><th>电报码</th><th>里程</th><th>码源</th></tr></thead><tbody>" +
        st.map(function (s, i) {
          return "<tr class='click' data-go='station' data-v='" + esc(s.name) + "'><td class='num'>" + (i + 1) +
            "</td><td>" + esc(s.name) + "</td><td>" + esc(s.code) + "</td><td class='num'>" + esc(s.mileage) +
            "</td><td>" + esc(s.code_source) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        "<div class='src'>点击站名可查该站所属线路</div></div>";
    },

    station: function (d) {
      var ls = d.lines || [];
      var rows = ls.map(function (l) { return [l.line, l.mileage]; });
      var srcBadge = d.code_source === "12306" ? "<span class='badge g'>12306 客运站</span>" :
        (d.code_source === "llt" ? "<span class='badge y'>上游略号</span>" : "<span class='badge'>无电报码</span>");
      return "<div class='card'><h2>" + esc(d.name) + " <span class='badge'>" + esc(d.code) + "</span>" + srcBadge + "</h2>" +
        "<div class='meta'>共属 <b>" + ls.length + "</b> 条线路 · 版本 " + esc(d.updated_at) + "</div>" +
        (ls.length ? "<div style='margin-bottom:8px'>" + csvBtn(rows, d.name, "线路,公里标") + "</div>" +
          "<div class='scroll'><table><thead><tr><th>线路</th><th>公里标</th></tr></thead><tbody>" +
          ls.map(function (l) {
            return "<tr class='click' data-go='line' data-v='" + esc(l.line) + "'><td>" + esc(l.line) +
              "</td><td class='num'>" + esc(l.mileage) + "</td></tr>";
          }).join("") + "</tbody></table></div><div class='src'>点击线路名查看全线站点</div>"
          : "<div class='empty'>该站没有线路归属记录</div>") + "</div>";
    },

    train: function (d) {
      var st = d.stops || [];
      var mins = function (t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1]); };
      var dur = "";
      if (st.length > 1) {
        var a = mins(st[0].dep || st[0].arr), b = mins(st[st.length - 1].arr);
        var m = b - a; if (m < 0) m += 1440;
        dur = Math.floor(m / 60) + " 小时 " + (m % 60) + " 分";
      }
      var km = st.length ? st[st.length - 1].km : 0;
      var rows = st.map(function (s) { return [s.seq, s.station, s.arr, s.dep, s.stop, s.km]; });
      var extra = "";
      if (d.unit) extra += "<div class='kv'><span>担当 <b>" + esc(d.unit) + "</b></span></div>";
      if (d.consist) extra += "<div class='src'>编组：" + esc(d.consist) + "</div>";
      if (d.route) extra += "<div class='src'>交路：" + esc(d.route) + "</div>";
      if (!d.unit && !d.consist && !d.route) extra += "<div class='src'>该车次无担当 / 编组 / 交路数据</div>";
      return "<div class='card'><h2>" + esc(d.train) +
        (d.train_id && d.train_id !== d.train ? " <span class='badge'>库内 " + esc(d.train_id) + "</span>" : "") + "</h2>" +
        "<div class='meta'>" + st.length + " 个停站 · 全程 " + km + " km" + (dur ? " · 运行 " + dur : "") + "</div>" +
        "<div style='margin-bottom:8px'>" + csvBtn(rows, d.train, "站序,站名,到达,出发,停分,累计里程") + "</div>" + extra +
        "<div class='scroll' style='margin-top:8px'><table><thead><tr><th>#</th><th>站名</th><th>到</th><th>开</th><th>停</th><th>km</th></tr></thead><tbody>" +
        st.map(function (s) {
          return "<tr class='click' data-go='station' data-v='" + esc(s.station) + "'><td class='num'>" + esc(s.seq) +
            "</td><td>" + esc(s.station) + "</td><td class='num'>" + esc(s.arr) + "</td><td class='num'>" + esc(s.dep) +
            "</td><td class='num'>" + esc(s.stop) + "</td><td class='num'>" + esc(s.km) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        "<div class='src'>点击站名可查该站</div></div>";
    },

    stock: function (d) {
      var deps = d.depots || [];
      return "<div class='card'><h2>" + esc(d.code) + "</h2>" +
        "<div class='meta'>" + esc(d.model || "-") + "</div>" +
        "<div class='kv'><span>当前配属 <b>" + esc(d.depot || "无记录") + "</b></span>" +
        "<span>收录照片 <b>" + esc(d.photos) + "</b> 条</span></div>" +
        (deps.length > 1 ? "<div class='src'>历史配属：" + deps.map(esc).join(" → ") + "</div>" : "") +
        "<div class='src'>车迷拍摄记录，非官方台账</div></div>";
    }
  };

  function bindResult() {
    $$("#result tr.click").forEach(function (tr) {
      tr.addEventListener("click", function () { go(tr.dataset.go, tr.dataset.v); });
    });
  }

  /* ==================== 意见反馈 ==================== */

  var FB_CACHE = [];

  function toggleFbForm(show) {
    $("#fbForm").classList.toggle("hidden", !show);
    if (show) $("#fbText").focus();
  }

  function submitFeedback() {
    var text = $("#fbText").value.trim();
    if (!text) { $("#fbText").focus(); return; }
    if (!has("CRAdmin") || !window.CRAdmin.submitFeedback) {
      $("#fbForm").insertAdjacentHTML("beforeend", "<p class='fb-note'>当前环境不支持提交</p>");
      return;
    }
    window.CRAdmin.submitFeedback(text);
    $("#fbText").value = "";
    toggleFbForm(false);
  }

  function loadFeedback() {
    if (!ADMIN) return;
    $("#fbList").innerHTML = "<div class='empty'>加载中…</div>";
    fetch(API + "/api/feedback").then(function (r) { return r.json(); }).then(function (j) {
      var items = (j && j.items) || [];
      FB_CACHE = items;
      if (!items.length) {
        $("#fbList").innerHTML = "<div class='empty'>暂无反馈</div>";
        return;
      }
      $("#fbList").innerHTML = items.map(function (o, i) {
        var local = o.src === "本机";
        return "<div class='fb-item'><div class='m'><span>" + esc(o.ts || "") +
          " <span class='fb-src" + (local ? " local" : "") + "'>" + esc(o.src || "") + "</span>" +
          (o.device ? " · " + esc(o.device) : "") + "</span>" +
          "<button class='d' data-i='" + i + "'>删除</button></div>" +
          "<div class='c'>" + esc(o.content || "") + "</div></div>";
      }).join("");
      $$("#fbList .d").forEach(function (b) {
        b.addEventListener("click", function () {
          var o = FB_CACHE[+b.dataset.i];
          if (!o) return;
          if (has("CRAdmin") && window.CRAdmin.delFeedback) {
            window.CRAdmin.delFeedback(o.id, o.src !== "本机");
          }
          loadFeedback();
        });
      });
    }).catch(function () {
      $("#fbList").innerHTML = "<div class='empty'>加载失败</div>";
    });
  }

  function exportFeedback() {
    if (!FB_CACHE.length) return;
    var csv = "\ufeff" + ["时间,来源,设备,内容"].concat(FB_CACHE.map(function (o) {
      return [o.ts, o.src, o.device, o.content].map(function (c) {
        return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"';
      }).join(",");
    })).join("\n");
    if (has("RailSearcher") && window.RailSearcher.saveCsv) {
      window.RailSearcher.saveCsv("意见反馈", csv);
    }
  }

  /* ==================== 事件绑定 ==================== */

  $$(".fm").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = f.querySelector("input");
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      submit(f.dataset.api, v);
    });
  });

  $("#btnHealth").addEventListener("click", loadHealth);

  $("#btnFeedback").addEventListener("click", function () {
    toggleFbForm($("#fbForm").classList.contains("hidden"));
  });
  $("#fbSubmit").addEventListener("click", submitFeedback);
  $("#fbCancel").addEventListener("click", function () { toggleFbForm(false); });

  $("#btnClear").addEventListener("click", function () {
    fetch(API + "/api/cache/clear").then(function (r) { return r.json(); }).then(function () {
      loadLines(); loadHealth(); refreshStats();
    });
  });

  $("#btnBackend").addEventListener("click", function () {
    var v = $("#backendInput").value.trim();
    if (has("CRAdmin") && window.CRAdmin.setBackend) window.CRAdmin.setBackend(v);
    loadFeedback();
  });

  $("#btnFbRefresh").addEventListener("click", loadFeedback);
  $("#btnFbCsv").addEventListener("click", exportFeedback);
  $("#btnFbClear").addEventListener("click", function () {
    if (has("CRAdmin") && window.CRAdmin.clearLocalFeedback) window.CRAdmin.clearLocalFeedback();
    loadFeedback();
  });

  $("#btnLogout").addEventListener("click", function () {
    if (has("CRAdmin") && window.CRAdmin.logout) window.CRAdmin.logout();
    setAdmin(false);
  });

  /* ==================== 启动 ==================== */

  initAdmin();
  loadHealth();
  loadLines();
})();
