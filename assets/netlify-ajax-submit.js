
/*! netlify-ajax-submit.js — reliable uploads with reCAPTCHA */
(function(){
  const form = document.getElementById('lead-form') || document.querySelector('form[data-netlify][name="cash-for-cars"]');
  if(!form) return;

  const photosInput = document.getElementById('photos');

  async function canvasCompress(file, maxDim=1600, target=300*1024, qFloor=0.5){
    if(!file || !/^image\//i.test(file.type) || file.size <= target) return file;
    let bmp;
    try{ bmp = await createImageBitmap(file); }catch(e){
      const url = URL.createObjectURL(file);
      const img = await new Promise((res,rej)=>{
        const im = new Image();
        im.onload = ()=>{URL.revokeObjectURL(url); res(im)};
        im.onerror = e=>{URL.revokeObjectURL(url); res(null)};
        im.src = url;
      });
      bmp = img;
    }
    if(!bmp) return file;
    const w0 = bmp.width, h0 = bmp.height;
    const scale = (w0 > h0) ? Math.min(1, maxDim / w0) : Math.min(1, maxDim / h0);
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    try { ctx.drawImage(bmp, 0, 0, w, h); } catch(e){ return file; }
    let q = 0.85;
    let blob = await new Promise(r=>canvas.toBlob(b=>r(b||null), 'image/jpeg', q));
    if(!blob) return file;
    while(blob.size > target && q > qFloor){
      q = Math.max(qFloor, q - 0.1);
      const nb = await new Promise(r=>canvas.toBlob(b=>r(b||null), 'image/jpeg', q));
      if(!nb) break;
      blob = nb;
    }
    try {
      const name = (file.name || 'image').replace(/\.[^/.]+$/,'') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } catch(e){ return file; }
  }

  async function buildCompressedFormData(form){
    const fd = new FormData();
    // Copy regular fields first
    Array.from(form.elements).forEach(el => {
      if(!el.name || el.disabled) return;
      if(el.type === 'file') return; // handle below
      if((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      if(el.tagName === 'SELECT' && el.multiple){
        Array.from(el.selectedOptions).forEach(o=>fd.append(el.name, o.value));
      }else{
        fd.append(el.name, el.value);
      }
    });
    // Include the recaptcha token if present (Netlify injects it)
    const rc = form.querySelector('textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]');
    if(rc && rc.value) fd.append('g-recaptcha-response', rc.value);

    // Files
    const fileInputs = form.querySelectorAll('input[type="file"]');
    for(const input of fileInputs){
      const name = input.name || 'files';
      for(const f of Array.from(input.files || [])){
        const out = /^image\//i.test(f.type) ? await canvasCompress(f) : f;
        fd.append(name, out, out.name);
      }
    }
    return fd;
  }

  async function onSubmit(ev){
    ev.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const prev = submitBtn ? submitBtn.textContent : null;
    if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

    try{
      const fd = await buildCompressedFormData(form);
      // Ensure form-name is present for Netlify
      if(!fd.has('form-name')){
        const fn = form.getAttribute('name') || 'cash-for-cars';
        fd.append('form-name', fn);
      }
      const action = form.getAttribute('action') || '/thank-you.html';
      // Netlify accepts POST to current path or '/'
      const res = await fetch('/', { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
      if(!res.ok){ throw new Error('Upload failed: ' + res.status); }
      window.location.href = action;
    }catch(e){
      console.error(e);
      alert('Sorry — there was a problem submitting. Please try again.');
    }finally{
      if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prev || 'Submit'; }
    }
  }

  form.addEventListener('submit', onSubmit);
})();
