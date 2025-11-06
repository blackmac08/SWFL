(function () {
  function fmtDate(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  function card(v) {
    const imgAlt = v.title || "Recently purchased vehicle";
    const subtitle = v.subtitle ? `<p class="rp-subtitle">${v.subtitle}</p>` : "";
    const bits = []; if (v.date) bits.push(fmtDate(v.date)); if (v.location) bits.push(v.location);
    const meta = bits.length ? `<p class="rp-meta">${bits.join(" • ")}</p>` : "";
    const notes = v.notes ? `<p class="rp-notes">${v.notes}</p>` : "";
    const img = v.image ? `<img loading="lazy" src="${v.image}" alt="${imgAlt}">` : "";
    return `<article class="rp-card">${img}<div class="rp-copy"><h3 class="rp-title">${v.title||""}</h3>${subtitle}${meta}${notes}</div></article>`;
  }
  function render(list, msgIfEmpty) {
    const grid = document.getElementById("recent-purchases-grid");
    if (!grid) return;
    if (!Array.isArray(list) || !list.length) { grid.innerHTML = msgIfEmpty || `<p>No recent purchases yet. Check back soon!</p>`; return; }
    list.sort((a,b) => String(b.date||"").localeCompare(String(a.date||""))); // newest first
    grid.innerHTML = list.map(card).join("");
  }
  function tryFetch(urls) {
    let chain = Promise.reject();
    urls.forEach(url => {
      chain = chain.catch(() => fetch(url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return r.json(); }));
    });
    return chain;
  }
  function init() {
    try {
      const inline = document.getElementById("recent-purchases-data");
      if (inline && inline.textContent.trim()) { const d = JSON.parse(inline.textContent); render(d && d.vehicles ? d.vehicles : []); return; }
    } catch (e) {}
    const candidates = ["/data/recent-purchases.json", "data/recent-purchases.json"];
    tryFetch(candidates).then(d => render(d && d.vehicles ? d.vehicles : []))
      .catch(() => { render([{ image:"", title:"Sample: 2019 BMW M4 Competition", subtitle:"Carbon buckets • ZCP", date:"2025-01-05", location:"Naples, FL", notes:"Placeholder. Add real entries in /admin." }], ""); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();