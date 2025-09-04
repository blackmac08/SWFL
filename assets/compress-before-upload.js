
/*! compress-before-upload.js (safe edition) */
(function(w,d){
  const Config={maxDimension:1600,targetBytes:300*1024,qualityFloor:.5,enabled:true};
  function safe(fn, fallback){ try{ return fn() } catch(e){ return fallback } }
  function toBlob(c,t='image/jpeg',q=.85){ return new Promise(res=>{ try{ c.toBlob?c.toBlob(b=>res(b||null),t,q):res(null) } catch(e){ res(null) } }); }
  async function fileToBitmap(f){
    try{ return await createImageBitmap(f) }catch(e){
      return await new Promise((res,rej)=>{ try{
        const u=URL.createObjectURL(f); const i=new Image(); i.onload=()=>{ URL.revokeObjectURL(u); res(i) };
        i.onerror=e=>{ URL.revokeObjectURL(u); res(null) }; i.src=u;
      }catch(e){ res(null) }});
    }
  }
  function fit(wi,hi,m){ if(wi<=m&&hi<=m) return {w:wi,h:hi}; const s=wi>hi?m/wi:m/hi; return {w:Math.round(wi*s),h:Math.round(hi*s)}; }
  async function compress(f){
    if(!Config.enabled) return f;
    if(!f || !/^image\//i.test(f.type) || f.size<=Config.targetBytes) return f;
    const bmp = await fileToBitmap(f); if(!bmp) return f;
    const {w,h}=fit(bmp.width,bmp.height,Config.maxDimension);
    const c=d.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d');
    safe(()=>x.drawImage(bmp,0,0,w,h));
    let q=.85, b=await toBlob(c,'image/jpeg',q); if(!b) return f;
    while(b.size>Config.targetBytes && q>Config.qualityFloor){
      q=Math.max(Config.qualityFloor,q-.1); const nb = await toBlob(c,'image/jpeg',q); if(!nb){ break } b=nb;
    }
    try{ return new File([b], (f.name||'image').replace(/\.[^/.]+$/,'')+'.jpg', {type:'image/jpeg', lastModified: Date.now()}); }catch(e){ return f; }
  }
  function replace(input, files){
    try{ const dt=new DataTransfer(); files.forEach(f=>dt.items.add(f)); input.files=dt.files; }catch(e){ /* keep originals */ }
  }
  async function handle(ev){
    const input = ev && ev.target; if(!input || !input.files || !input.files.length) return;
    if(input.dataset.noCompress!==undefined) return;
    const items=[...input.files]; const out=[];
    for(const it of items){ try{ out.push(await compress(it)) } catch(e){ out.push(it) } }
    replace(input,out);
  }
  function attach(){
    try{
      const explicit=[...d.querySelectorAll('input[type="file"][data-auto-compress]')];
      const nodes = explicit.length?explicit:[...d.querySelectorAll('input[type="file"]')].filter(el=>/photos?/i.test(el.name||'')||/photos?/i.test(el.id||''));
      nodes.forEach(n=>{ n.removeEventListener('change',handle); n.addEventListener('change',handle,{passive:true}); });
    }catch(e){ /* no-op */ }
  }
  if(d.readyState==='loading') d.addEventListener('DOMContentLoaded',attach); else attach();
  w.ImageAutoCompressor={reattach:attach,setOptions:(o)=>Object.assign(Config,o||{})};
})(window,document);
