/* Local edits of a real exported work, interpolated through the native Canvas API. */
(() => {
  const demo = new URLSearchParams(location.search).get('edit-demo');
  if (!['atelier','sailboat','botanical'].includes(demo)) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let baseline, revision = 0, raf = 0, busy = false, dirty = false, playing = false;
  let manual = false, resetKey = 0, drag = null;
  let previous = 0, transition = null;
  let current = { mix:0, offset:0 };
  let target = { mix:0, offset:0, title:'云上画室', selected:'' };
  const notify = type => parent.postMessage({ type }, '*');
  const mix = (from, to, t) => from + (to - from) * t;
  const color = t => '#' + [mix(210,105,t),mix(63,133,t),mix(43,115,t)].map(n => Math.round(n).toString(16).padStart(2,'0')).join('');
  function schedule() {
    if (raf || busy || !baseline || (!dirty && !(transition && playing))) return;
    raf = requestAnimationFrame(paint);
  }
  async function paint(now) {
    raf = 0;
    if (busy) return;
    busy = true;
    try {
      if (transition && playing) {
        if (previous) transition.elapsed += Math.min(64, now - previous);
        previous = now;
        const t = Math.min(1, transition.elapsed / 1100), eased = t*t*(3-2*t);
        current = { mix:mix(transition.from.mix,target.mix,eased), offset:mix(transition.from.offset,target.offset,eased) };
        if (t === 1) { current = {mix:target.mix,offset:target.offset}; transition = null; }
      }
      dirty = false;
      const sceneId = window.drawyData.sceneId, baseScene = baseline.scenes[sceneId];
      const textWidth = Array.from(target.title).reduce((n,c) => n + (/[^\x00-\x7f]/.test(c) ? 1 : .58),0);
      const scene = { ...baseScene, modules:baseScene.modules.map(module => {
        if (demo === 'sailboat' && module.id === 'sails') return {...module,data:{...module.data,cream:'#'+[mix(255,184,current.mix),mix(250,202,current.mix),mix(234,168,current.mix)].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')}};
        if (demo === 'botanical' && ['pot','citrus'].includes(module.id)) return {...module,bounds:{...module.bounds,x:module.bounds.x-current.offset*.45}};
        if (module.id === 'roof') return {...module,data:{...module.data,color:color(current.mix)}};
        if (module.id === 'balloon') return {...module,bounds:{...module.bounds,x:module.bounds.x-current.offset,y:module.bounds.y-current.offset*.35}};
        if (module.id === 'sign') return {...module,data:{...module.data,text:target.title,size:Math.min(28,136/Math.max(1,textWidth))}};
        return module;
      }) };
      const work = {...baseline,revision:baseline.revision + ++revision,scenes:{...baseline.scenes,[sceneId]:scene}};
      const view = window.drawyView;
      view.update(work,scene,true);
      await view.drawn(demo==='atelier'?['sign','roof','balloon']:demo==='sailboat'?['sails']:['pot','citrus'],work.revision);
      view.setEditing(true);
      view.setMovable(false);
      view.select(target.selected ? [target.selected] : []);
      document.documentElement.dataset.editRevision = String(revision);
      document.documentElement.dataset.editTransition = String(!!transition);
      if (!transition && !dirty) notify('drawy:edit-applied');
    } catch(error) {
      window.drawyErrors.push(String(error));
      transition = null;
      dirty = false;
    } finally {
      busy = false;
      schedule();
    }
  }
  function finish() {
    transition = null;
    current = {mix:target.mix,offset:target.offset};
    dirty = true;
    previous = 0;
    schedule();
  }
  addEventListener('message',event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'drawy:showcase-play') {
      playing = event.data.playing === true;
      previous = 0;
      // Stop the interpolation clock as well as the exported work's own animation.
      if (!playing && raf) { cancelAnimationFrame(raf); raf = 0; }
      schedule();
      return;
    }
    if (event.data?.type !== 'drawy:edit-demo') return;
    const value = event.data;
    if (demo !== "atelier") {
      if (value.resetKey !== resetKey) { manual = false; resetKey = value.resetKey; }
      if (manual) return;
    }
    if (typeof value.title !== 'string' || typeof value.recolored !== 'boolean' || !Number.isFinite(value.offset)) return;
    const next = { title:value.title.slice(0,12),mix:value.recolored ? 1 : 0,offset:Math.max(0,Math.min(72,value.offset)),selected:['sign','roof','balloon','sails','pot','citrus'].includes(value.selected) ? value.selected : '' };
    const moved = next.mix !== target.mix || next.offset !== target.offset;
    target = next;
    dirty = true;
    if (reduced.matches || !playing) finish();
    else if (moved) {
      // Retarget from the last painted state: rapid scrubbing and reversals never jump.
      transition = {from:{...current},elapsed:0};
      previous = 0;
    }
    schedule();
  });
  reduced.addEventListener('change',() => { if (reduced.matches) finish(); });

  function edit(next, direct = false) {
    manual = true;
    notify('drawy:showcase-explore');
    target = {...target,...next};
    dirty = true;
    if (direct || reduced.matches || !playing) finish();
    else { transition = {from:{...current},elapsed:0}; previous=0; schedule(); }
  }
  const hit = event => {
    const direct=event.composedPath().find(node => node instanceof Element && node.hasAttribute('data-module-id'));
    if(direct) return direct;
    const node=document.querySelector('[data-module-id="'+(demo==='sailboat'?'sails':'pot')+'"]');
    const rect=node?.getBoundingClientRect();
    if(rect && event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom) return node;
  };
  addEventListener('pointerdown', event => {
    if (demo === 'atelier' || !baseline || event.button !== 0) return;
    const node=hit(event), id=node?.getAttribute('data-module-id');
    if (demo==='sailboat' && id==='sails') {
      event.preventDefault(); event.stopImmediatePropagation();
      edit({mix:target.mix ? 0 : 1,selected:'sails'});
    } else if (demo==='botanical' && id==='pot') {
      event.preventDefault(); event.stopImmediatePropagation();
      // Follow the finger in scene coordinates; update the pot and tree together.
      const base=baseline.scenes[window.drawyData.sceneId].modules.find(m=>m.id==='pot');
      drag={id:event.pointerId,x:event.clientX,offset:current.offset,scale:node.getBoundingClientRect().width/base.bounds.width};
      document.body.setPointerCapture(event.pointerId);
      edit({offset:current.offset,selected:'pot'},true);
    }
  },true);
  addEventListener('pointermove',event=>{
    if (!drag || event.pointerId!==drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    edit({offset:Math.max(-40,Math.min(72,drag.offset-(event.clientX-drag.x)/drag.scale/.45)),selected:'pot'},true);
  },true);
  for (const type of ['pointerup','pointercancel','lostpointercapture']) addEventListener(type,event=>{
    if (!drag || event.pointerId!==drag.id) return;
    drag=null;
    if(document.body.hasPointerCapture(event.pointerId)) document.body.releasePointerCapture(event.pointerId);
  },true);
  addEventListener('keydown',event=>{
    const id=hit(event)?.getAttribute('data-module-id');
    if (demo==='sailboat' && id==='sails' && ['Enter',' '].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();edit({mix:target.mix?0:1,selected:'sails'});
    } else if(demo==='botanical' && id==='pot' && ['ArrowLeft','ArrowRight','Home'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();
      edit({offset:event.key==='Home'?0:Math.max(-40,Math.min(72,target.offset+(event.key==='ArrowLeft'?12:-12))),selected:'pot'});
    }
  },true);

  function ready() {
    if (!window.drawyReady || !window.drawyShowcase.frame) return requestAnimationFrame(ready);
    baseline = structuredClone(window.drawyData.work);
    const boxes = baseline.scenes[window.drawyData.sceneId].modules.filter(m => m.id !== 'paper').map(m => m.bounds);
    const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y))-26;
    window.drawyShowcase.bounds = {x:left,y:top,width:Math.max(...boxes.map(b => b.x+b.width))-left,height:Math.max(...boxes.map(b => b.y+b.height))-top};
    window.drawyShowcase.frame();
    if (demo !== 'atelier') {
      for (const module of document.querySelectorAll('[data-module-id]')) module.style.pointerEvents = module.dataset.moduleId === (demo === 'sailboat' ? 'sails' : 'pot') ? 'auto' : 'none';
      const node=document.querySelector('[data-module-id="'+(demo==='sailboat'?'sails':'pot')+'"]');
      if(node){node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',demo==='sailboat'?'Change sail color':'Move flowerpot');node.style.cursor=demo==='sailboat'?'pointer':'grab';node.style.touchAction=demo==='sailboat'?'manipulation':'none';}
    }
    notify('drawy:edit-ready');
    schedule();
  }
  requestAnimationFrame(ready);
})();
