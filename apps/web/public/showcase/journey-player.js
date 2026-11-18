/* Reenacts the real work's SVG paths; the artwork and native detail content stay intact. */
(() => {
  const inkStart = 3800,
    inkDuration = 8000;
  const stage = document.getElementById("stage");
  // The generated scene includes an empty strip above the clouds. Frame the actual
  // landscape, keeping the mountain, all five labels and the groundwater section.
  window.drawyShowcase.bounds = { x: 8, y: 60, width: 1184, height: 692 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (n) => Math.max(0, Math.min(1, n));
  let clock = { elapsed: 0, playing: false, stamp: performance.now() };
  let raf = 0,
    ink = [],
    prepared = false,
    finished = false;
  stage.style.opacity = "0";

  function animation(el, frames, duration, delay = 0) {
    const a = el.animate(frames, {
      duration,
      delay,
      fill: "both",
      easing: "cubic-bezier(.3,.1,.3,1)",
    });
    a.id = "drawy-journey-ink";
    a.pause();
    a.currentTime = 0;
    ink.push(a);
  }
  function prepareInk() {
    ink.forEach((a) => a.cancel());
    ink = [];
    const plans = [];
    for (const host of document.querySelectorAll("[data-module-id]")) {
      if (host.dataset.moduleId === "paper" || !host.shadowRoot) continue;
      const lines = [],
        washes = [],
        words = [];
      for (const el of host.shadowRoot.querySelectorAll("*")) {
        if (el.closest("defs,marker,clipPath,mask,pattern,symbol,style,[data-journey-tour]"))
          continue;
        const css = getComputedStyle(el);
        if (el instanceof SVGGeometryElement) {
          const filled =
            css.fill !== "none" && !/rgba\(.*,\s*0\)$/.test(css.fill);
          const stroked =
            css.stroke !== "none" && parseFloat(css.strokeWidth) > 0;
          const length = el.getTotalLength();
          if (stroked && css.strokeDasharray === "none" && length > 0) {
            const matrix = el.getScreenCTM();
            const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
            lines.push({
              el,
              length: Number(el.getAttribute("pathLength")) || length,
              duration: Math.min(650, Math.max(90, (length * scale) / 1.3)),
              opacity: css.strokeOpacity,
              fill: filled ? css.fillOpacity : null,
            });
          } else if (stroked || filled)
            washes.push({ el, opacity: css.opacity });
        } else if (
          el instanceof SVGTextElement ||
          (el instanceof HTMLElement &&
            [...el.childNodes].some(
              (n) => n.nodeType === 3 && n.textContent.trim(),
            ))
        ) {
          words.push({ el, opacity: css.opacity });
        }
      }
      plans.push({
        host,
        lines,
        washes,
        words,
        time: Math.max(
          550,
          lines.reduce((n, l) => n + l.duration, 0),
        ),
      });
    }
    let end = 0;
    for (const p of plans) {
      p.start = end;
      end += p.time * 0.62;
    }
    end = Math.max(...plans.map((p) => p.start + p.time), 1);
    const pace = 6200 / end;
    plans.forEach((p, index) => {
      const start = p.start * pace;
      animation(p.host, [{ opacity: 0 }, { opacity: 1 }], 120, start);
      let at = start;
      for (const line of p.lines) {
        animation(
          line.el,
          [
            {
              strokeDasharray: `${line.length} ${line.length}`,
              strokeDashoffset: line.length,
              strokeOpacity: 0,
            },
            { strokeOpacity: line.opacity, offset: 0.04 },
            {
              strokeDasharray: `${line.length} ${line.length}`,
              strokeDashoffset: 0,
              strokeOpacity: line.opacity,
            },
          ],
          Math.max(90, line.duration * pace),
          at,
        );
        if (line.fill !== null)
          animation(
            line.el,
            [{ fillOpacity: 0 }, { fillOpacity: line.fill }],
            750,
            Math.max(at, 4300 + 700 * index / Math.max(1, plans.length - 1)),
          );
        at += line.duration * pace;
      }
      p.washes.forEach((w, i) =>
        animation(
          w.el,
          [{ opacity: 0 }, { opacity: w.opacity }],
          850,
          Math.max(start, 4500 + 500 * index / Math.max(1, plans.length - 1) + 1200 * i / Math.max(1, p.washes.length - 1)),
        ),
      );
      p.words.forEach((w, i) =>
        animation(
          w.el,
          [
            { opacity: 0, clipPath: "inset(-15% 100% -15% -15%)" },
            { opacity: w.opacity, clipPath: "inset(-15% -15% -15% -15%)" },
          ],
          650,
          Math.max(start, 5700 + 900 * i / Math.max(1, p.words.length - 1)),
        ),
      );
    });
    prepared = true;
    finished = false;
  }
  function renderInk() {
    if (!window.drawyReady && !prepared) return;
    const time =
      clock.elapsed +
      (clock.playing ? Math.max(0, performance.now() - clock.stamp) : 0);
    const progress = reduced.matches
      ? 1
      : clamp((time - inkStart) / inkDuration);
    document.documentElement.dataset.inkProgress = progress.toFixed(3);
    if (progress === 1) {
      if (!finished) {
        ink.forEach((a) => a.cancel());
        ink = [];
        finished = true;
      }
    } else {
      if (!prepared || finished) prepareInk();
      for (const a of ink) {
        a.pause();
        a.currentTime = progress * inkDuration;
      }
    }
    stage.style.opacity = "1";
  }
  // Follow the actual generated paths; no second illustration or invented route.
  const tour = [];
  const stops = ['vapour-route', 'wind-route', 'rain-route', 'river-route'];
  function prepareTour() {
    if (tour.length) return;
    for (const id of stops) {
      const path = [...document.querySelectorAll('[data-module-id]')]
        .map(host => host.shadowRoot?.getElementById(id)).find(Boolean);
      if (!path) return;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.dataset.journeyTour = id;
      group.style.pointerEvents = 'none';
      group.innerHTML = '<path fill="none" stroke="#2a56c6" stroke-width="3" stroke-linecap="round"/><circle r="16" fill="#2a56c6" opacity=".09"/><circle r="7" fill="white" stroke="#2a56c6" stroke-width="2"/><circle r="2.5" fill="#2a56c6"/>';
      const trace = group.firstElementChild;
      trace.setAttribute('d',path.getAttribute('d'));
      path.ownerSVGElement.append(group);
      tour.push({path,group,trace,length:path.getTotalLength()});
    }
  }
  function renderTour() {
    const time=clock.elapsed+(clock.playing ? performance.now()-clock.stamp : 0);
    const showing=time>=11800 && time<18800 && !reduced.matches;
    if(showing) prepareTour();
    const part=clamp((time-11800)/7000)*4;
    const selected=Math.min(3,Math.floor(part)), progress=part-selected;
    document.documentElement.dataset.tour=showing ? stops[selected] : '';
    tour.forEach((track,index)=>{
      const visible=showing && index===selected;
      track.group.style.opacity=visible ? String(Math.min(1,progress*10,(1-progress)*10)) : '0';
      if(!visible) return;
      const point=track.path.getPointAtLength(progress*track.length);
      track.trace.setAttribute('stroke-dasharray',`${Math.min(80,track.length*.3)} ${track.length}`);
      track.trace.setAttribute('stroke-dashoffset',String(-Math.max(0,progress*track.length-60)));
      for(const dot of track.group.querySelectorAll('circle')) {
        dot.setAttribute('cx',point.x); dot.setAttribute('cy',point.y);
      }
    });
    // A restrained push-in, held when paused and disabled for reduced motion.
    const push=showing ? Math.sin(clamp((time-11800)/7000)*Math.PI)*.018 : 0;
    stage.style.scale=String(1+push);
    stage.style.translate=showing ? `${Math.sin(part*Math.PI/2)*-5}px 0` : '0 0';
  }
  function tick() {
    raf = 0;
    renderInk();
    renderTour();
    if (clock.playing) raf = requestAnimationFrame(tick);
  }


  const current = () => document.querySelector('[data-drawy-detail]');
  const transitions = new Map();
  let wanted = false, manual = false, stacked = innerWidth <= 1000, artHeight = innerHeight;
  const narrow = () => stacked;
  const presentation = document.createElement('style');
  presentation.textContent = '#stage{transform-origin:left center} #stage [data-module-id="landscape"]{filter:drop-shadow(0 12px 9px #161a2209)} [data-drawy-detail]{position:fixed!important;inset:50% 8px auto auto!important;translate:0 -50%;width:clamp(272px,26vw,320px)!important;height:auto!important;max-height:calc(100% - 36px)!important;box-sizing:border-box!important;padding:16px!important;overflow:hidden!important;border:1px solid #c7cdd7;border-top:2px solid #2a56c6;border-radius:10px;background:#fff!important;box-shadow:0 12px 28px #161a2210} #journey-focus{position:fixed;border:1.5px solid #2a56c6;border-radius:50%;transform:rotate(-7deg);box-shadow:0 0 0 5px #2a56c608;pointer-events:none;z-index:8;opacity:0} #journey-connector{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9;opacity:0} html[data-stacked="true"] [data-drawy-detail]{inset:auto 8px 8px!important;translate:none;width:auto!important;height:184px!important;padding:10px 14px!important}';
  document.head.append(presentation);
  const focus = document.createElement('div');
  focus.id = 'journey-focus';
  const connector = document.createElementNS('http://www.w3.org/2000/svg','svg');
  connector.id = 'journey-connector';
  connector.innerHTML = '<path fill="none" stroke="#2a56c6" stroke-width="1.2" stroke-dasharray="4 4"/>';
  document.body.append(focus, connector);
  function cue() {
    const page = current();
    const host = window.drawyView?.renderer.host('module','evaporation-label');
    const show = wanted && !!page && !!host;
    focus.style.opacity = connector.style.opacity = show ? '1' : '0';
    if (!show) return;
    const r = host.getBoundingClientRect(), p = page.getBoundingClientRect();
    Object.assign(focus.style,{left:r.left-4+'px',top:r.top-3+'px',width:r.width+8+'px',height:r.height+6+'px'});
    connector.setAttribute('viewBox','0 0 '+innerWidth+' '+innerHeight);
    const x=r.right+4,y=r.top+r.height/2;
    connector.firstElementChild.setAttribute('d',narrow()
      ? 'M'+x+' '+y+' Q'+(x+16)+' '+p.top+' '+(p.left+p.width*.8)+' '+p.top
      : 'M'+x+' '+y+' C'+(x+28)+' '+y+' '+(p.left-30)+' '+(p.top+35)+' '+p.left+' '+(p.top+35));
  }
  function transition(element, frames, duration, isManual) {
    if (reduced.matches) return null;
    const a = element.animate(frames,{duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'});
    a.id='drawy-journey-transition';
    transitions.set(a,isManual);
    if (!isManual && !clock.playing) a.pause();
    a.finished.then(()=>{transitions.delete(a); cue();},()=>transitions.delete(a));
    return a;
  }
  function camera(isManual) {
    const before = getComputedStyle(stage).transform;
    for (const a of stage.getAnimations()) if(a.id==='drawy-journey-transition') a.cancel();
    stage.style.height = artHeight+'px';
    stage.style.transform = 'none';
    window.drawyShowcase.frame?.();
    if(wanted && !stacked) {
      const picture = window.drawyView?.renderer.host('module','landscape')?.getBoundingClientRect();
      if(picture) {
        const panelWidth = Math.min(320,Math.max(272,innerWidth*.26));
        const available = innerWidth-panelWidth-32;
        const scale = Math.min(1,(available-16)/picture.width);
        stage.style.transform = 'translateX('+(8-picture.left*scale)+'px) scale('+scale+')';
      }
    }
    if(before!==stage.style.transform) transition(stage,[{transform:before},{transform:stage.style.transform}],800,isManual);
    current()?.querySelector('article')?.toggleAttribute('data-compact',stacked);
  }
  function present(page) {
    page.querySelector('article')?.toggleAttribute('data-compact',stacked);
    const root=page.querySelector('article')?.shadowRoot;
    if(root && !root.querySelector('[data-showcase-detail]')) {
      const style=document.createElement('style');
      style.dataset.showcaseDetail='';
      style.textContent=':host{font:13px/1.65 system-ui,sans-serif!important;color:#161a22;max-width:none!important}.back{display:none!important}h1,h2,h3{font-family:system-ui,sans-serif!important;font-weight:650!important}h1{font-size:20px!important;line-height:1.4!important;margin:0 0 14px!important;color:#161a22!important}article{padding:0!important}article h1{display:none!important}article h2{font-size:14px!important;line-height:1.5!important;margin:0 0 7px!important;color:#2a56c6!important}article p{font-size:12px!important;line-height:1.75!important;margin:0!important;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}article figure~*,article section~section{display:none!important}figure{margin:15px 0 0!important}svg{width:100%!important;max-height:170px!important;border-radius:0!important}svg text{font-size:28px}figcaption{font:10px/1.5 system-ui,sans-serif!important;margin-top:8px!important;color:#687586!important}:host([data-compact]) h1{font-size:15px!important;margin:0 0 6px!important}:host([data-compact]) article h2,:host([data-compact]) article p,:host([data-compact]) figcaption{display:none!important}:host([data-compact]) figure{margin:0!important}:host([data-compact]) svg{height:125px!important;max-height:125px!important}';
      root.append(style);
    }
    page.scrollTop=0;
    transition(page,[{opacity:0,transform:narrow()?'translateY(24px)':'translateX(28px)'},{opacity:1,transform:'none'}],760,manual);
    cue();
  }
  function setDetail(detail,isManual) {
    wanted=detail;
    document.documentElement.dataset.detail=String(wanted);
    manual=isManual;
    camera(isManual);
    if(wanted) {
      if(!current()) window.drawyView.options.open({kind:'detail',id:'evaporation'});
    } else {
      current()?.remove();
      cue();
    }
  }
  addEventListener('message',event=>{
    if(event.source!==parent) return;
    if(event.data?.type==='drawy:journey-layout' && Number.isFinite(event.data.artHeight) && event.data.artHeight>0) {
      artHeight=event.data.artHeight;
      stacked=event.data.stacked===true;
      document.documentElement.dataset.stacked=String(stacked);
      camera(true);
      cue();
    }
    if(event.data?.type==='drawy:journey-timeline') {
      if(!Number.isFinite(event.data.elapsed)) return;
      clock={elapsed:event.data.elapsed,playing:event.data.playing===true,stamp:performance.now()};
      document.documentElement.dataset.replayPlaying=String(clock.playing);
      for(const [a,isManual] of transitions) if(!isManual) clock.playing?a.play():a.pause();
      if(raf) cancelAnimationFrame(raf);
      tick();
      cue();
    }
    if(event.data?.type==='drawy:journey-stage' && window.drawyReady)
      setDetail(!!event.data.detail,!event.data.automatic);
  });
  new MutationObserver(records=>{
    for(const record of records) for(const node of record.addedNodes)
      if(node instanceof HTMLElement && node.hasAttribute('data-drawy-detail')) present(node);
  }).observe(document.body,{childList:true});
  addEventListener('resize',()=>{ camera(true); cue(); });
})();
