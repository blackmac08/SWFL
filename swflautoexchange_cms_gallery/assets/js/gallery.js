(function () {
  function fmtDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function card(v) {
    const imgAlt = v.title ? v.title : "Recently purchased vehicle";
    const subtitle = v.subtitle ? `<p class="rp-subtitle">${v.subtitle}</p>` : "";
    const meta = (v.date || v.location) ? `<p class="rp-meta">${[fmtDate(v.date), v.location].filter(Boolean).join(" • ")}</p>` : "";
    const notes = v.notes ? `<p class="rp-notes">${v.notes}</p>` : "";
    const img = v.image ? `<img loading="lazy" src="${v.image}" alt="${imgAlt}">` : "";
    return `<article class="rp-card">${img}<div class="rp-copy"><h3 class="rp-title">${v.title||""}</h3>${subtitle}${meta}${notes}</div></article>`;
  }

  function render(list) {
    var grid = document.getElementById("recent-purchases-grid");
    if (!grid) return;
    if (!Array.isArray(list) || !list.length) {
      grid.innerHTML = `<p>No recent purchases yet. Check back soon!</p>`;
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  function init() {
    fetch("/data/recent-purchases.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (data) { render(data && data.vehicles ? data.vehicles : []); })
      .catch(function () {
        var grid = document.getElementById("recent-purchases-grid");
        if (grid) grid.innerHTML = "<p>Unable to load recent purchases right now.</p>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();