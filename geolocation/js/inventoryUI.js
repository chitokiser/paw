// /geolocation/js/inventoryUI.js
// 아주 가벼운 HUD + 패널 UI (바닐라 JS + CSS)
export class InventoryUI {
  constructor({ inventory, toast, onUseItem, onDropItem }){
    this.inventory = inventory;
    this.toast = typeof toast === 'function' ? toast : ()=>{};
    this.onUseItem = onUseItem;   // async (id, item) => { ... }
    this.onDropItem = onDropItem; // async (id, item) => { ... }

    this.root = null;
    this.btn = null;
    this.panel = null;
    this.list = null;

    // 헤더에 현재 장착 무기 표시용
    this.headerEquipEl = null;

    // 바깥에서 재사용할 수 있도록 바인딩
    this._handleEquipChanged = (e)=>{
      try {
        const id = e?.detail?.id || this.inventory?.getEquippedWeaponId?.() || 'fist';
        this._updateEquippedHeader(id);
        // 리스트 버튼 상태도 갱신
        this.render(this.inventory.getAll());
      } catch {}
    };
  }

  mount(){
    this._injectCSS();
    this.root = document.createElement('div');
    this.root.className = 'inv-root';
    this.root.innerHTML = `
      <button class="inv-bag" title="Inventory (I)">🎒</button>
      <div class="inv-panel" hidden>
        <div class="inv-header">
          <div class="inv-title">
            Inventory
            <span class="inv-equipped-now"></span>
          </div>
          <button class="inv-close">✕</button>
        </div>
        <div class="inv-list"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.btn = this.root.querySelector('.inv-bag');
    this.panel = this.root.querySelector('.inv-panel');
    this.list = this.root.querySelector('.inv-list');
    this.headerEquipEl = this.root.querySelector('.inv-equipped-now');

    this.btn.addEventListener('click', ()=> this.toggle());
    this.root.querySelector('.inv-close').addEventListener('click', ()=> this.close());
    document.addEventListener('keydown', (e)=>{ if (e.key.toLowerCase()==='i') this.toggle(); });

    // 최초 렌더
    this._updateEquippedHeader(this.inventory?.getEquippedWeaponId?.() || 'fist');
    this.render(this.inventory.getAll());

    // 인벤 변경 시 UI 갱신 (기존 동작 유지)
    this.inventory._onChange = (items)=> this.render(items);

    // 장착 변경 이벤트 구독
    window.addEventListener('equip:changed', this._handleEquipChanged);
  }

  destroy(){
    // 필요시 호출: 이벤트 정리
    window.removeEventListener('equip:changed', this._handleEquipChanged);
    try { this.root?.remove(); } catch {}
  }

  toggle(){ this.panel.hidden = !this.panel.hidden; }
  open(){ this.panel.hidden = false; }
  close(){ this.panel.hidden = true; }

  _updateEquippedHeader(weaponId){
    const label = (weaponId === 'fist') ? '맨손' : weaponId;
    if (this.headerEquipEl){
      this.headerEquipEl.textContent = ` • Equipped: ${label}`;
      this.headerEquipEl.className = `inv-equipped-now ${weaponId==='longsword_iron' ? 'eq-sword' : 'eq-fist'}`;
    }
  }

  render(itemsMap){
    if (!this.list) return;
    const entries = Object.entries(itemsMap || {});
    if (entries.length === 0){
      this.list.innerHTML = `<div class="inv-empty">No items</div>`;
      return;
    }
    const equippedId = this.inventory?.getEquippedWeaponId?.() || 'fist';

    this.list.innerHTML = entries.map(([id, it])=>{
      const qty = Number(it.qty || 0);
      const name = it.name || id;
      const rarity = (it.rarity || 'common').toLowerCase();

      // 무기 아이템일 때(현 단계: 장검만) 장착/해제 버튼 추가
      const isLongsword = (id === 'longsword_iron');
      const isEquipped = (equippedId === 'longsword_iron');

      // 기본 액션 버튼
      let actionsHTML = `
        <button data-act="use" data-id="${id}">Use</button>
        <button data-act="drop" data-id="${id}" class="danger">Drop</button>
      `;

      // 장검이면 장착/해제 UI 추가
      if (isLongsword) {
        actionsHTML = `
          <button data-act="equip" data-id="${id}" ${isEquipped ? 'disabled' : ''}>Equip</button>
          <button data-act="unequip" data-id="${id}" ${!isEquipped ? 'disabled' : ''}>Unequip</button>
          ${actionsHTML}
        `;
      }

      // 장착중인 아이템 행 하이라이트
      const equippedBadge = (isLongsword && isEquipped)
        ? `<span class="eq-badge">Equipped</span>`
        : ``;

      return `
        <div class="inv-row inv-${rarity} ${isLongsword && isEquipped ? 'inv-equipped' : ''}">
          <div class="inv-main">
            <div class="inv-name">${name} ${equippedBadge}</div>
            <div class="inv-meta">
              <span class="inv-rarity badge-${rarity}">${rarity}</span>
              <span class="inv-qty">x${qty}</span>
            </div>
          </div>
          <div class="inv-actions">
            ${actionsHTML}
          </div>
        </div>
      `;
    }).join('');

    // 버튼 바인딩
    this.list.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        const it = (this.inventory.getAll() || {})[id];
        if (!it) return;

        // 장착/해제 우선 처리
        if (act === 'equip' && id === 'longsword_iron') {
          try {
            await this.inventory.equipLongsword({ syncDB: true });
            this.toast?.('장검 장착!');
          } catch(e) {
            console.warn('[equip longsword] failed', e);
          }
          // 장착 상태 UI 갱신
          this._updateEquippedHeader(this.inventory.getEquippedWeaponId?.() || 'fist');
          this.render(this.inventory.getAll());
          return;
        }
        if (act === 'unequip' && id === 'longsword_iron') {
          try {
            await this.inventory.unequipWeapon({ syncDB: true });
            this.toast?.('장비 해제(맨손)');
          } catch(e) {
            console.warn('[unequip weapon] failed', e);
          }
          this._updateEquippedHeader(this.inventory.getEquippedWeaponId?.() || 'fist');
          this.render(this.inventory.getAll());
          return;
        }

        // 기존 Use/Drop 동작
        if (act === 'use' && this.onUseItem){
          await this.onUseItem(id, it);
          return;
        }
        if (act === 'drop' && this.onDropItem){
          await this.onDropItem(id, it);
          return;
        }
      });
    });
  }

  _injectCSS(){
    if (document.getElementById('inv-css')) return;
    const css = document.createElement('style');
    css.id = 'inv-css';
    css.textContent = `
      .inv-root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
      
      .inv-bag { width: 48px; height: 48px; border-radius: 12px; border: none; box-shadow: 0 6px 18px rgba(0,0,0,.15); font-size: 20px; cursor: pointer; background:#111;color:#fff; }
      .inv-panel { position: fixed; right: 16px; bottom: 80px; width: 320px; max-height: 60vh; overflow:auto; background: #171717; color: #eee; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
      .inv-header { display:flex; align-items:center; justify-content:space-between; padding: 12px 14px; border-bottom: 1px solid #2a2a2a; }
      .inv-title { font-weight: 700; display:flex; align-items:center; gap:8px; }
      .inv-equipped-now { font-weight:600; font-size:12px; opacity:.9; }
      .inv-equipped-now.eq-sword { color:#60a5fa; }   /* longsword 장착 시 */
      .inv-equipped-now.eq-fist  { color:#9ca3af; }   /* 맨손 */
      .inv-close { background: transparent; border: none; color: #aaa; font-size: 16px; cursor: pointer; }
      .inv-list { padding: 8px 10px; display:grid; gap:8px; }
      .inv-empty { padding: 16px; color:#aaa; text-align:center; }
      .inv-row { display:flex; align-items:center; justify-content:space-between; gap: 10px; background:#1f1f1f; padding:10px; border-radius:10px; border:1px solid #2a2a2a; }
      .inv-row.inv-equipped { border-color:#2563eb; box-shadow: 0 0 0 1px rgba(37,99,235,.25) inset; }
      .inv-main { display:flex; flex-direction:column; gap:6px; }
      .inv-name { font-weight:600; display:flex; align-items:center; gap:6px; }
      .eq-badge { font-size:11px; background:#1d4ed8; color:#fff; padding:2px 6px; border-radius:6px; }
      .inv-meta { display:flex; gap:8px; align-items:center; color:#bbb; font-size:12px; }
      .badge-common{ color:#cbd5e1; } .badge-uncommon{ color:#22c55e; } .badge-rare{ color:#3b82f6; }
      .badge-epic{ color:#a855f7; } .badge-legendary{ color:#f59e0b; }
      .inv-actions button { background:#2a2a2a; color:#eee; border:none; padding:8px 10px; border-radius:8px; cursor:pointer; }
      .inv-actions button[disabled]{ opacity:.5; cursor:default; }
      .inv-actions button:hover{ background:#333; }
      .inv-actions .danger { background:#7f1d1d; }
      .inv-actions .danger:hover{ background:#991b1b; }
      /* 행 테마(미묘한 테두리) */
      .inv-common{ border-color:#253142; }
      .inv-uncommon{ border-color:#114d2b; }
      .inv-rare{ border-color:#1a2f6d; }
      .inv-epic{ border-color:#3a1e5a; }
      .inv-legendary{ border-color:#6b450f; }
    `;
    document.head.appendChild(css);
  }
}
