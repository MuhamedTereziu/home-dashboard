// public/js/main.js
const routerHost = (location.hostname || '192.168.88.1');
document.getElementById('router-link').href = `http://${routerHost}/webfig/`;
document.getElementById('year').textContent = new Date().getFullYear();

async function updateSystemInfo(){
  try{
    const b=await fetch('/api/battery').then(r=>r.json());
    const pct=Math.max(0,Math.min(100,b.percentage ?? b.level ?? 0));
    document.getElementById('battery-percent').textContent=pct+'%';
    document.getElementById('charging-status').textContent=(b.status==='CHARGING'||b.plugged)?'⚡ Charging':'On Battery';
    document.getElementById('bat-temp').textContent=b.temperature ?? '—';
  }catch{}
}
setInterval(updateSystemInfo,5000); window.addEventListener('DOMContentLoaded',updateSystemInfo);

async function refreshSystem(){
  try{
    const s=await fetch('/api/system').then(r=>r.json());
    document.getElementById('sys-uptime').textContent=s.uptime||'—';
    document.getElementById('sys-load').textContent=(s.loadavg||[]).join(', ')||'—';
    if(s.mem){
      const used=Math.max(0,(s.mem.total-s.mem.free-(s.mem.buffers||0)-(s.mem.cached||0)));
      document.getElementById('sys-ram').textContent=`${(used/1024).toFixed(0)} / ${(s.mem.total/1024).toFixed(0)} MB`;
    }
    const cpu=Array.isArray(s.thermal)&&s.thermal.length?s.thermal[0].temperature:null;
    document.getElementById('sys-cpu').textContent=cpu ?? '—';
  }catch{}
}
setInterval(refreshSystem,8000); window.addEventListener('DOMContentLoaded',refreshSystem);

// Weather
async function geocodeCity(name){const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);const j=await r.json();if(!j.results||!j.results.length)throw new Error('City not found');const c=j.results[0];return {name:c.name,country:c.country,lat:c.latitude,lon:c.longitude};}
async function getWeather(lat,lon){const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);const j=await r.json();return j.current_weather;}
async function fetchWeather(){const name=(document.getElementById('city-input').value||'Tirana').trim();const status=document.getElementById('status-line');status.textContent=`Fetching weather for ${name}…`;try{const g=await geocodeCity(name);const wx=await getWeather(g.lat,g.lon);document.getElementById('wx-city').textContent=`${g.name}, ${g.country}`;document.getElementById('wx-temp').textContent=wx.temperature;document.getElementById('wx-wind').textContent=wx.windspeed;document.getElementById('wx-code').textContent=wx.weathercode;status.textContent=`Updated weather for ${g.name}.`;}catch{status.textContent='Weather update failed.';}}
window.addEventListener('DOMContentLoaded',fetchWeather);

// LAN
async function refreshLAN(){
  const badge=document.getElementById('lan-badge');
  const body=document.querySelector('#lan-table tbody');
  try{
    const data=await fetch('/api/lan').then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
    badge.style.display='none';
    body.innerHTML='';
    (data||[]).forEach(d=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${d.ip||''}</td><td>${d.mac||''}</td><td>${d.hostname||''}</td><td>${d.status||''}</td>`;
      body.appendChild(tr);
    });
    if(!data || !data.length){
      const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="4" class="sub">No leases returned.</td>`; body.appendChild(tr);
    }
  }catch(e){
    badge.textContent='Router offline';
    badge.className='badge bad';
    badge.style.display='inline-block';
    body.innerHTML=`<tr><td colspan="4" class="sub">Could not fetch leases (see server log).</td></tr>`;
  }
}
setInterval(refreshLAN,15000); window.addEventListener('DOMContentLoaded',refreshLAN);

// Tunnel
async function refreshTunnel(){try{const t=await fetch('/api/tunnel').then(r=>r.json());document.getElementById('tun-status').textContent=t.status||'—';}catch{}}
setInterval(refreshTunnel,8000); window.addEventListener('DOMContentLoaded',refreshTunnel);
async function runCmd(cmd){
  const out=document.getElementById('cmd-output'); out.textContent='Running…';
  try{const r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})}).then(r=>r.json());
    out.textContent=(r.stdout||r.stderr||JSON.stringify(r)); refreshTunnel();
  }catch{out.textContent='Command failed';}
}
window.runCmd = runCmd;
window.fetchWeather = fetchWeather;
