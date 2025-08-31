function $(s, el=document){ return el.querySelector(s); }

function loadState(){
  try{ return JSON.parse(localStorage.getItem('autoblog_state')||'{}'); }catch(e){ return {}; }
}
function saveState(st){ localStorage.setItem('autoblog_state', JSON.stringify(st)); }

function login(e){
  e.preventDefault();
  const pass = $('#adminPass').value.trim();
  const ok = localStorage.getItem('admin_pass') || '1234';
  if(pass === ok){
    sessionStorage.setItem('is_admin','1');
    render();
  }else alert('비밀번호가 틀렸습니다');
}
function logout(){
  sessionStorage.removeItem('is_admin'); render();
}

function approve(subId){
  const st = loadState();
  const sub = (st.submissions||[]).find(s=>s.id===subId);
  if(!sub){ alert('제출을 찾지 못했습니다'); return; }
  const task = (st.tasks||[]).find(t=>t.id===sub.taskId);
  const user = (st.users||{})[sub.addr] || { level:1, points:0 };
  const input = prompt('지급할 점수(기본 10)', '10');
  const amt = parseInt(input||'10',10)||10;
  user.points += amt;
  st.users[sub.addr] = user;
  task.status = 'approved';
  st.pointTx = st.pointTx || [];
  st.pointTx.push({ id: Date.now(), addr: sub.addr, taskId: task.id, amount: amt, reason: 'post approved', when: new Date().toISOString() });
  saveState(st);
  render();
}

function render(){
  const isAdmin = sessionStorage.getItem('is_admin')==='1';
  $('#loginWrap').style.display = isAdmin ? 'none' : 'block';
  $('#panel').style.display = isAdmin ? 'block' : 'none';
  if(!isAdmin) return;

  const st = loadState();
  const subs = (st.submissions||[]).slice().sort((a,b)=>b.id-a.id);
  const tbody = $('#subs');
  tbody.innerHTML = subs.map(s=>`
    <tr>
      <td>${s.id}</td>
      <td>${s.taskId}</td>
      <td>${s.addr.slice(0,6)}…${s.addr.slice(-4)}</td>
      <td>${s.url ? `<a href="${s.url}" target="_blank">열기</a>` : '-'}</td>
      <td>${s.ok ? 'OK' : 'X'}</td>
      <td><button onclick="approve(${s.id})">승인</button></td>
    </tr>
  `).join('');

  const users = st.users||{};
  const ul = $('#users');
  ul.innerHTML = Object.entries(users).map(([addr,u])=>`<li>${addr.slice(0,6)}…${addr.slice(-4)} — Level ${u.level} · Points ${u.points}</li>`).join('');
}

window.approve = approve;
window.addEventListener('DOMContentLoaded', ()=>{
  $('#loginForm')?.addEventListener('submit', login);
  $('#btnLogout')?.addEventListener('click', logout);
  render();
});
