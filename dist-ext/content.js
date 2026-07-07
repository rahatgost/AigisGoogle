var e=/(^|[_-])(otp|totp|mfa|2fa|code|passcode|token)([_-]|$)/i,t=new Set([`text`,`tel`,`number`,`password`]);function n(n){if(n.dataset.aegisAttached===`1`||n.type&&!t.has(n.type.toLowerCase()))return!1;if((n.autocomplete||``).toLowerCase()===`one-time-code`)return!0;let r=n.maxLength,i=e.test(n.name||``)||e.test(n.id||``),a=n.getAttribute(`inputmode`)===`numeric`||n.pattern.includes(`\\d`);return!!(i&&(r===-1||r>=4&&r<=10)||a&&r>=4&&r<=10)}var r=`
:host { all: initial; }
.host {
  position: absolute; z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: #1f1d1a;
}
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: #f7f4ed; border: 1px solid #d9d5c8;
  font-size: 11px; font-weight: 500; letter-spacing: 0.2px;
  cursor: pointer; user-select: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background 120ms ease;
}
.chip:hover { background: #efeadd; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #3c8c5a; }
.dot.locked { background: #b47a2d; }
.picker {
  margin-top: 6px; min-width: 240px; max-width: 320px;
  background: #f7f4ed; border: 1px solid #d9d5c8; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
  padding: 6px; display: none;
}
.picker.open { display: block; }
.row {
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.row:hover { background: #efeadd; }
.issuer { font-size: 13px; font-weight: 500; }
.label { font-size: 11.5px; color: #6b6862; }
.act { font-size: 11px; color: #6b6862; }
.empty { padding: 10px; font-size: 12px; color: #6b6862; text-align: center; }
`,i=class{el;shadow;chip;picker;target;lastRect=null;ro;constructor(e){this.target=e,e.dataset.aegisAttached=`1`,this.el=document.createElement(`div`),this.el.setAttribute(`data-aegis`,``),this.shadow=this.el.attachShadow({mode:`closed`});let t=document.createElement(`style`);t.textContent=r,this.shadow.appendChild(t);let n=document.createElement(`div`);n.className=`host`,this.chip=document.createElement(`div`),this.chip.className=`chip`,this.chip.innerHTML=`<span class="dot"></span><span>Aegis</span>`,this.chip.addEventListener(`click`,e=>{e.preventDefault(),e.stopPropagation(),this.togglePicker()}),this.picker=document.createElement(`div`),this.picker.className=`picker`,n.appendChild(this.chip),n.appendChild(this.picker),this.shadow.appendChild(n),document.body.appendChild(this.el),this.reposition(),window.addEventListener(`scroll`,this.reposition,{passive:!0,capture:!0}),window.addEventListener(`resize`,this.reposition,{passive:!0}),`ResizeObserver`in window&&(this.ro=new ResizeObserver(()=>this.reposition()),this.ro.observe(document.documentElement)),document.addEventListener(`mousedown`,e=>{this.el.contains(e.target)||this.closePicker()})}reposition=()=>{let e=this.target.getBoundingClientRect();this.lastRect=e;let t=e.top+window.scrollY,n=e.right+window.scrollX+6,r=this.shadow.querySelector(`.host`);r.style.top=`${t}px`,r.style.left=`${n}px`};async togglePicker(){if(this.picker.classList.contains(`open`)){this.closePicker();return}this.picker.classList.add(`open`),this.picker.innerHTML=`<div class="empty">Loading…</div>`;let e=window.location.hostname,t=await c({type:`MATCH_HOST`,host:e});if(!t.ok){let e=t.error;this.picker.innerHTML=e===`locked`?`<div class="empty">Aegis is locked — open the popup to sync.</div>`:`<div class="empty">Couldn't reach Aegis (${e}).</div>`,this.shadow.querySelector(`.dot`).classList.toggle(`locked`,e===`locked`);return}let n=t.matches??[];if(n.length===0){this.picker.innerHTML=`<div class="empty">No matching accounts for this site.</div>`;return}this.picker.innerHTML=``;for(let e of n){let t=document.createElement(`div`);t.className=`row`,t.innerHTML=`
        <div>
          <div class="issuer"></div>
          <div class="label"></div>
        </div>
        <div class="act">Fill</div>
      `,t.querySelector(`.issuer`).textContent=e.issuer,t.querySelector(`.label`).textContent=e.label||``,t.addEventListener(`click`,async t=>{t.preventDefault(),t.stopPropagation(),await this.fill(e.id)}),t.addEventListener(`contextmenu`,async t=>{t.preventDefault(),await this.copy(e.id)}),this.picker.appendChild(t)}let r=document.createElement(`div`);r.className=`empty`,r.textContent=`Right-click a row to copy instead.`,this.picker.appendChild(r)}closePicker(){this.picker.classList.remove(`open`)}async fill(e){a(`fill: request`,{accountId:e,host:window.location.hostname});let t=await c({type:`GET_CODE`,accountId:e});if(!t.ok){a(`fill: SW error`,t.error),this.picker.innerHTML=`<div class="empty">Couldn't generate code (${t.error}).</div>`;return}let n=t.code,r=t.period;a(`fill: SW ok`,{codeLen:n.length,codeShape:/^\d+$/.test(n)?`numeric`:`alphanum`,period:r,target:o(this.target)}),s(this.target,n);let i=this.target.value;a(`fill: applied`,{matches:i===n,afterLen:i.length}),this.closePicker()}async copy(e){a(`copy: request`,{accountId:e});let t=await c({type:`GET_CODE`,accountId:e});if(!t.ok){a(`copy: SW error`,t.error);return}let n=t.code;try{await navigator.clipboard.writeText(n),a(`copy: clipboard ok`,{codeLen:n.length}),await c({type:`CLIPBOARD_ARMED`,tabId:0,accountId:e})}catch(e){a(`copy: clipboard refused`,e)}this.closePicker()}};function a(...e){console.log(`[aegis-cs]`,...e)}function o(e){return{name:e.name||void 0,id:e.id||void 0,type:e.type,autocomplete:e.autocomplete||void 0,maxLength:e.maxLength,inputmode:e.getAttribute(`inputmode`)||void 0,pattern:e.pattern||void 0}}function s(e,t){let n=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),`value`)?.set;n?n.call(e,t):e.value=t,e.dispatchEvent(new Event(`input`,{bubbles:!0})),e.dispatchEvent(new Event(`change`,{bubbles:!0}))}function c(e){return new Promise(t=>{try{chrome.runtime.sendMessage(e,e=>{if(chrome.runtime.lastError){t({ok:!1,error:chrome.runtime.lastError.message??`runtime_error`});return}t(e??{ok:!1,error:`no_response`})})}catch(e){t({ok:!1,error:e instanceof Error?e.message:`send_failed`})}})}function l(e=document){e.querySelectorAll(`input`).forEach(e=>{n(e)&&new i(e)})}chrome.runtime.onMessage.addListener(e=>{e.type===`CLEAR_CLIPBOARD`&&navigator.clipboard.writeText(``).catch(()=>{})}),l(),new MutationObserver(e=>{for(let t of e)t.addedNodes.forEach(e=>{e instanceof HTMLElement&&l(e)})}).observe(document.documentElement,{childList:!0,subtree:!0});