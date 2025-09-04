
/*! vin-decode.js — fills Year/Make/Model from VIN via NHTSA */
(function(){
  const vinEl = document.getElementById('vin');
  if(!vinEl) return;
  const yearEl = document.querySelector('input[name="year"]');
  const makeEl = document.querySelector('input[name="make"]');
  const modelEl = document.querySelector('input[name="model"]');
  async function decode(vin){
    if(!vin || vin.replace(/\W/g,'').length < 11) return;
    try{
      const url = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(vin)+'?format=json';
      const res = await fetch(url, {mode:'cors'});
      const data = await res.json();
      const row = data && data.Results && data.Results[0] ? data.Results[0] : {};
      if(yearEl && row.ModelYear) yearEl.value = row.ModelYear;
      if(makeEl && row.Make) makeEl.value = row.Make;
      if(modelEl && row.Model) modelEl.value = row.Model;
    }catch(e){ /* silent */ }
  }
  vinEl.addEventListener('blur', ()=>decode(vinEl.value.trim()));
  vinEl.addEventListener('change', ()=>decode(vinEl.value.trim()));
})();
