export async function connectWallet(){
  const btn = document.querySelector('#btnConnect');
  if(!window.ethereum){ alert('MetaMask/Rabby not found'); return; }
  const [addr] = await window.ethereum.request({ method:'eth_requestAccounts' });
  localStorage.setItem('wallet', addr);
  btn.textContent = 'Connected: ' + addr.slice(0,6) + '...' + addr.slice(-4);

  const nonce = 'AutoBlog Login ' + Math.random().toString(16).slice(2);
  const signature = await window.ethereum.request({
    method:'personal_sign', params:[ nonce, addr ]
  });
  localStorage.setItem('wallet_signature', signature);
  document.dispatchEvent(new CustomEvent('wallet:connected', { detail: { addr, signature } }));
}

export function currentWallet(){
  return localStorage.getItem('wallet') || '';
}
