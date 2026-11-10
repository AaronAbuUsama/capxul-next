// The portal's only script. It runs on the Questions page: it shows one question at a time, builds the typed answer
// (a ReviewAnswer), shows it, and points a link at a prefilled GitHub issue. It writes nothing and holds no credential.
(function () {
  "use strict";
  var main = document.querySelector("main[data-repo]");
  if (!main) return;
  document.documentElement.classList.add("js");

  var articles = Array.prototype.slice.call(main.querySelectorAll("article.q"));
  var items = Array.prototype.slice.call(main.querySelectorAll(".q-item"));

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
    var option = picked(article);
    button.textContent = option === article.dataset.chosen ? "Accept the recommendation" : "Choose " + option + " instead";
  }

  // The answer as the ledger reads it. `seenAt` is the commit this page was built from.
  function answerOf(article, kind, text) {
    var option = picked(article);
    var answer = { decision: article.dataset.decision, answer: kind };
    if (kind === "choose") answer.option = option;
    if (kind === "change") answer.text = text;
    answer.by = main.dataset.reviewer;
    answer.at = new Date().toISOString();
    answer.seenAt = main.dataset.commit;
    return answer;
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

  function file(article, answer) {
    var json = JSON.stringify(answer, null, 2);
    var title = "review: " + answer.decision + " (" + answer.answer + ")";
    var body = "```json\n" + json + "\n```\n";
    var panel = article.querySelector(".answer");
    panel.querySelector(".answer-json").innerHTML = highlightJson(json);
    panel.querySelector(".answer-link").href = main.dataset.repo + "/issues/new?title=" + encodeURIComponent(title) +
      "&body=" + encodeURIComponent(body) + "&labels=" + encodeURIComponent(main.dataset.label);
    panel.hidden = false;
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
      if (!button) return;
      var act = button.dataset.act;
      var change = article.querySelector(".change");
      if (act === "accept") {
        change.hidden = true;
        file(article, answerOf(article, picked(article) === article.dataset.chosen ? "accept" : "choose", ""));
      } else if (act === "change") {
        change.hidden = !change.hidden;
        if (!change.hidden) change.querySelector("textarea").focus();
      } else if (act === "send") {
        var text = change.querySelector("textarea").value.trim();
        if (text === "") { change.querySelector("textarea").focus(); return; }
        file(article, answerOf(article, "change", text));
      }
    });
  });

  window.addEventListener("hashchange", function () { show(fromHash()); });
  show(fromHash());
})();
