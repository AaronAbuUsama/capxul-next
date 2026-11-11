// The portal's only script. It runs on the Questions page: it shows one item at a time and takes the owner's answer. When
// the page is served by `pnpm portal:serve` the answer is saved through /api/answers (a line in plan/answers.jsonl, which
// the coordinator applies). Opened from files or a static host there is no such endpoint, and the page falls back to the
// typed answer and a prefilled GitHub issue. It holds no credential.
(function () {
  "use strict";
  var main = document.querySelector("main[data-repo]");
  if (!main) return;
  document.documentElement.classList.add("js");

  var articles = Array.prototype.slice.call(main.querySelectorAll("article.q"));
  var items = Array.prototype.slice.call(main.querySelectorAll(".q-item"));
  var mode = "checking"; // No answer until the destination is known
  var saved = {}; // item key -> the answer line it holds

  function show(id) {
    articles.forEach(function (a) { a.classList.toggle("is-current", a.dataset.decision === id); });
    items.forEach(function (i) {
      var on = i.dataset.for === id;
      i.classList.toggle("is-current", on);
      if (on) i.setAttribute("aria-current", "true"); else i.removeAttribute("aria-current");
    });
  }

  function fromHash() {
    var hash = decodeURIComponent(location.hash.slice(1));
    var target = hash ? document.getElementById(hash) : null;
    var article = target && target.closest ? target.closest("article.q") : null;
    return article ? article.dataset.decision : (articles[0] ? articles[0].dataset.decision : "");
  }

  function picked(article) {
    var input = article.querySelector("input[type=radio]:checked");
    return input ? input.value : article.dataset.chosen;
  }

  function label(article) {
    var button = article.querySelector('[data-act="accept"]');
    if (!button) return;
    var option = picked(article);
    button.textContent = option === article.dataset.chosen ? "Accept the recommendation" : "Choose " + option + " instead";
  }

  // The answer as the server and the ledger read it: { how, option?, text? } for a target { kind, id }.
  function howOf(article, act, text) {
    if (article.dataset.kind === "need") return act === "done" ? { how: "done" } : { how: "text", text: text };
    if (act === "accept") return picked(article) === article.dataset.chosen ? { how: "accept" } : { how: "choose", option: picked(article) };
    return { how: "change", text: text };
  }
  function targetOf(article) { return { kind: article.dataset.kind === "need" ? "task" : "decision", id: article.dataset.target }; }

  function words(answer) {
    var a = answer.answer;
    if (a.how === "accept") return "accepted the recommendation";
    if (a.how === "choose") return "chose " + a.option;
    if (a.how === "change") return "changed it: " + a.text;
    return a.how === "done" ? "marked this done" : "said: " + a.text;
  }

  // Saved is not applied. Keep the generated navigation count unchanged across pages.
  function paint(article) {
    var answer = saved[article.dataset.decision];
    var box = article.querySelector(".saved");
    var item = main.querySelector('.q-item[data-for="' + article.dataset.decision + '"]');
    box.hidden = !answer;
    article.querySelector(".actions").hidden = !!answer;
    article.querySelector(".change").hidden = true;
    article.querySelector(".answer").hidden = true;
    if (answer) {
      var at = new Date(answer.at);
      box.querySelector(".saved-text").textContent = "Saved " + at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ": " + words(answer) + ". The coordinator applies it next; until then you can undo it.";
    }
    if (item) {
      item.classList.toggle("is-answered", !!answer);
      item.querySelector(".q-status").textContent = answer ? "Saved" : "Waiting for you";
    }
    var unknown = articles.filter(function (a) { return !saved[a.dataset.decision]; }).length;
    var count = main.querySelector(".q-count-big");
    if (count) count.textContent = String(articles.length);
    var summary = main.querySelector(".q-answer-counts");
    if (summary) summary.textContent = unknown + " waiting for you · " + (articles.length - unknown) + " saved, for the coordinator to apply";
  }

  function fail(article, message) {
    var box = article.querySelector(".q-error");
    box.textContent = message;
    box.hidden = false;
  }

  function send(article, body, done) {
    article.querySelector(".q-error").hidden = true;
    fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (json) { return { ok: res.ok, json: json }; }); })
      .then(function (r) { if (r.ok) done(r.json); else fail(article, r.json.error || "The answer was not saved."); })
      .catch(function () { fail(article, "The answer was not saved: the server did not answer."); });
  }

  function esc(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // JSON with the token classes the generator gives a code block (render/internal/highlight.ts). Every string is
  // escaped, so words typed into the answer cannot become markup.
  function highlightJson(json) {
    return json.replace(/("(?:[^"\\\n]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g, function (found, string, colon, word) {
      if (string) return '<span class="tk-' + (colon ? "key" : "str") + '">' + esc(string) + "</span>" + (colon || "");
      return '<span class="tk-' + (word ? "kw" : "num") + '">' + found + "</span>";
    });
  }

  // No server: the typed answer and the link that files it as an issue.
  function file(article, how) {
    var answer = { target: targetOf(article), answer: how, by: main.dataset.reviewer, at: new Date().toISOString(), seenAt: main.dataset.commit };
    var json = JSON.stringify(answer, null, 2);
    var title = "review: " + article.dataset.target + " (" + how.how + ")";
    var panel = article.querySelector(".answer");
    panel.querySelector(".answer-json").innerHTML = highlightJson(json);
    panel.querySelector(".answer-link").href = main.dataset.repo + "/issues/new?title=" + encodeURIComponent(title) +
      "&body=" + encodeURIComponent("```json\n" + json + "\n```\n") + "&labels=" + encodeURIComponent(main.dataset.label);
    panel.hidden = false;
  }

  function answer(article, how) {
    if (mode === "checking") return;
    if (mode !== "server") { file(article, how); return; }
    send(article, { target: targetOf(article), answer: how }, function (json) { saved[article.dataset.decision] = json.answer; paint(article); });
  }

  items.forEach(function (item) {
    item.addEventListener("click", function (event) {
      event.preventDefault();
      history.replaceState(null, "", "#q-" + item.dataset.for);
      show(item.dataset.for);
    });
  });

  articles.forEach(function (article) {
    label(article);
    article.addEventListener("change", function (event) {
      if (event.target && event.target.type === "radio") { label(article); article.querySelector(".answer").hidden = true; }
    });
    article.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-act]") : null;
      if (!button || mode === "checking") return;
      var act = button.dataset.act;
      var change = article.querySelector(".change");
      if (act === "accept" || act === "done") {
        change.hidden = true;
        answer(article, howOf(article, act, ""));
      } else if (act === "change") {
        change.hidden = !change.hidden;
        if (!change.hidden) change.querySelector("textarea").focus();
      } else if (act === "send") {
        var text = change.querySelector("textarea").value.trim();
        if (text === "") { change.querySelector("textarea").focus(); return; }
        answer(article, howOf(article, "change", text));
      } else if (act === "undo") {
        var id = saved[article.dataset.decision] && saved[article.dataset.decision].id;
        if (id) send(article, { withdraw: id }, function () { delete saved[article.dataset.decision]; paint(article); });
      }
    });
  });

  function serving(next, message) {
    mode = next;
    main.querySelector(".q-serving-mode").textContent = message;
    articles.forEach(function (a) {
      Array.prototype.forEach.call(a.querySelectorAll("button[data-act]"), function (b) { b.disabled = false; });
    });
  }

  // Is there a server behind this page? Only a JSON answer from /api/answers says so.
  fetch("/api/answers", { cache: "no-store", headers: { accept: "application/json" } })
    .then(function (res) { return res.ok && (res.headers.get("content-type") || "").indexOf("json") >= 0 ? res.json() : null; })
    .then(function (json) {
      if (!json || !Array.isArray(json.answers)) throw new Error("no server");
      serving("server", "Your answer is saved on this Mac. You can undo it until the coordinator applies it; then the question leaves this page.");
      json.answers.forEach(function (a) { saved[(a.target.kind === "task" ? "task-" : "") + a.target.id] = a; });
      articles.forEach(paint);
    })
    .catch(function () {
      serving("files", "GitHub issue mode: local saving is unavailable or could not be verified. Answer buttons prepare an issue; nothing is saved here. Open the GitHub issue and submit it there.");
      articles.forEach(function (a) { a.querySelector(".fallback-note").textContent = "Local saving is unavailable or unverified. Prepare your answer below, then open and submit the GitHub issue."; a.querySelector(".fallback-note").hidden = false; });
    });

  window.addEventListener("hashchange", function () { show(fromHash()); });
  show(fromHash());
})();
