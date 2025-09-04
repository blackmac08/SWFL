// assets/form-optimizer.js
// Compresses selected photos client-side before Netlify form submit.
// Safe: only runs if files are selected; otherwise does nothing.
(function () {
  const MAX_DIM = 1600, QUALITY = 0.72;
  const TYPES = ['image/jpeg','image/png','image/webp'];

  function isHeic(f){
    const n=(f.name||'').toLowerCase();
    return f.type==='image/heic'||f.type==='image/heif'||n.endsWith('.heic')||n.endsWith('.heif');
  }
  function readAsImage(file){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>res({img,url});
      img.onerror=(e)=>rej(e);
      img.src=url;
    });
  }
  function fit(w,h,m){
    if(w<=m&&h<=m) return [w,h];
    const s=Math.min(m/w,m/h);
    return [Math.round(w*s),Math.round(h*s)];
  }
  async function compress(file){
    const {img,url}=await readAsImage(file);
    const srcW=img.naturalWidth||img.width, srcH=img.naturalHeight||img.height;
    const [w,h]=fit(srcW,srcH,MAX_DIM);
    const c=document.createElement('canvas');
    c.width=w; c.height=h;
    const ctx=c.getContext('2d');
    ctx.drawImage(img,0,0,w,h);
    URL.revokeObjectURL(url);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',QUALITY));
    const name=(file.name||'photo').replace(/\.[^.]+$/,'');
    return new File([blob], name+'.jpg', {type:'image/jpeg'});
  }
  function busy(form,on,text){
    let el=form.querySelector('.upload-progress');
    if(!el){
      el=document.createElement('div');
      el.className='upload-progress';
      el.style.cssText='margin:.5rem 0;font-size:.9rem;opacity:.9';
      form.appendChild(el);
    }
    el.textContent = on ? (text||'Optimizing photos for faster upload…') : '';
  }

  document.addEventListener('DOMContentLoaded',function(){
    const form=document.querySelector('form#lead-form[data-netlify="true"]');
    const input=form && form.querySelector('input[type="file"][name="photos"]');
    if(!form||!input) return;

    let submitting=false;
    form.addEventListener('submit', async function(e){
      if(submitting) return;
      const files=input.files?Array.from(input.files):[];
      if(!files.length) return; // No photos: let Netlify handle the submit immediately

      // Warn about HEIC (not handled by canvas reliably across browsers)
      for(const f of files){
        if(isHeic(f)){
          e.preventDefault();
          alert('Your photos are HEIC. Please change your iPhone camera format to Most Compatible (JPEG), or upload screenshots / JPG/PNG images.');
          return;
        }
      }

      // Compress then submit
      e.preventDefault();
      busy(form,true,'Optimizing photos for faster upload…');
      try{
        const dt=new DataTransfer();
        for(const f of files){
          let add=f;
          // Convert large or non-JPEG images to a smaller JPEG
          const needs = f.type.startsWith('image/') &&
                        (f.type!=='image/jpeg' || (f.size && f.size > 300*1024));
          if(needs && TYPES.includes(f.type)){
            try { add = await compress(f); } catch(e){ /* fallback: keep original */ }
          }
          dt.items.add(add);
        }
        input.files=dt.files;
        submitting=true;
        busy(form,true,'Uploading optimized photos…');
        form.submit(); // normal submit so Netlify + redirect work
      }catch(err){
        busy(form,false);
        console.error(err);
        alert('Could not optimize photos. Please try smaller images or fewer files, then resubmit.');
      }
    });
  });
})();