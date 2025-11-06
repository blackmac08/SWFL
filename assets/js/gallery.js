(function(){
fetch('data/recent-purchases.json').then(r=>r.json()).then(d=>{
 const grid=document.getElementById('recent-purchases-grid');
 grid.innerHTML=d.vehicles.map(v=>`<article class="rp-card"><img src="${v.image}" alt="${v.title}"><div class="rp-copy"><h3>${v.title}</h3><p>${v.subtitle||''}</p><p>${v.location||''}</p></div></article>`).join('');
}).catch(()=>{});
})();