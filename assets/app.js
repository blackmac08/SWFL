// UX helpers for preview + VIN autofill + min photo count
(function(){
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const photosInput = document.getElementById('photos');
  const preview = document.getElementById('photo-preview');

  if (photosInput && preview){
    photosInput.addEventListener('change', () => {
      preview.innerHTML = '';
      const files = Array.from(photosInput.files || []);
      const maxFiles = 20, maxEach = 8, maxTotal = 100; // MB

      let total = 0;
      for (const f of files){ total += f.size/1024/1024; }
      if (files.length > maxFiles){ alert(`Please upload ${maxFiles} photos or fewer.`); photosInput.value=''; return; }
      if (files.some(f => (f.size/1024/1024) > maxEach)){ alert(`One or more images exceed ${maxEach} MB.`); photosInput.value=''; return; }
      if (total > maxTotal){ alert(`Total photo size exceeds ${maxTotal} MB.`); photosInput.value=''; return; }

      files.forEach(file => {
        const img = document.createElement('img');
        img.alt = file.name; img.loading='lazy';
        preview.appendChild(img);
        const reader = new FileReader();
        reader.onload = e => img.src = e.target.result;
        reader.readAsDataURL(file);
      });
    });
  }

  async function decodeVIN(vin){
    try{
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
      const data = await res.json();
      return data && data.Results && data.Results[0];
    }catch(e){ return null; }
  }

  const vinInput = document.getElementById('vin');
  if (vinInput){
    vinInput.addEventListener('change', async () => {
      const vin = vinInput.value.trim();
      if (vin.length >= 11){
        const r = await decodeVIN(vin);
        if (r){
          const year = document.querySelector('input[name=year]');
          const make = document.querySelector('input[name=make]');
          const model = document.querySelector('input[name=model]');
          const trim = document.querySelector('input[name=trim]');
          if (r.ModelYear && year && !year.value) year.value = r.ModelYear;
          if (r.Make && make && !make.value) make.value = r.Make;
          if (r.Model && model && !model.value) model.value = r.Model;
          if (r.Series && trim && !trim.value) trim.value = r.Series;
        }
      }
    });
  }

  // Removed min-6 photo validation block
    });
  }
})();