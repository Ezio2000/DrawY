import type { Work, Instance } from "../contracts/index.ts";

// A test work whose drawing method is entirely work-owned source.
export function fixture(): Work {
  const names = ["自我实现", "尊重需求", "归属与爱", "安全需求", "生理需求"];
  const colors = ["#d68c6c", "#d6b477", "#b7b78b", "#8eaa9b", "#91afbf"];
  const modules: Instance[] = names.map((label, i) => ({
    id: "level-" + i,
    drawingId: "tier",
    label,
    data: {
      label,
      color: colors[i],
      tip: ["发挥潜能", "自尊与认可", "关系与接纳", "保障与稳定", "食物与休息"][
        i
      ],
    },
    bounds: {
      x: 300 - 50 * i,
      y: 110 + i * 100,
      width: 240 + i * 100,
      height: 94,
    },
    anchors: { left: { x: 0, y: 0.5 }, right: { x: 1, y: 0.5 } },
    group: "pyramid",
    target: { kind: "detail", id: "explanation" },
  }));
  modules.push({
    id: "heading",
    drawingId: "title",
    label: "标题",
    data: {},
    bounds: { x: 100, y: 10, width: 640, height: 70 },
    anchors: {},
    group: null,
    target: null,
  });
  modules.push({
    id: "control",
    drawingId: "control",
    label: "交互",
    data: {},
    bounds: { x: 250, y: 630, width: 340, height: 48 },
    anchors: {},
    group: null,
    target: null,
  });
  return {
    id: "fixture",
    title: "马斯洛需求理论",
    rootSceneId: "root",
    revision: 1,
    updatedAt: 1,
    drawings: {
      tier: {
        id: "tier",
        name: "斜边层级",
        source: `const {width:w,height:h,data:d}=api;
return api.svg('<svg viewBox="0 0 '+w+' '+h+'"><path d="M 47 0 H '+(w-47)+' L '+w+' '+h+' H 0 Z" fill="'+d.color+'"/><text x="'+w/2+'" y="42" text-anchor="middle" font-size="24" fill="#24312e" font-weight="650">'+d.label+'</text><text x="'+w/2+'" y="69" text-anchor="middle" font-size="15" fill="#24312e">'+d.tip+'</text></svg>');`,
      },
      title: {
        id: "title",
        name: "图注",
        source: `return api.svg('<svg viewBox="0 0 640 70"><text x="320" y="30" text-anchor="middle" font-size="30" fill="#24312e" font-weight="650">马斯洛需求理论</text><text x="320" y="60" text-anchor="middle" font-size="15" fill="#6c7972">点击层级查看解释 · 层级可以独立选择与移动</text></svg>');`,
      },
      control: {
        id: "control",
        name: "探索按钮",
        source: `const root=api.html('<style>div{display:flex;justify-content:center;gap:16px}button{border:1px solid #c2cabf;border-radius:20px;background:transparent;color:#24312e;padding:8px 16px;cursor:pointer}</style><div><button data-action="emphasize">强调基础</button><button data-action="explore">进入子场景</button></div>');
root.querySelector('[data-action="emphasize"]').onclick=()=>api.emit('emphasize');
root.querySelector('[data-action="explore"]').onclick=()=>api.emit('explore');
return root;`,
      },
      mermaid: {
        id: "mermaid",
        name: "流程",
        source:
          "return await api.mermaid('flowchart LR\\nA[需求] --> B[行动]');",
      },
      uml: {
        id: "uml",
        name: "时序",
        source:
          "return await api.plantuml('@startuml\\nAlice -> Bob: hello\\n@enduml');",
      },
      connector: {
        id: "connector",
        name: "连接",
        source: `return api.svg('<svg viewBox="0 0 '+api.width+' '+api.height+'"><path d="M '+api.from.x+' '+api.from.y+' L '+api.to.x+' '+api.to.y+'" fill="none" stroke="#d97757" stroke-width="3"/></svg>');`,
      },
    },
    scenes: {
      root: {
        id: "root",
        title: "需求层次",
        parentId: null,
        modules,
        links: [],
        interactionId: "explore",
        checks: [
          { moduleId: "control", selector: '[data-action="emphasize"]' },
          { moduleId: "control", selector: '[data-action="explore"]' },
        ],
      },
      child: {
        id: "child",
        title: "需求与行动",
        parentId: "root",
        modules: ["mermaid", "uml"].map((drawingId, i) => ({
          id: drawingId,
          drawingId,
          label: drawingId,
          data: {},
          bounds: { x: i * 450, y: 0, width: 400, height: 300 },
          anchors: {},
          group: null,
          target: null,
        })),
        links: [],
        interactionId: null,
        checks: [],
      },
    },
    interactions: {
      explore: {
        id: "explore",
        source: `api.on('control','emphasize',async()=>{await new Promise(resolve=>setTimeout(resolve,60));await api.set('level-4',{color:'#e8aa68',tip:'已突出基础需要'});});api.on('control','explore',()=>api.openScene('child'));`,
      },
    },
    details: {
      explanation: {
        id: "explanation",
        title: "理解需求层次",
        html: "<p>这些层次用来组织动机，现实中的需要会相互影响。</p>",
      },
    },
    resources: {},
    style: {
      ink: "#24312e",
      accent: "#d97757",
      muted: "#6c7972",
      font: "system-ui,sans-serif",
    },
  };
}
